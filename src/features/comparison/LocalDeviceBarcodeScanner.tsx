import { useEffect, useRef, useState } from 'react'
import './localDeviceBarcodeScanner.css'

type BarcodeHit = { rawValue?: unknown }
type Reader = { detect(video: HTMLVideoElement): Promise<BarcodeHit[]> }
type ReaderConstructor = {
  new (options: { formats: string[] }): Reader
  getSupportedFormats?: () => Promise<string[]>
}
const requestedFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

/**
 * Device-only optical scan of the ORIGINAL observed pack.
 * It cannot identify a retailer SKU, product, price, stock or source rights.
 * The user must deliberately accept the visible barcode into their draft.
 * No camera frames, images or codes leave the browser.
 */
export function LocalDeviceBarcodeScanner({
  onAccept,
  onClose,
}: {
  onAccept: (code: string) => void
  onClose: () => void
}) {
  const [state, setState] = useState<'idle' | 'opening' | 'scanning' | 'found'>('idle')
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const generationRef = useRef(0)

  function stopCamera() {
    ++generationRef.current
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  useEffect(() => () => {
    // Unmount or changing the selected Planner row releases the camera.
    ++generationRef.current
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  async function start() {
    stopCamera()
    setCode(null)
    setError('')
    setState('opening')
    const generation = generationRef.current
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error('Cameratoegang vereist HTTPS of localhost. Typ de originele code handmatig.')
      // BarcodeDetector is optional: never send a frame to a remote image
      // service when the device does not provide on-device support.
      const ReaderType = (window as Window & { BarcodeDetector?: ReaderConstructor }).BarcodeDetector
      if (!ReaderType)
        throw new Error('Deze browser ondersteunt geen lokale barcodescan. Vul de code handmatig in.')
      const supported = ReaderType.getSupportedFormats
        ? await ReaderType.getSupportedFormats()
        : requestedFormats
      if (generation !== generationRef.current) return
      const formats = requestedFormats.filter(format => supported.includes(format))
      if (!formats.length)
        throw new Error('EAN/UPC-barcodes worden door deze browser niet ondersteund.')
      const reader = new ReaderType({ formats })
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' } },
      })
      if (generation !== generationRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stopCamera(); return }
      video.srcObject = stream
      await video.play()
      if (generation !== generationRef.current) return
      setState('scanning')
      const scan = async () => {
        if (generation !== generationRef.current || !videoRef.current) return
        try {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const found = await reader.detect(video)
            if (generation !== generationRef.current) return
            const hit = found.find(item =>
              typeof item.rawValue === 'string' &&
              /^(?:\d{6}|\d{8}|\d{12,14})$/.test(item.rawValue))
            if (hit && typeof hit.rawValue === 'string') {
              stopCamera()
              setCode(hit.rawValue)
              setState('found')
              return
            }
          }
        } catch {
          // A bad frame is not evidence of a product. Keep the scan local,
          // bounded and cancellable; manual entry remains available.
        }
        if (generation === generationRef.current)
          timerRef.current = window.setTimeout(() => void scan(), 300)
      }
      await scan()
    } catch (cause) {
      if (generation !== generationRef.current) return
      stopCamera()
      setState('idle')
      setError(cause instanceof Error &&
        (cause.name === 'NotAllowedError' || cause.name === 'NotFoundError')
          ? 'Camera geweigerd of niet gevonden. Je kunt de code handmatig invullen.'
          : cause instanceof Error ? cause.message
            : 'Lokaal scannen niet mogelijk. Vul de productcode handmatig in.')
    }
  }

  return <section className="local-barcode-scanner"
    aria-label="Optioneel lokale barcode scannen voor eigen product">
    <p>Optionele camerascan van de <strong>echte verpakking</strong>.
      De barcode is niet automatisch de artikelcode van PLUS of DekaMarkt.
      Je bevestigt zelf of de gevonden code overeenkomt met je originele bron.
      Video en barcode blijven op dit apparaat; er wordt niets geüpload.</p>
    <video ref={videoRef} muted playsInline autoPlay
      aria-label="Lokale camera voor productbarcode"
      hidden={state !== 'opening' && state !== 'scanning'} />
    {state === 'idle' && <button type="button" className="ghost-button"
      onClick={() => void start()}>Start camera na toestemming</button>}
    {state === 'opening' && <p role="status">Camera lokaal openen…</p>}
    {state === 'scanning' && <p role="status">Houd de EAN- of UPC-streepjescode in beeld.</p>}
    {state === 'found' && code && <div className="local-barcode-scanner__found">
      <strong>Gevonden verpakkingsbarcode: {code}</strong>
      <p>Gebruik deze alleen als hij daadwerkelijk hoort bij het waargenomen
        bronartikel. Naam, verpakking, beschikbaarheid en prijs blijven oningevuld.</p>
      <button type="button" onClick={() => {
        stopCamera()
        onAccept(code)
      }}>Gebruik deze code in mijn concept</button>
      <button type="button" className="ghost-button"
        onClick={() => void start()}>Scan opnieuw</button>
    </div>}
    {error && <p role="status" className="local-barcode-scanner__error">{error}</p>}
    <button type="button" className="ghost-button" onClick={() => {
      stopCamera()
      onClose()
    }}>Sluit scanner · vul eventueel handmatig in</button>
  </section>
}
