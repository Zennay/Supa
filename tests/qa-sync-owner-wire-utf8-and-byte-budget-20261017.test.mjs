import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { MAX_SNAPSHOT_BYTES } from '../server/sync-validation.mjs'

// QA-only byte-level HTTP wire tests on frozen product-owner DRAFT #3777,
// after original fixed P1 tests were imported intact. Fully synthetic,
// localhost-only and never a retailer request or real M3 observation.
const ORIGIN = 'https://supa-qa-private.invalid'
const KEY = 'U'.repeat(43)
const SHOP = 'supa:shopping-list-progress:v1'

async function withServer(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-sync-wire-qa-'))
  const server = createRecipeServer({
    root, origin: ORIGIN, syncStore: createFileSyncStore({ dir: join(root,'sync') }),
  })
  server.listen(0, '127.0.0.1')
  await once(server,'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive:true, force:true })
  })
  return server.address().port
}

function document(revision, basketKey) {
  return JSON.stringify({
    baseRevision: revision,
    entries: { [SHOP]: JSON.stringify({
      schemaVersion: 1, basketKey, doneLineIds: [],
    }) },
  })
}

function send(port, bytes, splitAt=null) {
  return new Promise((resolve,reject) => {
    const req = request({
      host:'127.0.0.1',port,method:'PUT',path:'/api/sync',
      headers:{
        Authorization:'Bearer '+KEY,
        Origin:ORIGIN,
        'Content-Type':'application/json',
      },
    }, res => {
      const parts=[]
      res.on('data', b=>parts.push(b))
      res.on('error',reject)
      res.on('end',()=>resolve({
        status:res.statusCode,
        body:Buffer.concat(parts).toString('utf8'),
      }))
    })
    req.on('error',reject)
    if (splitAt===null) req.end(bytes)
    else {
      req.write(bytes.subarray(0,splitAt))
      setTimeout(()=>req.end(bytes.subarray(splitAt)),20)
    }
  })
}
async function get(port) {
  const resp=await fetch('http://127.0.0.1:'+port+'/api/sync',{
    headers:{Authorization:'Bearer '+KEY},
  })
  assert.equal(resp.status,200)
  return resp.json()
}

test('every in-codepoint HTTP split of 2-, 3- and 4-byte valid UTF-8 preserves exact saved shopping JSON',async t=>{
  const port=await withServer(t)
  const cases=[
    ['é',1],['€',1],['€',2],
    ['🍱',1],['🍱',2],['🍱',3],
  ]
  let revision=0
  for(const [glyph,offset] of cases){
    const label='Privé Café € 🍱 — '+glyph+' '+offset+' fictional'
    const raw=document(revision,label)
    const bytes=Buffer.from(raw,'utf8')
    const glyphBytes=Buffer.from(glyph,'utf8')
    const index=bytes.lastIndexOf(glyphBytes)
    assert.ok(index>=0,'valid synthetic glyph bytes must exist')
    assert.ok(offset>0&&offset<glyphBytes.length)
    const splitAt=index+offset
    assert.equal(Buffer.concat([bytes.subarray(0,splitAt),bytes.subarray(splitAt)]).toString('utf8'),raw)
    const sent=await send(port,bytes,splitAt)
    assert.equal(sent.status,200,'valid split '+glyph+' at byte '+offset+' must be accepted')
    const value=await get(port)
    revision++
    assert.equal(value.revision,revision)
    assert.equal(value.entries[SHOP],JSON.parse(raw).entries[SHOP],
      'saved exact JSON must not contain replacement glyphs or dropped bytes')
    assert.equal(JSON.parse(value.entries[SHOP]).basketKey,label)
  }
})

test('six malformed UTF-8 encodings inside JSON text are refused, without minted revisions',async t=>{
  const port=await withServer(t)
  const originals=document(0,'synthetic €')
  const bytes=Buffer.from(originals,'utf8')
  const needle=bytes.indexOf(Buffer.from('€','utf8'))
  assert.ok(needle>0)
  const variants=[
    ['truncated two-byte prefix',[0xc2]],
    ['truncated three-byte prefix',[0xe2,0x82]],
    ['truncated four-byte prefix',[0xf0,0x9f,0x98]],
    ['overlong two-byte encoding',[0xc1,0xbf]],
    ['Unicode scalar above U+10FFFF',[0xf4,0x90,0x80,0x80]],
    ['UTF-8 surrogate',[0xed,0xa0,0x80]],
  ]
  for(const [name,invalid] of variants){
    const tampered=Buffer.concat([
      bytes.subarray(0,needle),Buffer.from(invalid),bytes.subarray(needle+3),
    ])
    const result=await send(port,tampered)
    assert.equal(result.status,400,name+' cannot be silently decoded into replacement characters')
    assert.ok(!result.body.includes('synthetic'),name+' must not echo the request body')
    const state=await get(port)
    assert.equal(state.revision,0,name+' cannot create any revision')
    assert.deepEqual(state.entries,{},name+' cannot persist corrupted shopping text')
  }
})

test('HTTP input byte budget is inclusive at 2.5MB+4096, and above-limit bytes fail closed before storage',async t=>{
  const port=await withServer(t)
  const limit=MAX_SNAPSHOT_BYTES+4096
  const raw=Buffer.from(document(0,'safe fictional shopping'), 'utf8')
  assert.ok(raw.length<limit)
  const exactly=Buffer.concat([raw,Buffer.alloc(limit-raw.length,0x20)])
  assert.equal(exactly.length,limit)
  const accepted=await send(port,exactly)
  assert.equal(accepted.status,200,'exactly the HTTP byte cap should be accepted if snapshot is small and valid')
  const stored=await get(port)
  assert.equal(stored.revision,1)
  const tooLarge=Buffer.concat([
    Buffer.from(document(1,'oversized fictional shopping'),'utf8'),
    Buffer.alloc(limit,0x20),
  ])
  assert.ok(tooLarge.length>limit)
  const rejected=await send(port,tooLarge)
  assert.equal(rejected.status,413,'over HTTP byte budget must be rejected even if JSON content is otherwise valid')
  const after=await get(port)
  assert.equal(after.revision,1,'413 must not modify prior revision')
  assert.equal(after.entries[SHOP],stored.entries[SHOP])
})
