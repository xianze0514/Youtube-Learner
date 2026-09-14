const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const sent = [], statuses = [];
  const context = vm.createContext({ setTimeout, clearTimeout,
    chrome: { runtime: { sendMessage(message) { return new Promise(resolve => sent.push({message, resolve})); } } },
  });
  vm.runInContext(fs.readFileSync('content/progress.js', 'utf8'), context);
  const state = { index: 0, typedText: '', completedIndices: new Set(), sentenceMistakes: 0,
    totalMistakes: 0, phase: 'typing', soundEnabled: true, video: {playbackRate:1},
    segments: [{text:'Hello there.'}, {text:'Keep going.'}] };
  const progress = context.EnglishListeningTyping.createProgressController(state, (...args) => statuses.push(args));
  await progress.flush();
  assert.equal(sent.length, 0, 'preview/loading cannot write history before initialization');
  progress.enable();
  let pending = progress.flush(); sent.at(-1).resolve({ok:true}); await pending;
  assert.equal(sent.length, 1);
  await progress.flush();
  assert.equal(sent.length, 1, 'unchanged rendering does not keep writing storage');
  state.typedText='Hello';
  const typing=progress.flush();
  await progress.flush();
  assert.equal(sent.length, 2, 'an identical in-flight snapshot is deduplicated');
  state.typedText='';
  const deleting=progress.flush();
  assert.equal(sent.length, 3, 'deleting back to saved input must supersede an in-flight write');
  sent[1].resolve({ok:true}); await typing;
  sent[2].resolve({ok:true}); await deleting;
  state.totalMistakes=1;
  pending=progress.flush();sent.at(-1).resolve({error:'disk unavailable'});await pending;
  assert.equal(statuses.at(-1)[1],true,'failed storage is visible');
  pending=progress.flush();sent.at(-1).resolve({ok:true});await pending;
  assert.equal(statuses.at(-1)[1],false,'the same failed snapshot is retryable');
  assert.equal(progress.restore({index:99}),false,'invalid position cannot replace current state');
  assert.equal(progress.restore({index:1,typedText:'Keep ',completedIndices:[0,99],totalMistakes:3,sentenceMistakes:2,playbackRate:0.75,soundEnabled:false}),true);
  assert.equal(state.index,1);assert.equal(state.typedText,'Keep ');assert.equal(state.completedIndices.size,1);
  assert.equal(state.phase,'listening');assert.equal(state.video.playbackRate,0.75);assert.equal(state.soundEnabled,false);
  progress.restore({index:1,typedText:'wrong',completedIndices:[0,1],phase:'reviewing'});
  assert.equal(state.typedText,'');assert.equal(state.phase,'reviewing');
  progress.restore({index:1,completedIndices:[0,1],phase:'complete'});
  assert.equal(state.phase,'complete');
  console.log('Progress tests passed: initialization, write deduplication, in-flight edits, failures, retries and restoration.');
})().catch(error => { console.error(error); process.exitCode=1; });
