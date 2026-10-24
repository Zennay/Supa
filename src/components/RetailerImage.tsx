import { useState } from 'react'
import { safeRetailerImageUrl } from '../features/products/scraperProducts.ts'

type Props = { src: string | null; className?: string; fallback?: React.ReactNode }

/**
 * The only place a scraped retailer product photo may be loaded: https URLs
 * on the PLUS/DekaMarkt image CDNs, without a referrer. Anything else, or a
 * failed load, renders the fallback instead.
 */
export function RetailerImage({ src, className, fallback = null }: Props) {
  const [failed, setFailed] = useState(false)
  const safe = safeRetailerImageUrl(src)
  if (!safe || failed) return <>{fallback}</>
  return <img className={className} src={safe} alt="" loading="lazy" decoding="async"
    referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}
