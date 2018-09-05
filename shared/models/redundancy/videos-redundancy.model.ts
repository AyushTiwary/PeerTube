export type VideoRedundancyStrategy = 'most-views'

export interface VideosRedundancy {
  strategy: VideoRedundancyStrategy
  sizeGB: number
}
