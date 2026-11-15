import { Composition } from 'remotion'
import { Video } from './Video'
import tl from './timeline.json'

export const Root = () => (
  <Composition id="Ballast" component={Video} durationInFrames={tl.total} fps={tl.fps} width={1920} height={1080} />
)
