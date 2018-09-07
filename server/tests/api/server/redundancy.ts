/* tslint:disable:no-unused-expression */

import * as chai from 'chai'
import 'mocha'
import { join } from 'path'
import * as request from 'supertest'
import { VideoPrivacy } from '../../../../shared/models/videos'
import { VideoComment, VideoCommentThreadTree } from '../../../../shared/models/videos/video-comment.model'
import {
  addVideoChannel,
  checkVideoFilesWereRemoved,
  completeVideoCheck,
  createUser,
  dateIsValid,
  doubleFollow,
  flushAndRunMultipleServers,
  flushTests,
  getLocalVideos,
  getVideo,
  getVideoChannelsList,
  getVideosList,
  killallServers,
  rateVideo,
  removeVideo,
  ServerInfo,
  setAccessTokensToServers,
  testImage,
  updateVideo,
  uploadVideo,
  userLogin,
  viewVideo,
  wait,
  webtorrentAdd
} from '../../utils'
import {
  addVideoCommentReply,
  addVideoCommentThread,
  deleteVideoComment,
  getVideoCommentThreads,
  getVideoThreadComments
} from '../../utils/videos/video-comments'
import { waitJobs } from '../../utils/server/jobs'

const expect = chai.expect

describe('Test videos redundancy', function () {
  let servers: ServerInfo[] = []

  before(async function () {
    this.timeout(120000)

    servers = await flushAndRunMultipleServers(3)

    // Get the access tokens
    await setAccessTokensToServers(servers)

    // Upload 3 videos on server 2
    // Strategy most-views + limited to 4 files of video on server 2

    // Server 1 and server 2 follow each other
    await doubleFollow(servers[0], servers[1])
    // Server 1 and server 3 follow each other
    await doubleFollow(servers[0], servers[2])
    // Server 2 and server 3 follow each other
    await doubleFollow(servers[1], servers[2])
  })

  it('Should have 1 webseed on the first video')

  it('Should enable redundancy on server 1')

  it('Should have 2 webseed on the first video')

  it('Should view another video and change video redundancy')

  after(async function () {
    killallServers(servers)

    // Keep the logs if the test failed
    if (this['ok']) {
      await flushTests()
    }
  })
})
