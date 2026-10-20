/** One-shot local files selected from Planner. Never persisted or sent remotely. */
export type PrivateSourceFileHandoff = {
  serial: number
  planKey: string
  files: File[]
}
