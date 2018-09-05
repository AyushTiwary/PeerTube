import { Transaction } from 'sequelize'
import { ActivityAudience, ActivityUpdate } from '../../../../shared/models/activitypub'
import { VideoPrivacy } from '../../../../shared/models/videos'
import { AccountModel } from '../../../models/account/account'
import { ActorModel } from '../../../models/activitypub/actor'
import { VideoModel } from '../../../models/video/video'
import { VideoChannelModel } from '../../../models/video/video-channel'
import { VideoShareModel } from '../../../models/video/video-share'
import { getUpdateActivityPubUrl } from '../url'
import { broadcastToFollowers, unicastTo } from './utils'
import { audiencify, getActorsInvolvedInVideo, getAudience, getObjectFollowersAudience } from '../audience'
import { logger } from '../../../helpers/logger'
import { VideoCaptionModel } from '../../../models/video/video-caption'
import { VideosRedundancyModel } from '../../../models/redundancy/videos-redundancy'

async function sendUpdateVideo (video: VideoModel, t: Transaction, overrodeByActor?: ActorModel) {
  logger.info('Creating job to update video %s.', video.url)

  const byActor = overrodeByActor ? overrodeByActor : video.VideoChannel.Account.Actor

  const url = getUpdateActivityPubUrl(video.url, video.updatedAt.toISOString())

  // Needed to build the AP object
  if (!video.VideoCaptions) video.VideoCaptions = await video.$get('VideoCaptions') as VideoCaptionModel[]

  const videoObject = video.toActivityPubObject()
  const audience = getAudience(byActor, video.privacy === VideoPrivacy.PUBLIC)

  const data = updateActivityData(url, byActor, videoObject, audience)

  const actorsInvolved = await VideoShareModel.loadActorsByShare(video.id, t)
  actorsInvolved.push(byActor)

  return broadcastToFollowers(data, byActor, actorsInvolved, t)
}

async function sendUpdateActor (accountOrChannel: AccountModel | VideoChannelModel, t: Transaction) {
  const byActor = accountOrChannel.Actor

  logger.info('Creating job to update actor %s.', byActor.url)

  const url = getUpdateActivityPubUrl(byActor.url, byActor.updatedAt.toISOString())
  const accountOrChannelObject = accountOrChannel.toActivityPubObject()
  const audience = getAudience(byActor)
  const data = updateActivityData(url, byActor, accountOrChannelObject, audience)

  let actorsInvolved: ActorModel[]
  if (accountOrChannel instanceof AccountModel) {
    // Actors that shared my videos are involved too
    actorsInvolved = await VideoShareModel.loadActorsByVideoOwner(byActor.id, t)
  } else {
    // Actors that shared videos of my channel are involved too
    actorsInvolved = await VideoShareModel.loadActorsByVideoChannel(accountOrChannel.id, t)
  }

  actorsInvolved.push(byActor)

  return broadcastToFollowers(data, byActor, actorsInvolved, t)
}

async function sendUpdateCacheFile (byActor: ActorModel, redundancyModel: VideosRedundancyModel) {
  logger.info('Creating job to update cache file %s.', redundancyModel.url)

  const url = getUpdateActivityPubUrl(redundancyModel.url, redundancyModel.updatedAt.toISOString())
  const video = await VideoModel.loadAndPopulateAccountAndServerAndTags(redundancyModel.VideoFile.Video.id)

  const redundancyObject = redundancyModel.toActivityPubObject()

  const accountsInvolvedInVideo = await getActorsInvolvedInVideo(video, undefined)
  const audience = getObjectFollowersAudience(accountsInvolvedInVideo)

  const data = updateActivityData(url, byActor, redundancyObject, audience)
  return unicastTo(data, byActor, video.VideoChannel.Account.Actor.sharedInboxUrl)

}

// ---------------------------------------------------------------------------

export {
  sendUpdateActor,
  sendUpdateVideo,
  sendUpdateCacheFile
}

// ---------------------------------------------------------------------------

function updateActivityData (url: string, byActor: ActorModel, object: any, audience?: ActivityAudience): ActivityUpdate {
  if (!audience) audience = getAudience(byActor)

  return audiencify(
    {
      type: 'Update' as 'Update',
      id: url,
      actor: byActor.url,
      object: audiencify(object, audience
      )
    },
    audience
  )
}
