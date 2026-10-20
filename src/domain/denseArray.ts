/**
 * An active meal day or physical ingredient position cannot be an absent
 * Array slot. Array.every skips holes, while Set counts them as undefined:
 * together those can make an incomplete week appear complete.
 */
export function hasEveryOwnArrayIndex(array: readonly unknown[]): boolean {
  if (!Array.isArray(array)) return false
  for (let index = 0; index < array.length; index++) {
    if (!Object.hasOwn(array, index)) return false
  }
  return true
}
