import { figmaAssets } from '../features/home/figmaAssets'

const bundledAssets = new Set(Object.values(figmaAssets))
type Props = { asset: string; alt: string; className?: string; width?: string; height?: string }

/** Only reviewed, bundled Figma exports can create a browser image request. */
export function FigmaImage({ asset, alt, className, width, height }: Props) {
  if (!bundledAssets.has(asset)) return null
  return <img src={asset} alt={alt} className={className} width={width} height={height} />
}
