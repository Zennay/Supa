export type SyncRequestInit = {
  method?: 'GET' | 'PUT'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  keepalive?: boolean
}

/** The only sync network call: same-origin /api/sync, nothing else. */
export function syncRequest(init: SyncRequestInit): Promise<Response> {
  return fetch('/api/sync', { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: init.signal, keepalive: init.keepalive, credentials: 'same-origin' })
}
