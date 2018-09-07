import { logger } from './logger'
import { generateVideoTmpPath } from './utils'
import * as WebTorrent from 'webtorrent'
import { createWriteStream, remove } from 'fs-extra'
import { CONFIG } from '../initializers'
import { join } from 'path'

function downloadWebTorrentVideo (target: { magnetUri: string, torrentName?: string }, timeout?: number) {
  const id = target.magnetUri || target.torrentName

  const path = generateVideoTmpPath(id)
  logger.info('Importing torrent video %s', id)

  return new Promise<string>((res, rej) => {
    const webtorrent = new WebTorrent()
    let file: WebTorrent.TorrentFile

    const torrentId = target.magnetUri || join(CONFIG.STORAGE.TORRENTS_DIR, target.torrentName)

    const options = { path: CONFIG.STORAGE.VIDEOS_DIR }
    const torrent = webtorrent.add(torrentId, options, torrent => {
      if (torrent.files.length !== 1) return rej(new Error('The number of files is not equal to 1 for ' + torrentId))

      file = torrent.files[ 0 ]

      const writeStream = createWriteStream(path)
      writeStream.on('finish', () => {
        destroyWebtorrent(webtorrent, torrentId, file.name, target.torrentName)
          .then(() => res(path))
          .catch(rej)
      })

      file.createReadStream().pipe(writeStream)
    })

    torrent.on('error', err => rej(err))

    if (timeout) {
      setTimeout(() => {
        webtorrent.remove(torrent)

        destroyWebtorrent(webtorrent, torrentId, file ? file.name : undefined, target.torrentName)
          .catch(err => logger.warn('Cannot destroy webtorrent in timeout.', { err }))

        return rej(new Error('Webtorrent download timeout.'))
      }, timeout)
    }
  })
}

// ---------------------------------------------------------------------------

export {
  downloadWebTorrentVideo
}

// ---------------------------------------------------------------------------

function destroyWebtorrent (webtorrent: WebTorrent.Instance, torrentId: string, filename?: string, torrentName?: string) {
  return new Promise((res, rej) => {
    webtorrent.destroy(async err => {
      // Delete torrent file
      if (torrentName) {
        remove(torrentId)
          .catch(err => logger.error('Cannot remove torrent %s in webtorrent download.', torrentId, { err }))
      }

      // Delete downloaded file
      if (filename) {
        remove(join(CONFIG.STORAGE.VIDEOS_DIR, filename))
          .catch(err => logger.error('Cannot remove torrent file %s in webtorrent download.', filename, { err }))
      }

      if (err) return rej(err)

      return res()
    })
  })
}
