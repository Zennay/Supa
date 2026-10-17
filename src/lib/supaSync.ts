import type { SyncRequestInit } from './syncTransport'

/**
 * Browser half of /api/sync. localStorage stays the source the app reads, so
 * every screen keeps working offline or on a static host without the API.
 * This module only mirrors three app records to the server and restores them
 * when this browser has no unsynced edits of its own.
 */
export const SYNC_KEYS = [
  'supa:planner-preferences:v2',
  'supa.recipe-library.v1',
  'supa:shopping-list-progress:v1',
] as const
export const DEVICE_KEY_STORAGE = 'supa:device-key:v1'
export const SYNC_META_STORAGE = 'supa:sync-meta:v1'

type SyncKey = typeof SYNC_KEYS[number]
type Entries = Record<SyncKey, string | null>
type Meta = { revision: number; synced: Entries }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type SyncRequest = (init: SyncRequestInit) => Promise<Response>
export type SyncOptions = { storage: StorageLike; request: SyncRequest; randomBytes?: (size: number) => Uint8Array }
type Remote = { revision: number; entries: Partial<Record<string, unknown>> }

const emptyEntries = (): Entries => ({ 'supa:planner-preferences:v2': null, 'supa.recipe-library.v1': null, 'supa:shopping-list-progress:v1': null })

function base64url(bytes: Uint8Array) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function deviceKey({ storage, randomBytes = size => crypto.getRandomValues(new Uint8Array(size)) }: Pick<SyncOptions, 'storage' | 'randomBytes'>) {
  const existing = storage.getItem(DEVICE_KEY_STORAGE)
  if (existing && /^[A-Za-z0-9_-]{43,128}$/.test(existing)) return existing
  const created = base64url(randomBytes(32))
  storage.setItem(DEVICE_KEY_STORAGE, created)
  return created
}

function readMeta(storage: StorageLike): Meta {
  try {
    const value = JSON.parse(storage.getItem(SYNC_META_STORAGE) ?? 'null')
    if (Number.isSafeInteger(value?.revision) && value.revision >= 0 && value.synced && typeof value.synced === 'object') {
      const synced = emptyEntries()
      for (const key of SYNC_KEYS) synced[key] = typeof value.synced[key] === 'string' ? value.synced[key] : null
      return { revision: value.revision, synced }
    }
  } catch { /* unreadable metadata: treat as never synced */ }
  return { revision: 0, synced: emptyEntries() }
}

const writeMeta = (storage: StorageLike, meta: Meta) => storage.setItem(SYNC_META_STORAGE, JSON.stringify(meta))
const localEntries = (storage: StorageLike): Entries => {
  const entries = emptyEntries()
  for (const key of SYNC_KEYS) entries[key] = storage.getItem(key)
  return entries
}
const remoteEntry = (remote: Remote, key: SyncKey) => typeof remote.entries[key] === 'string' ? remote.entries[key] as string : null

/**
 * Take the server's value for every record this browser has not changed since
 * the last sync; keep local edits (they are pushed next). Returns the keys
 * whose stored bytes changed.
 */
function adopt(storage: StorageLike, meta: Meta, remote: Remote): { changed: SyncKey[]; meta: Meta } {
  // An older server copy (restored backup, wiped data dir) must never delete
  // local records: forget the sync base so everything local is uploaded again.
  if (remote.revision < meta.revision) return { changed: [], meta: { revision: remote.revision, synced: emptyEntries() } }
  const changed: SyncKey[] = []
  const synced = { ...meta.synced }
  for (const key of SYNC_KEYS) {
    const local = storage.getItem(key)
    const server = remoteEntry(remote, key)
    if (local === meta.synced[key] && local !== server) {
      if (server === null) storage.removeItem(key); else storage.setItem(key, server)
      changed.push(key)
    }
    synced[key] = server
  }
  return { changed, meta: { revision: remote.revision, synced } }
}

async function readRemote(options: SyncOptions, key: string, signal?: AbortSignal): Promise<Remote | null> {
  const response = await options.request({ headers: { Authorization: `Bearer ${key}` }, signal })
  if (!response.ok || !/application\/json/.test(response.headers.get('content-type') ?? '')) return null
  const remote = await response.json()
  return Number.isSafeInteger(remote?.revision) && remote.entries && typeof remote.entries === 'object' ? remote : null
}

/** Before the first render: restore this device's saved records from the server. */
export async function pullSyncedState(options: SyncOptions, signal?: AbortSignal): Promise<SyncKey[]> {
  const key = deviceKey(options)
  const remote = await readRemote(options, key, signal)
  if (!remote) return []
  const meta = readMeta(options.storage)
  if (remote.revision === meta.revision) return []
  const result = adopt(options.storage, meta, remote)
  writeMeta(options.storage, result.meta)
  return result.changed
}

export type PushResult = 'unchanged' | 'saved' | 'rejected' | 'unavailable' | 'no-api'

/** Upload local edits. A newer server copy is merged once, then retried. */
export async function pushSyncedState(options: SyncOptions, { keepalive = false } = {}): Promise<PushResult> {
  const key = deviceKey(options)
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = readMeta(options.storage)
    const entries = localEntries(options.storage)
    if (SYNC_KEYS.every(k => entries[k] === meta.synced[k])) return 'unchanged'
    const response = await options.request({
      method: 'PUT', keepalive,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: meta.revision, entries }),
    })
    if (response.status === 200) {
      const saved = await response.json()
      writeMeta(options.storage, { revision: saved.revision, synced: entries })
      return 'saved'
    }
    if (response.status === 409) {
      const remote = await response.json()
      const merged = adopt(options.storage, meta, remote)
      // Keep this browser's own edits as unsynced on top of the newer base.
      writeMeta(options.storage, merged.meta)
      if (merged.changed.length && typeof window !== 'undefined') window.dispatchEvent(new Event('supa-recipes-changed'))
      continue
    }
    if (response.status === 422) return 'rejected'
    // Static hosting or an older server without the sync route.
    if ([404, 405, 501].includes(response.status)) return 'no-api'
    return 'unavailable'
  }
  return 'unavailable'
}

/** Mirror edits while the app is open; stops quietly when the API is absent. */
export function startBackgroundSync(options: SyncOptions, intervalMs = 4000) {
  let stopped = false
  let running = false
  const tick = async (keepalive = false) => {
    if (stopped || running) return
    running = true
    try {
      const result = await pushSyncedState(options, { keepalive })
      if (result === 'rejected' || result === 'no-api') stopped = true
    } catch { /* offline: retry on the next tick */ }
    finally { running = false }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  const onHide = () => { if (document.visibilityState === 'hidden') void tick(true) }
  document.addEventListener('visibilitychange', onHide)
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onHide) }
}
