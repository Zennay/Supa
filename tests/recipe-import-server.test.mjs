import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { Readable } from 'node:stream'
import { publicAddress, recipeUrl, fetchRecipeHtml } from '../server/recipe-fetch.mjs'
import { createRecipeServer } from '../server/app.mjs'

test('URL intake refuses credentials, local names, literal IPs and private addresses', () => {
  for (const url of ['http://example.org/r','https://a:b@example.org/r','https://127.0.0.1/r','https://[::1]/','https://recipes.local/r','https://example.org:444/r','https://example.org/?api_key=secret']) assert.throws(() => recipeUrl(url))
  for (const ip of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','198.19.1.1','224.0.0.1','::ffff:127.0.0.1','::1','203.0.113.1']) assert.equal(publicAddress(ip), false, ip)
  assert.equal(publicAddress('93.184.216.34'), true)
  assert.equal(recipeUrl('https://recipes.example.org/r#steps').hash, '')
})
function transport(reply, seen = []) {
  return (url, options, callback) => {
    const req = new EventEmitter(); req.end = () => {
      options.lookup(url.hostname, {}, (error, address, family) => { assert.equal(error, null); seen.push({ address, family, headers: options.headers }) })
      queueMicrotask(() => {
        const { status = 200, headers = { 'content-type':'text/html' }, body = '<html>recipe</html>' } = reply(url)
        const res = Readable.from([Buffer.from(body)]); res.statusCode = status; res.headers = headers; callback(res)
      })
    }; return req
  }
}
test('DNS is pinned and credentials are never sent to the source', async () => {
  const seen = []
  const result = await fetchRecipeHtml('https://recipes.example.org/r', { resolve: async () => [{address:'93.184.216.34'}], request: transport(() => ({}), seen) })
  assert.equal(result.html,'<html>recipe</html>'); assert.equal(seen[0].address,'93.184.216.34'); assert.equal(seen[0].family,4)
  assert.equal(seen[0].headers.Cookie, undefined); assert.equal(seen[0].headers.Authorization, undefined)
})
test('redirects recheck DNS; private/mixed DNS, oversized HTML and slow DNS are rejected', async () => {
  let calls=0
  await assert.rejects(fetchRecipeHtml('https://recipes.example.org/r', { resolve: async host => [{address:host === 'recipes.example.org' ? '93.184.216.34':'127.0.0.1'}], request: transport(() => { calls++; return {status:302,headers:{location:'https://internal.example.org/r'}} }) }), /publiek/)
  assert.equal(calls,1)
  await assert.rejects(fetchRecipeHtml('https://recipes.example.org/r', { resolve: async () => [{address:'93.184.216.34'},{address:'10.0.0.1'}] }), /publiek/)
  await assert.rejects(fetchRecipeHtml('https://recipes.example.org/r', { resolve: async () => [{address:'93.184.216.34'}], request: transport(() => ({body:'a'.repeat(512001)})) }), /groot/)
  await assert.rejects(fetchRecipeHtml('https://recipes.example.org/r', { resolve: () => new Promise(() => {}), timeout:10 }), /lang/)
})
test('real HTTP route normalizes a recipe and refuses cross-origin requests before fetch', async () => {
  let calls=0
  const server = createRecipeServer({ origin:'https://supa.example.org', fetchHtml:async () => {calls++; return {sourceUrl:'https://recipes.example.org/r',html:'<script type="application/ld+json">'+JSON.stringify({'@type':'Recipe',name:'Soep',recipeYield:'2',totalTime:'PT25M',recipeIngredient:['0,5 l water','250 g wortels'],recipeInstructions:['Kook de soep.']})+'</script>'} } })
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/recipes/import`
    const denied=await fetch(url,{method:'POST',headers:{origin:'https://evil.example.org','content-type':'application/json'},body:'{}'})
    assert.equal(denied.status,403); assert.equal(calls,0)
    const ok=await fetch(url,{method:'POST',headers:{origin:'https://supa.example.org','content-type':'application/json'},body:JSON.stringify({url:'https://recipes.example.org/r'})})
    assert.equal(ok.status,200)
    const {draft}=await ok.json(); assert.equal(draft.title,'Soep'); assert.equal(draft.ingredients[0].amount,500); assert.equal(draft.ingredients[0].unit,'ml'); assert.deepEqual(draft.steps,['Kook de soep.'])
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)) }
})
