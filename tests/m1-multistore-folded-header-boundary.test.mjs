import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

test('M1 header parser refuses folded response metadata', () => {
  const prefix = 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n'
  for (const continuation of [
    'Content-Encoding: identity\r\n\tgzip',
    'Content-Encoding: identity\r\n gzip',
    '\tapplication/json',
  ]) {
    assert.throws(
      () => parseCaptureHeaders(prefix + continuation + '\r\n\r\n'),
      /folded response header/,
    )
  }
  assert.equal(parseCaptureHeaders(prefix + '\r\n').contentType, 'text/html')
})
