/** Small inline icons shared by the cards and lists. */
export function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 20.5 4.2 12.8A5 5 0 0 1 11.3 5.7l.7.7.7-.7a5 5 0 0 1 7.1 7.1Z" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function CartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2.2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.1L20 8H6.2" />
      <circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" />
    </svg>
  )
}
