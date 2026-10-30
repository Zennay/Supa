import { useEffect, type ReactNode } from 'react'
import './hifiModal.css'

/** Centered white card over a blurred screen; tap outside or press Escape to close. */
export function HiFiModal({ label, onClose, children, className = '' }: {
  label: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="hifi-modal-backdrop" onClick={onClose}>
      <div className={`hifi-modal ${className}`} role="dialog" aria-modal="true" aria-label={label}
        onClick={event => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
