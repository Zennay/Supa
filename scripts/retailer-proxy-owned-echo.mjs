#!/usr/bin/env node
// Minimal operator-owned test response. Only loopback HTTP; TLS terminates in
// an operator-approved reverse proxy. It never proxies to a supermarket.
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function handleEcho(req, res) {
  let parsed
  try { parsed = new URL(req.url, 'http://localhost') } catch {
    res.writeHead(400, { 'content-length': '0' }); res.end(); return
  }
  const nonce = parsed.searchParams.get('supa_probe')
  if (req.method !== 'GET' || parsed.pathname !== '/health' ||
      parsed.searchParams.size !== 1 || !/^[0-9a-f]{32}$/.test(nonce ?? '')) {
    res.writeHead(404, { 'content-length': '0', 'cache-control': 'no-store' })
    res.end(); return
  }
  const body = 'supa-proxy-ok:' + nonce
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

export function createEchoServer() { return http.createServer(handleEcho) }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('No command-line options are allowed')
    process.exitCode = 2
  } else {
    const server = createEchoServer()
    server.listen(12789, '127.0.0.1', () => {
      console.log('Supa private owned-echo origin listening on 127.0.0.1:12789')
    })
  }
}