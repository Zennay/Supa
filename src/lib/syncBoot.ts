import { pullSyncedState, startBackgroundSync, type SyncOptions } from './supaSync'
import { syncRequest } from './syncTransport'

function browserOptions(): SyncOptions | null {
  try {
    const storage = window.localStorage
    storage.getItem('supa:device-key:v1')
    return { storage, request: syncRequest }
  } catch {
    return null
  }
}

/** Never blocks the first render for more than `waitMs`, and never throws. */
export async function syncBeforeRender(waitMs = 1500) {
  const options = browserOptions()
  if (!options) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), waitMs)
  try {
    await pullSyncedState(options, controller.signal)
  } catch {
    // API unreachable, static hosting or timeout: keep the local copy.
  } finally {
    clearTimeout(timer)
  }
  startBackgroundSync(options)
}
