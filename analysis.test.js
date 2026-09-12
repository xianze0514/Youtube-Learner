const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const phrase = orig => ({orig,baseform:orig,partofspeech:'短语',trans:'释义',expl:'用法解释'});
const fixture = {explanation:{translation:'这非常好。',meaning:'表达肯定。',grammar:'一般现在时。'},blocks:[phrase('Very'),phrase('very'),phrase('good.')]};
let calls=0, result=fixture, fail=false, configured=true;
const storage={};
const context=vm.createContext({console,Map,Date,AbortController,setTimeout,clearTimeout,
  DEEPSEEK_MODEL:'test-model', loadSettings:async()=>({deepseekApiKey:configured?'test-key':''}),
  chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async data=>Object.assign(storage,data)}}},
  fetch:async(_,options)=>{calls++;assert.equal(JSON.parse(options.body).stream,false);assert(options.signal);if(fail)return{ok:false,status:503};return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]})};},
});
vm.runInContext(fs.readFileSync('background/analysis.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nglobalThis.api={validateAnalysis,analyzeSentence};',context);
const {validateAnalysis,analyzeSentence}=context.api;
(async()=>{
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('Ver'),phrase('y very good.')]},'Very very good.'),/单词内部/);
  const parsed=validateAnalysis(fixture,'Very very good.');
  assert.deepEqual(Array.from(parsed.blocks,b=>[b.start,b.end]),[[0,4],[5,9],[10,15]],'duplicate words preserve each occurrence');
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('Very'),phrase('good.')]},'Very very good.'),/不对应/);
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('Very')]},'Very very good.'),/完整原句/);
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('very very good.')]},'Very very good.'),/不对应/);
  assert.throws(()=>validateAnalysis({...fixture,explanation:{}},'Very very good.'),/不完整/);
  const quotedText='which is, “Were you born with this?”';
  const quotedResult={...fixture,blocks:['which is,','“','Were','you','born with','this','?','”'].map(phrase)};
  const quoted=validateAnalysis(quotedResult,quotedText);
  assert.deepEqual(Array.from(quoted.blocks,b=>b.orig),['which is,','Were','you','born with','this']);
  for (const block of quoted.blocks) assert.equal(quotedText.slice(block.start,block.end),block.orig);
  assert.deepEqual(JSON.parse(JSON.stringify(validateAnalysis(quoted,quotedText))),JSON.parse(JSON.stringify(quoted)),
    'filtered analysis remains valid when loaded from cache');
  const separated=validateAnalysis({...fixture,blocks:[phrase('Very'),phrase('very'),phrase('good')]},'“Very,” — (very) … good!?');
  assert.deepEqual(Array.from(separated.blocks,b=>b.orig),['Very','very','good'],'punctuation gaps need no blocks');
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('Very'),phrase('good')]},'Very missing good.'),/不对应/);
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('Very')]},'Very missing.'),/完整原句/);
  assert.throws(()=>validateAnalysis({...fixture,blocks:[phrase('“'),phrase('”')]},'“”'),/词语拆解/);
  const contractions=["Don't",'re-enter','2026'];
  assert.deepEqual(Array.from(validateAnalysis({...fixture,blocks:contractions.map(phrase)},"Don't re-enter 2026!").blocks,b=>b.orig),contractions);
  assert.equal(validateAnalysis({...fixture,blocks:[{orig:'“'},phrase('Very'),{orig:'”'}]},'“Very”').blocks.length,1,
    'discarded punctuation does not require teaching metadata');
  const request={targetSentence:'Very very good.',previousSentence:'I tried.'};
  await Promise.all([analyzeSentence(request),analyzeSentence(request)]);
  assert.equal(calls,1,'concurrent same-sentence requests deduplicate');
  await analyzeSentence(request);assert.equal(calls,1,'reuse validated cache');
  await analyzeSentence({...request,previousSentence:'A new context.'});assert.equal(calls,2,'context belongs in cache key');
  configured=false;assert.equal((await analyzeSentence(request)).apiKeyRequired,true);configured=true;
  fail=true;await assert.rejects(analyzeSentence({...request,previousSentence:'Failure'}),/503/);
  fail=false;await analyzeSentence({...request,previousSentence:'Failure'});assert.equal(calls,4,'failed requests can retry');
  result={...fixture,blocks:[phrase('Wrong sentence.')]};
  await assert.rejects(analyzeSentence({...request,previousSentence:'Bad output'}),/不对应/);
  assert.equal(storage.elt_analysis_cache_v1.length,3,'invalid output is not cached');
  const quotedRequest={targetSentence:quotedText,previousSentence:'',followingSentence:''};
  storage.elt_analysis_cache_v1.push({key:JSON.stringify(['test-model',quotedRequest]),at:Date.now(),analysis:quotedResult});
  const beforeCacheRead=calls;
  const cachedQuoted=await analyzeSentence(quotedRequest);
  assert.equal(cachedQuoted.analysis.blocks.length,5,'old cached punctuation blocks are removed');
  assert.equal(calls,beforeCacheRead,'repair old cached data without another API request');
  result=quotedResult;
  const freshQuoted=await analyzeSentence({...quotedRequest,previousSentence:'Fresh response'});
  assert.equal(freshQuoted.analysis.blocks.length,5,'new API responses also discard punctuation blocks');
  const beforeFreshCacheRead=calls;
  await analyzeSentence({...quotedRequest,previousSentence:'Fresh response'});
  assert.equal(calls,beforeFreshCacheRead,'normalized results can be reused from cache');
  await assert.rejects(analyzeSentence({targetSentence:'x'.repeat(2001)}),/格式/);
  console.log('Analysis validation, duplicate spans, cache, context isolation, request deduplication and retries passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

const captionsContext=vm.createContext({Intl});
vm.runInContext(fs.readFileSync('content/captions.js','utf8'),captionsContext);
const {attachPlaybackWordTimings:attach,collectTimedTokens:collect}=captionsContext.EnglishListeningTyping.captions;
const segment={text:'Very very good.',startMs:0,endMs:1800};
const tokens=collect([{tokens:[{text:'Very',startMs:0,endMs:600},{text:'very',startMs:600,endMs:1000},{text:'good',startMs:1000,endMs:2400}]}]);
const mapped=attach([segment],tokens)[0];
assert.deepEqual(Array.from(mapped.wordTimings,w=>[w.start,w.end,w.startMs,w.endMs]),[[0,4,0,600],[5,9,600,1000],[10,14,1000,1800]]);
assert.equal(attach([segment],[])[0].wordTimings.length,0);
assert.equal(attach([segment],tokens.slice(0,1))[0].wordTimings.length,0);
assert.equal(attach([segment],tokens.map(t=>({...t,hasEstimatedStart:true})))[0].wordTimings.length,0);
assert.equal(segment.wordTimings,undefined,'do not mutate input captions');
