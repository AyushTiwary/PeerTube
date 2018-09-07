import * as express from 'express'
import 'express-validator'
import { param } from 'express-validator/check'
import { exists, isIdOrUUIDValid, toIntOrNull } from '../../helpers/custom-validators/misc'
import { isVideoExist } from '../../helpers/custom-validators/videos'
import { logger } from '../../helpers/logger'
import { areValidationErrors } from './utils'
import { VideoModel } from '../../models/video/video'
import { VideoRedundancyModel } from '../../models/redundancy/video-redundancy'

const videoRedundancyGetValidator = [
  param('videoId').custom(isIdOrUUIDValid).not().isEmpty().withMessage('Should have a valid video id'),
  param('resolution')
    .customSanitizer(toIntOrNull)
    .custom(exists).withMessage('Should have a valid resolution'),
  param('fps')
    .optional()
    .customSanitizer(toIntOrNull)
    .custom(exists).withMessage('Should have a valid fps'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.debug('Checking videoRedundancyGetValidator parameters', { parameters: req.params })

    if (areValidationErrors(req, res)) return
    if (!await isVideoExist(req.params.videoId, res)) return

    const video: VideoModel = res.locals.video
    const videoFile = video.VideoFiles.find(f => {
      return f.resolution === req.params.resolution && (!req.params.fps || f.fps === req.params.fps)
    })

    if (!videoFile) return res.status(404).json({ error: 'Video file not found.' })
    res.locals.videoFile = videoFile

    const videoRedundancy = await VideoRedundancyModel.loadByFileId(videoFile.id)
    if (!videoRedundancy)return res.status(404).json({ error: 'Video redundancy not found.' })
    res.locals.videoRedundancy = videoRedundancy

    return next()
  }
]

// ---------------------------------------------------------------------------

export {
  videoRedundancyGetValidator
}
