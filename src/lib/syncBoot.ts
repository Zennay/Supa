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

/**
 * Never blocks the first render for more than `waitMs`, and never throws.
 * The deadline is enforced here, independent of whether the transport or the
 * response body honours the abort signal; a pull that finishes later is
 * aborted and does not touch localStorage (see pullSyncedState).
 */
export async function syncBeforeRender(waitMs = 1500) {
  const options = browserOptions()
  if (!options) return
  const controller = new AbortController()
  const pull = pullSyncedState(options, controller.signal).catch(() => [])
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise(resolve => { timer = setTimeout(resolve, waitMs) })
  try {
    await Promise.race([pull, deadline])
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
  startBackgroundSync(options)
}
