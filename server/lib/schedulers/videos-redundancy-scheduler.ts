import { AbstractScheduler } from './abstract-scheduler'
import { CONFIG, REDUNDANCY, SCHEDULER_INTERVALS_MS } from '../../initializers'
import { logger } from '../../helpers/logger'
import { VideoRedundancyStrategy } from '../../../shared/models/redundancy'
import { VideosRedundancyModel } from '../../models/redundancy/videos-redundancy'
import { VideoFileModel } from '../../models/video/video-file'
import { sortBy } from 'lodash'
import { downloadWebTorrentVideo } from '../../helpers/webtorrent'
import { join } from 'path'
import { rename } from 'fs-extra'
import { getServerActor } from '../../helpers/utils'
import { getVideoCacheFileActivityPubUrl } from '../activitypub'

export class VideosRedundancyScheduler extends AbstractScheduler {

  private static instance: AbstractScheduler
  private executing = false

  protected schedulerIntervalMs = SCHEDULER_INTERVALS_MS.videosRedundancy

  private constructor () {
    super()
  }

  async execute () {
    if (this.executing) return

    this.executing = true

    for (const obj of CONFIG.REDUNDANCY.VIDEOS) {
      logger.info('Executing videos redundancy scheduler "%s".', obj.strategy)

      try {
        const videosRedundancy = await VideosRedundancyModel.getVideoFiles(obj.strategy)

        const videoToDuplicate = await this.findVideoToDuplicate(obj.strategy)
        if (!videoToDuplicate) continue

        const videoFiles = videoToDuplicate.VideoFiles
        videoFiles.forEach(f => f.Video = videoToDuplicate)
        await this.purgeVideosIfNeeded(videosRedundancy, videoFiles, obj.sizeGB)

        await this.createVideoRedundancy(obj.strategy, videoFiles)
      } catch (err) {
        logger.error('Cannot run videos redundancy %s.', obj.strategy, { err })
      }
    }

    const expired = await VideosRedundancyModel.listAllExpired()

    for (const m of expired) {
      logger.info('Removing expired video %s from our redundancy system.', this.buildEntryLogId(m))

      try {
        await m.destroy()
      } catch (err) {
        logger.error('Cannot remove %s video from our redundancy system.', this.buildEntryLogId(m))
      }
    }

    this.executing = false
  }

  static get Instance () {
    return this.instance || (this.instance = new this())
  }

  private findVideoToDuplicate (strategy: VideoRedundancyStrategy) {
    if (strategy === 'most-views') return VideosRedundancyModel.findMostViewToDuplicate()
  }

  private async createVideoRedundancy (strategy: VideoRedundancyStrategy, filesToDuplicate: VideoFileModel[]) {
    const serverActor = await getServerActor()

    for (const file of filesToDuplicate) {
      const existing = await VideosRedundancyModel.loadByFileId(file.id)
      if (existing) {
        logger.info('Duplicating %s - %d in videos redundancy with "%s" strategy.', file.Video.url, file.resolution, strategy)

        existing.expiresOn = this.buildNewExpiration()
        await existing.save()

        // Send AP
        continue
      }

      logger.info('Duplicating %s - %d in videos redundancy with "%s" strategy.', file.Video.url, file.resolution, strategy)

      const magnetUri = file.Video.generateMagnetUri(file, CONFIG.WEBSERVER.URL, CONFIG.WEBSERVER.WS)

      const tmpPath = await downloadWebTorrentVideo({ magnetUri })

      const destPath = join(CONFIG.STORAGE.VIDEOS_DIR, file.Video.getVideoFilename(file))
      await rename(tmpPath, destPath)

      await VideosRedundancyModel.create({
        expiresOn: new Date(Date.now() + REDUNDANCY.VIDEOS.EXPIRES_AFTER_MS),
        url: getVideoCacheFileActivityPubUrl(file),
        fileUrl: file.Video.getVideoFileUrl(file, CONFIG.WEBSERVER.URL),
        strategy,
        videoFileId: file.id,
        actorId: serverActor.id
      })

      // Send AP
    }

  }

  private async purgeVideosIfNeeded (videosRedundancy: VideosRedundancyModel[], filesToDuplicate: VideoFileModel[], maxSizeGB: number) {
    const sortedVideosRedundancy = sortBy(videosRedundancy, 'createdAt')

    while (this.isTooHeavy(sortedVideosRedundancy, filesToDuplicate, maxSizeGB)) {
      const toDelete = sortedVideosRedundancy.shift()

      const videoFile = toDelete.VideoFile
      logger.info('Purging video %s (resolution %d) from our redundancy system.', videoFile.Video.url, videoFile.resolution)

      await toDelete.destroy()

      // TODO: send UNDO AP
    }

    return sortedVideosRedundancy
  }

  private isTooHeavy (sortedVideosRedundancy: VideosRedundancyModel[], filesToDuplicate: VideoFileModel[], maxSizeGB: number) {
    let maxSize = maxSizeGB * 1024 * 1024 * 1024

    const fileReducer = (previous: number, current: VideoFileModel) => previous + current.size
    maxSize -= filesToDuplicate.reduce(fileReducer, 0)

    const redundancyReducer = (previous: number, current: VideosRedundancyModel) => previous + current.VideoFile.size
    const totalDuplicated = sortedVideosRedundancy.reduce(redundancyReducer, 0)

    return totalDuplicated > maxSize
  }

  private buildNewExpiration () {
    return new Date(Date.now() + REDUNDANCY.VIDEOS.EXPIRES_AFTER_MS)
  }

  private buildEntryLogId (object: VideosRedundancyModel) {
    return `${object.VideoFile.Video.url}-${object.VideoFile.resolution}`
  }
}
