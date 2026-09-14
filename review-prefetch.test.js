const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(count = 25) {
  const calls = [];
  let changes = 0;
  const state = {overlay:{},segments:Array.from({length:count},(_,i)=>({text:`Sentence ${i}.`})),
    videoId:'video',index:0,settings:{apiKeyConfigured:true,translationEnabled:false},
    completedIndices:new Set(),elements:{}};
  const context = vm.createContext({chrome:{runtime:{sendMessage:input=>new Promise(resolve=>calls.push({input,resolve}))}}});
  vm.runInContext(fs.readFileSync('content/review.js','utf8'),context);
  const review = context.EnglishListeningTyping.createReviewController(state,{}, {onChange:()=>changes++});
  return {state,review,calls,changes:()=>changes};
}
const success = {analysis:{schemaVersion:2,structure:{},explanation:{},blocks:[{orig:'Sentence'}]}};
const settle = async(call,response=success)=>{call.resolve(response);await new Promise(resolve=>setImmediate(resolve));};

(async()=>{
  const {state,review,calls,changes} = setup();
  review.prefetchAnalysis();
  assert.deepEqual(calls.map(c=>c.input.targetSentence),['Sentence 0.','Sentence 1.','Sentence 2.']);
  assert.equal(calls[0].input.previousSentence,'');
  assert.equal(calls[0].input.followingSentence,'Sentence 1.');
  assert.equal(calls[1].input.previousSentence,'Sentence 0.');
  review.prefetchAnalysis();
  assert.equal(calls.length,3,'rerenders reuse in-flight requests');
  for (let i=0;i<10;i++) await settle(calls[i]);
  assert.equal(calls.length,10,'preload only the current ten-sentence window');
  assert.equal(changes(),0,'prefetch results never reveal an unsolved answer');
  state.completedIndices.add(0);
  review.prefetchAnalysis();
  assert.equal(calls.length,10,'solving uses the prefetched result without requesting again');
  state.index=1;
  review.prefetchAnalysis();
  assert.equal(calls.length,11,'moving forward replenishes the window');
  assert.equal(calls[10].input.targetSentence,'Sentence 10.');
  await settle(calls[10]);
  state.index=0;
  review.prefetchAnalysis();
  assert.equal(calls.length,11,'moving back reuses prior results');

  const jump=setup();
  jump.review.prefetchAnalysis();
  jump.state.index=15;
  jump.review.prefetchAnalysis();
  assert.equal(jump.calls.length,3,'navigation respects the concurrency cap');
  await settle(jump.calls[0]);
  assert.equal(jump.calls[3].input.targetSentence,'Sentence 15.','new current sentence precedes stale queued work');
  jump.state.completedIndices.add(15);
  await settle(jump.calls[3]);
  assert.equal(jump.changes(),1,'a solved current sentence updates as soon as its result arrives');
  jump.state.overlay=null;
  const beforeClose=jump.calls.length;
  for (const call of jump.calls) await settle(call);
  assert.equal(jump.calls.length,beforeClose,'closing stops queued prefetch');

  const disabled=setup(2);
  disabled.state.settings.apiKeyConfigured=false;
  disabled.review.prefetchAnalysis();
  assert.equal(disabled.calls.length,0,'no requests without an API key');
  disabled.state.settings.apiKeyConfigured=true;
  disabled.review.prefetchAnalysis();
  assert.equal(disabled.calls.length,2,'adding an API key enables prefetch even with translation disabled');
  await settle(disabled.calls[0],{error:'network failure'});
  await settle(disabled.calls[1]);
  disabled.review.prefetchAnalysis();
  assert.equal(disabled.calls.length,2,'failed prefetch is not retried on every render');

  const session=setup(1);
  session.review.prefetchAnalysis();
  session.state.overlay={};
  session.state.segments=[{text:'Sentence 0.'}];
  session.state.completedIndices.add(0);
  session.review.prefetchAnalysis();
  assert.equal(session.calls.length,2);
  await settle(session.calls[0]);
  assert.equal(session.changes(),0,'old session results cannot update a reopened exercise');
  await settle(session.calls[1]);
  assert.equal(session.changes(),1);
  console.log('Review prefetch tests passed: window, concurrency, context, deduplication, navigation, answer lock, settings, errors and session isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
