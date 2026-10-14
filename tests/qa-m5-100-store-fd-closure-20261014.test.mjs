import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withPinnedCaptureTree } from '../scripts/m5-pin-capture-store.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'
import { createHash } from 'node:crypto'

const HTML = '<!doctype html><body>invented independent offline</body>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const clean = stat => ({dev: stat.dev, ino: stat.ino})
const store = n => 'fictional' + String(n).padStart(3, '0')
async function sandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'supa-independent-fd-'))
  try { await fn(home) } finally { await rm(home, { recursive: true, force: true }) }
}
async function captures(home, count) {
  const root = join(home, 'root')
  await mkdir(root)
  const stores = new Map()
  for (let n=0; n<count; n++) {
    const p = join(root,store(n))
    await mkdir(p)
    await writeFile(join(p,'record.html'),HTML)
    stores.set(store(n),clean(await stat(p)))
  }
  return {root,proof:{root:clean(await stat(root)),stores,files:new Map()}}
}
async function closed(paths) {
  for (const p of paths) await assert.rejects(stat(p),
    err => err.code === 'ENOENT')
}
const bad = err => err instanceof Error && err.message === 'Invalid frozen offline capture source'

test('independent cohort descriptor maximum 100 stores pins source bytes and releases all paths', async () => {
  await sandbox(async home => {
    const {root,proof} = await captures(home,100)
    const held=[]
    await withPinnedCaptureTree(root,async get=>{
      for(let n=0;n<100;n++) {
        const p=(await get(store(n)))('record')
        held.push(p)
        assert.equal(await readFile(p,'utf8'),HTML)
      }
    },proof)
    assert.equal(held.length,100)
    await closed(held)
  })
})
test('independent cohort descriptor 101st store refuses and releases first 100', async () => {
  await sandbox(async home=>{
    const {root,proof}=await captures(home,101)
    const held=[]
    await assert.rejects(withPinnedCaptureTree(root,async get=>{
      for(let n=0;n<101;n++) held.push((await get(store(n)))('record'))
    },proof),bad)
    assert.equal(held.length,100)
    await closed(held)
  })
})
test('independent late missing store attestation closes prior opened store',async()=>{
  await sandbox(async home=>{
    const {root,proof}=await captures(home,2)
    proof.stores.delete(store(1))
    let held
    await assert.rejects(withPinnedCaptureTree(root,async get=>{
      held=(await get(store(0)))('record')
      assert.equal(await readFile(held,'utf8'),HTML)
      await get(store(1))
    },proof),bad)
    assert.ok(held)
    await closed([held])
  })
})
test('independent forged original root identity refuses before cohort callback',async()=>{
  await sandbox(async home=>{
    const {root,proof}=await captures(home,1)
    proof.root.ino = -1
    let executed=false
    await assert.rejects(withPinnedCaptureTree(root,async()=>{executed=true},proof),bad)
    assert.equal(executed,false)
  })
})
test('independent pinned old root resolves unopened second store across ordinary root replacement',async()=>{
  await sandbox(async home=>{
    const {root,proof}=await captures(home,2)
    let first,second
    await withPinnedCaptureTree(root,async get=>{
      first=(await get(store(0)))('record')
      assert.equal(await readFile(first,'utf8'),HTML)
      await rename(root,join(home,'original-root'))
      await mkdir(root)
      await mkdir(join(root,store(1)))
      await writeFile(join(root,store(1),'record.html'),'BORROWED')
      second=(await get(store(1)))('record')
      assert.equal(await readFile(second,'utf8'),HTML)
    },proof)
    assert.equal(await readFile(join(root,store(1),'record.html'),'utf8'),'BORROWED')
    await closed([first,second])
  })
})
for(const [label,name] of [
  ['parent path','..'],['slash separator','x/y'],
  ['leading dot','.hidden'],['embedded newline','bad\nstore']
]){
  test('independent malformed '+label+' denied privately',async()=>{
    await sandbox(async home=>{
      const {root,proof}=await captures(home,1)
      await assert.rejects(withPinnedCaptureTree(root,async get=>{await get(name)},proof),bad)
    })
  })
}
test('independent second successful source missing proof prevents entering canonical inspector',async()=>{
  await sandbox(async home=>{
    const {root,proof}=await captures(home,1)
    const p=join(root,store(0))
    await writeFile(join(p,'first.html'),HTML)
    await writeFile(join(p,'second.html'),HTML)
    const records=['first','second'].map(id=>({
      id,supermarket:store(0),kind:'product',success:true,
      sha256:SHA,requestedUrl:'https://example.invalid/qa-only',
      capturedAt:'2026-10-14T00:00:00.000Z'
    }))
    const manifest={milestone:'M1 Data Feasibility',bounded:true,
      sourceCount:2,results:records}
    await writeFile(join(root,'manifest.json'),JSON.stringify(manifest))
    proof.files.set(store(0)+'\0first',clean(await stat(join(p,'first.html'))))
    let called=false
    await assert.rejects(inspectFrozenCaptureDirectory(root,manifest,
      async()=>{called=true},proof),bad)
    assert.equal(called,false)
    assert.equal(await readFile(join(p,'second.html'),'utf8'),HTML)
  })
})
