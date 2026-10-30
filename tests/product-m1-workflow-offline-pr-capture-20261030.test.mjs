import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const file='.github/workflows/m1-data-capture.yml'
const source=readFileSync(file,'utf8')
const dispatch="github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
function condition(doc,name){
 const marker='      - name: '+name+'\n'
 const index=doc.indexOf(marker)
 assert.notEqual(index,-1,'missing required step '+name)
 const next=doc.indexOf('\n      - name: ',index+marker.length)
 const block=doc.slice(index,next<0?undefined:next)
 const conditions=[...block.matchAll(/^        if: (.+)$/gm)]
 assert.equal(conditions.length,1,'exactly one step condition: '+name)
 return conditions[0][1]
}
function validate(doc){
 assert.equal(condition(doc,'Capture representative public pages'),dispatch)
 for(const step of ['Inspect capture integrity and structured data',
  'Evaluate capture freshness evidence','Upload capture evidence'])
   assert.equal(condition(doc,step),'always() && '+dispatch,step)
 assert.equal(condition(doc,'Export sanitized product candidates'),
  dispatch+" && steps.inspect.outcome == 'success'")
 assert.equal(condition(doc,'Build M1 evidence summary'),
  dispatch+" && steps.inspect.outcome == 'success' && steps.freshness.outcome == 'success' && steps.export.outcome == 'success'")
 assert.ok(condition(doc,'Fail visibly when capture evidence fails').startsWith(dispatch+' && ('))
 assert.match(doc,/test "\$\(hostname -s\)" = "vps-bb300bba"/)
 assert.match(doc,/run: npm test/)
 assert.match(doc,/run: npm run m1:matching-benchmark/)
 assert.match(doc,/if-no-files-found: error/)
 assert.match(doc,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
}
test('PRs run self-hosted offline tests but never demand nonexistent live captures; main manual dispatch still requires evidence',()=>{
 validate(source)
 assert.ok(source.includes('      - "'+file+'"'))
 assert.ok(source.includes('      - "tests/product-m1-workflow-offline-pr-capture-20261030.test.mjs"'))
})
test('mutation of each capture evidence PR restriction is refused',()=>{
 for(const step of ['Inspect capture integrity and structured data',
  'Evaluate capture freshness evidence','Upload capture evidence']){
  const mutated=source.replace('      - name: '+step+'\n        if: always() && '+dispatch,
    '      - name: '+step+'\n        if: always()')
  assert.notEqual(mutated,source,step)
  assert.throws(()=>validate(mutated),undefined,step)
 }
})
