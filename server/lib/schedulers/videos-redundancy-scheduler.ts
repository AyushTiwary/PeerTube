import { AbstractScheduler } from './abstract-scheduler'
import { CONFIG, JOB_TTL, REDUNDANCY, SCHEDULER_INTERVALS_MS } from '../../initializers'
import { logger } from '../../helpers/logger'
import { VideoRedundancyStrategy } from '../../../shared/models/redundancy'
import { VideoRedundancyModel } from '../../models/redundancy/video-redundancy'
import { VideoFileModel } from '../../models/video/video-file'
import { sortBy } from 'lodash'
import { downloadWebTorrentVideo } from '../../helpers/webtorrent'
import { join } from 'path'
import { rename } from 'fs-extra'
import { getServerActor } from '../../helpers/utils'
import { sendCreateCacheFile, sendUndoCacheFile, sendUpdateCacheFile } from '../activitypub/send'
import { VideoModel } from '../../models/video/video'
import { getVideoCacheFileActivityPubUrl } from '../activitypub/url'
import { isTestInstance } from '../../helpers/core-utils'

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

      try {
        const videoToDuplicate = await this.findVideoToDuplicate(obj.strategy)
        if (!videoToDuplicate) continue

        logger.info('Will duplicate video %s in redundancy scheduler "%s".', videoToDuplicate.url, obj.strategy)

        const videoFiles = videoToDuplicate.VideoFiles
        videoFiles.forEach(f => f.Video = videoToDuplicate)

        const videosRedundancy = await VideoRedundancyModel.getVideoFiles(obj.strategy)
        await this.purgeVideosIfNeeded(videosRedundancy, videoFiles, obj.sizeGB)

        await this.createVideoRedundancy(obj.strategy, videoFiles)
      } catch (err) {
        logger.error('Cannot run videos redundancy %s.', obj.strategy, { err })
      }
    }

    const expired = await VideoRedundancyModel.listAllExpired()

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
    if (strategy === 'most-views') return VideoRedundancyModel.findMostViewToDuplicate(REDUNDANCY.VIDEOS.RANDOMIZED_FACTOR)
  }

  private async createVideoRedundancy (strategy: VideoRedundancyStrategy, filesToDuplicate: VideoFileModel[]) {
    const serverActor = await getServerActor()

    for (const file of filesToDuplicate) {
      const existing = await VideoRedundancyModel.loadByFileId(file.id)
      if (existing) {
        logger.info('Duplicating %s - %d in videos redundancy with "%s" strategy.', file.Video.url, file.resolution, strategy)

        existing.expiresOn = this.buildNewExpiration()
        await existing.save()

        await sendUpdateCacheFile(serverActor, existing)
        continue
      }

      // We need more attributes and check if the video still exists
      const video = await VideoModel.loadAndPopulateAccountAndServerAndTags(file.Video.id)
      if (!video) continue

      logger.info('Duplicating %s - %d in videos redundancy with "%s" strategy.', video.url, file.resolution, strategy)

      const { baseUrlHttp, baseUrlWs } = video.getBaseUrls()
      const magnetUri = video.generateMagnetUri(file, baseUrlHttp, baseUrlWs)

      const tmpPath = await downloadWebTorrentVideo({ magnetUri }, JOB_TTL['video-import'])

      const destPath = join(CONFIG.STORAGE.VIDEOS_DIR, video.getVideoFilename(file))
      await rename(tmpPath, destPath)

      const createdModel = await VideoRedundancyModel.create({
        expiresOn: new Date(Date.now() + REDUNDANCY.VIDEOS.EXPIRES_AFTER_MS),
        url: getVideoCacheFileActivityPubUrl(file),
        fileUrl: video.getVideoFileUrl(file, CONFIG.WEBSERVER.URL),
        strategy,
        videoFileId: file.id,
        actorId: serverActor.id
      })
      createdModel.VideoFile = file

      await sendCreateCacheFile(serverActor, createdModel)
    }
  }

  private async purgeVideosIfNeeded (videosRedundancy: VideoRedundancyModel[], filesToDuplicate: VideoFileModel[], maxSizeGB: number) {
    const serverActor = await getServerActor()
    const sortedVideosRedundancy = sortBy(videosRedundancy, 'createdAt')

    while (this.isTooHeavy(sortedVideosRedundancy, filesToDuplicate, maxSizeGB)) {
      const toDelete = sortedVideosRedundancy.shift()

      const videoFile = toDelete.VideoFile
      logger.info('Purging video %s (resolution %d) from our redundancy system.', videoFile.Video.url, videoFile.resolution)

      await sendUndoCacheFile(serverActor, toDelete, undefined)

      await toDelete.destroy()
    }

    return sortedVideosRedundancy
  }

  private isTooHeavy (sortedVideosRedundancy: VideoRedundancyModel[], filesToDuplicate: VideoFileModel[], maxSizeGB: number) {
    let maxSize = maxSizeGB * 1024 * 1024 * 1024

    const fileReducer = (previous: number, current: VideoFileModel) => previous + current.size
    maxSize -= filesToDuplicate.reduce(fileReducer, 0)

    const redundancyReducer = (previous: number, current: VideoRedundancyModel) => previous + current.VideoFile.size
    const totalDuplicated = sortedVideosRedundancy.reduce(redundancyReducer, 0)

    return totalDuplicated > maxSize
  }

  private buildNewExpiration () {
    return new Date(Date.now() + REDUNDANCY.VIDEOS.EXPIRES_AFTER_MS)
  }

  private buildEntryLogId (object: VideoRedundancyModel) {
    return `${object.VideoFile.Video.url}-${object.VideoFile.resolution}`
  }
}
