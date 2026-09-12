const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const calls=[]; let frames=0;
  const state={overlay:{},videoId:'one',segments:[{text:'Pick it up.'},{text:'Read it.'}],index:0,
    completedIndices:new Set(),settings:{apiKeyConfigured:false},elements:{}};
  const context=vm.createContext({requestAnimationFrame:()=>++frames,cancelAnimationFrame:()=>{},
    chrome:{runtime:{sendMessage:message=>new Promise(resolve=>calls.push({message,resolve}))}}});
  vm.runInContext(fs.readFileSync('content/review.js','utf8'),context);
  const review=context.EnglishListeningTyping.createReviewController(state,{},{});
  return {state,review,calls,frames:()=>frames};
}
(async()=>{
  const t=setup();
  t.review.prefetchLinking();t.review.prefetchLinking();await settle();
  assert.equal(t.calls.length,1,'no model key required; requests deduplicate');
  assert.equal(t.calls[0].message.type,'ELT_LINKING_HINTS');
  t.calls[0].resolve({links:[]});await settle();
  assert.equal(t.frames(),0,'unsolved answers never draw arcs');
  t.review.prefetchLinking();await settle();assert.equal(t.calls.length,1);
  t.state.index=1;t.review.prefetchLinking();await settle();
  t.state.index=0;t.state.completedIndices.add(0);
  t.calls[1].resolve({links:[]});await settle();
  assert.equal(t.frames(),0,'late responses cannot annotate a different sentence');
  t.state.segments=[{text:'Pick it up.'}];t.review.prefetchLinking();await settle();
  t.calls[2].resolve({links:[]});await settle();
  assert.equal(t.frames(),1,'current completed sentence draws on arrival');
  t.review.clearLinking();
  t.state.segments=[{text:'Pick it up.'}];t.review.prefetchLinking();await settle();
  t.state.overlay=null;t.calls[3].resolve({links:[]});await settle();
  assert.equal(t.frames(),1,'closing the exercise prevents late drawing');
  const failed=setup();failed.review.prefetchLinking();await settle();
  failed.calls[0].resolve({error:'offline'});await settle();
  failed.review.prefetchLinking();await settle();assert.equal(failed.calls.length,1,'no rapid retry loop');
  console.log('Linking review tests passed: key independence, deduplication, answer lock, navigation, sessions and failures.');
})().catch(error=>{console.error(error);process.exitCode=1;});
