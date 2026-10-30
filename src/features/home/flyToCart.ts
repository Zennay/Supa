/** Small dot that flies from a clicked button to the cart icon, then bumps the cart. */
export function flyToCart(from: Element | null) {
  const cart = document.querySelector('[data-cart-target]')
  if (!from || !cart || typeof (from as HTMLElement).getBoundingClientRect !== 'function') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const start = from.getBoundingClientRect()
  const end = cart.getBoundingClientRect()
  const dot = document.createElement('span')
  dot.className = 'hifi-fly-dot'
  dot.style.left = `${start.left + start.width / 2 - 9}px`
  dot.style.top = `${start.top + start.height / 2 - 9}px`
  document.body.appendChild(dot)
  const dx = end.left + end.width / 2 - (start.left + start.width / 2)
  const dy = end.top + end.height / 2 - (start.top + start.height / 2)
  const animation = dot.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: .8 },
    ],
    { duration: 650, easing: 'cubic-bezier(.4, 0, .2, 1)' },
  )
  animation.onfinish = () => {
    dot.remove()
    cart.classList.remove('bump')
    void (cart as HTMLElement).offsetWidth
    cart.classList.add('bump')
  }
}
