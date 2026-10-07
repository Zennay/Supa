export function requireAppRoot(root: HTMLElement | null): HTMLElement {
  if (!root) {
    throw new Error('SUPA app root #root is missing')
  }

  return root
}
