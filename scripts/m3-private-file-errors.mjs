// Private M3 field paths, participant identifiers and runtime exception
// messages must never become CLI diagnostics. These are the exact static
// refusal strings emitted by the canonical local file-output guard. Never
// interpolate an arbitrary exception's .message, .path or .stack.
const SAFE_OUTPUT_REFUSALS = new Set([
  'refusing symlinked M3 output parent directory',
  'refusing non-directory M3 output parent',
  'refusing symlinked M3 derived output file',
  'refusing nonregular M3 derived output file',
  'refusing to overwrite M3 evidence input with derived output',
  'M3 output parent changed during private report publication',
  'M3 staging file changed before report publication',
])

export function privateM3OutputFailure(error) {
  // Only original Error objects bearing one of our own complete, static
  // messages retain the operator-useful refusal reason. OS/Node errors,
  // unexpected encoders and filesystem paths receive a generic diagnostic.
  // Do not pass through unknown subclasses or coercible message objects.
  if (error instanceof Error &&
      Object.getPrototypeOf(error) === Error.prototype &&
      SAFE_OUTPUT_REFUSALS.has(error.message)) {
    return new Error(error.message)
  }
  return new Error('private M3 derived output could not be written')
}
