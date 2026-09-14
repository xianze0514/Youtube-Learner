const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fixtures = JSON.parse(fs.readFileSync('tests/fixtures/syntax-analysis.json', 'utf8'));
const phrase = orig => ({orig,type:'短语',role:'句内成分',relation:'属于当前句',trans:'释义',expl:'用法解释',children:[]});
const make = (text, children) => ({schemaVersion:2,
  explanation:{translation:'译文',meaning:'含义',grammar:'结构',status:'complete'},
  structure:{...phrase(text),role:'整句',children:children.map(item=>typeof item==='string'?phrase(item):item)},
  vocabulary:[],annotations:[]});
const text='Very very good.';
const fixture=make(text,['Very','very','good.']);
let replies=[], calls=0, result=fixture, fail=false, configured=true, finishReason='stop', lastBody;
const storage={elt_analysis_cache_v1:[{legacy:true}]};
const context=vm.createContext({console,Map,Date,AbortController,setTimeout,clearTimeout,
  DEEPSEEK_MODEL:'test-model', loadSettings:async()=>({deepseekApiKey:configured?'test-key':''}),
  chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async data=>Object.assign(storage,data)}}},
  fetch:async(_,options)=>{calls++;lastBody=JSON.parse(options.body);assert.equal(lastBody.stream,false);assert(options.signal);
    if(fail)return{ok:false,status:503};return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(replies.length ? replies.shift() : result)},finish_reason:finishReason}]})};},
});
vm.runInContext(fs.readFileSync('background/analysis.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nglobalThis.api={validateAnalysis,analyzeSentence};',context);
const {validateAnalysis,analyzeSentence}=context.api;
const plain = value => JSON.parse(JSON.stringify(value));
(async()=>{
  const parsed=validateAnalysis(fixture,text);
  assert.deepEqual(Array.from(parsed.blocks,b=>[b.start,b.end]),[[0,4],[5,9],[10,15]],'repeated words retain occurrence offsets');
  assert.throws(()=>validateAnalysis(make(text,['Ver','y very good.']),text),/单词内部/);
  assert.throws(()=>validateAnalysis(make(text,['Very','good.']),text),/不对应/);
  assert.throws(()=>validateAnalysis(make(text,['Very']),text),/完整原句/);
  assert.throws(()=>validateAnalysis(make(text,['very very good.']),text),/不对应/);
  assert.throws(()=>validateAnalysis({...fixture,explanation:{}},text),/不完整/);
  assert.throws(()=>validateAnalysis({...fixture,schemaVersion:1},text),/版本/);
  assert.throws(()=>validateAnalysis({...fixture,structure:phrase('wrong')},text),/不对应/);
  assert.throws(()=>validateAnalysis({...fixture,explanation:{...fixture.explanation,status:'guessed'}},text),/完整性/);

  // Hierarchical teaching units preserve exact coverage at every level.
  for (const sample of Object.values(fixtures)) {
    const normalized=validateAnalysis(sample,sample.structure.orig);
    assert.deepEqual(plain(validateAnalysis(normalized,sample.structure.orig)),plain(normalized),'cache revalidation is idempotent');
    const visit=node=>{
      assert.equal(sample.structure.orig.slice(node.start,node.end),node.orig);
      for (const child of node.children){assert(child.start>=node.start && child.end<=node.end);visit(child);}
    };
    visit(normalized.structure);
  }
  const question=validateAnalysis(fixtures.question,fixtures.question.structure.orig);
  assert.equal(question.blocks.length,2,'coarse question structure has two groups, not one per word');
  const coordinated=question.blocks[1];
  assert.deepEqual(Array.from(coordinated.children,n=>n.orig),['who I was','or','what I was going to do?']);
  assert.equal(coordinated.children[2].children[2].orig,'was going to do?');
  assert.deepEqual(Array.from(question.annotations[0].parts,p=>p.orig),['did','have']);
  const wrongChild=make(text,[{...phrase('Very'),children:[phrase('Very very')]},phrase('very good.')]);
  assert.throws(()=>validateAnalysis(wrongChild,text),/父级/);
  assert.throws(()=>validateAnalysis(make('a b',[{...phrase('a b'),children:[phrase('a'),phrase('a b')]}]),'a b'),/不对应/);
  let deep=phrase('word');
  for(let i=0;i<8;i++)deep={...phrase('word'),children:[deep]};
  assert.throws(()=>validateAnalysis({...make('word',[]),structure:deep},'word'),/层级/);
  assert.throws(()=>validateAnalysis(make('word',Array(151).fill('word')),'word'),/节点/);
  assert.throws(()=>validateAnalysis(make('word',[{...phrase('word'),children:null}]),'word'),/内部结构/);

  // Punctuation stays in the original text, with no punctuation teaching cards.
  const quotedText='which is, “Were you born with this?”';
  const quotedResult=make(quotedText,['which is,','“','Were','you','born with','this','?','”']);
  const quoted=validateAnalysis(quotedResult,quotedText);
  assert.deepEqual(Array.from(quoted.blocks,b=>b.orig),['which is,','Were','you','born with','this']);
  assert.deepEqual(plain(validateAnalysis(quoted,quotedText)),plain(quoted));
  assert.equal(validateAnalysis(make('“Very,” — (very) … good!?',['Very','very','good']),'“Very,” — (very) … good!?').blocks.length,3);
  assert.throws(()=>validateAnalysis(make('“”',['“','”']),'“”'),/不对应/);
  for(const [source,children] of [["Don't",['Don',"'t"]],['re-enter',['re','-','enter']]]) {
    assert.throws(()=>validateAnalysis(make(source,children),source),/单词内部/);
  }
  assert.equal(validateAnalysis(make("Don't re-enter 2026!",["Don't",'re-enter','2026!']),"Don't re-enter 2026!").blocks.length,3);
  const fragment=make('because of the weather',[]);fragment.explanation.status='fragment';
  assert.equal(validateAnalysis(fragment,'because of the weather').blocks.length,1,'single fragment root is a usable display group');

  // Overlapping lessons and discontinuous expressions do not alter structural blocks.
  const separated=make('She turned the light off.',['She','turned','the light','off.']);
  separated.annotations=[{kind:'expression',title:'turn off',expl:'分离的短语动词',parts:[{orig:'turned',occurrence:1},{orig:'off',occurrence:1}]}];
  assert.equal(validateAnalysis(separated,separated.structure.orig).blocks[2].orig,'the light');
  const repeated=plain(fixture);
  repeated.vocabulary=[{orig:'very',occurrence:1,lemma:'very',pos:'副词',morphology:'原形',trans:'非常'}];
  assert.equal(validateAnalysis(repeated,text).vocabulary[0].start,5);
  const insideOtherWord=make('the he',['the','he']);
  insideOtherWord.vocabulary=[{orig:'he',occurrence:1,lemma:'he',pos:'代词',morphology:'原形',trans:'他'}];
  assert.equal(validateAnalysis(insideOtherWord,'the he').vocabulary[0].start,4,'occurrence ignores matches inside longer words');
  const identical=make('go go',['go','go']);
  identical.annotations=[{kind:'grammar',title:'重复',expl:'第二次出现',parts:[{orig:'go',occurrence:2}]}];
  assert.equal(validateAnalysis(identical,'go go').annotations[0].parts[0].start,3);
  identical.annotations[0].parts[0].occurrence=3;
  assert.throws(()=>validateAnalysis(identical,'go go'),/引用/);
  const bad=plain(separated);bad.annotations[0].parts.reverse();
  assert.throws(()=>validateAnalysis(bad,bad.structure.orig),/顺序/);
  bad.annotations[0].parts=[{orig:'urn',occurrence:1}];
  assert.throws(()=>validateAnalysis(bad,bad.structure.orig),/引用/);
  bad.annotations[0].parts=[{orig:'invented',occurrence:1}];
  assert.throws(()=>validateAnalysis(bad,bad.structure.orig),/引用/);

  // Regression: a valid parent with a contraction split below it used to reject the entire lesson.
  const contracted=plain(fixtures.contractions);
  const contractedText=contracted.structure.orig;
  contracted.structure.children[0].children=[phrase('She'),phrase("'s like,")];
  contracted.structure.children[1].children=[phrase('I'),phrase("'m giving"),phrase('the mentalist'),phrase('nothing.')];
  assert.throws(()=>validateAnalysis(contracted,contractedText),error=>error.code==='WORD_BOUNDARY' && error.sourceSpan==='She');
  const partial=validateAnalysis(contracted,contractedText,{allowPartial:true});
  assert.equal(partial.partialStructure,true);
  assert.equal(partial.blocks.length,2,'safe outer clause groups survive');
  assert.equal(partial.blocks[0].children.length,0);
  assert.equal(partial.blocks[1].children.length,0);
  assert.equal(partial.explanation.translation,contracted.explanation.translation);
  assert.equal(partial.structure.orig,contractedText);
  assert.equal(partial.vocabulary[0].orig,"She's");
  const ordinarySplit=make('hello world',[{...phrase('hello'),children:[phrase('hel'),phrase('lo')]},phrase('world')]);
  const ordinaryPartial=validateAnalysis(ordinarySplit,'hello world',{allowPartial:true});
  assert.equal(ordinaryPartial.blocks[0].orig,'hello','partial mode does not display fragments even in ordinary words');
  assert.equal(ordinaryPartial.blocks[1].orig,'world');
  assert.throws(()=>validateAnalysis(make(text,['Very','good.']),text,{allowPartial:true}),/不对应/,'partial mode still rejects missing source words');
  const curly=make('She’s ready.',[{...phrase('She’s'),children:[phrase('She'),phrase('’s')]},phrase('ready.')]);
  assert.equal(validateAnalysis(curly,'She’s ready.',{allowPartial:true}).blocks[0].children.length,0);

  const request={targetSentence:text,previousSentence:'I tried.'};
  await Promise.all([analyzeSentence(request),analyzeSentence(request)]);
  assert.equal(calls,1,'deduplicate concurrent requests');
  assert.match(lastBody.messages[0].content,/hierarchy of clauses/);
  assert.match(lastBody.messages[0].content,/NONCONTIGUOUS/);
  assert.equal(lastBody.messages[1].content,JSON.stringify({...request,followingSentence:''}));
  await analyzeSentence(request);assert.equal(calls,1,'reuse normalized cache');
  assert.equal(storage.elt_analysis_cache_v2.length,1);
  assert.deepEqual(storage.elt_analysis_cache_v1,[{legacy:true}],'old flat cache is ignored');
  await analyzeSentence({...request,previousSentence:'New context'});assert.equal(calls,2);
  configured=false;assert.equal((await analyzeSentence(request)).apiKeyRequired,true);configured=true;
  fail=true;await assert.rejects(analyzeSentence({...request,previousSentence:'Failure'}),/503/);
  fail=false;await analyzeSentence({...request,previousSentence:'Failure'});assert.equal(calls,4);
  result=make(text,['Wrong sentence.']);
  await assert.rejects(analyzeSentence({...request,previousSentence:'Bad output'}),/不对应/);
  assert.equal(storage.elt_analysis_cache_v2.length,3,'invalid output is not cached');
  result=fixture;finishReason='length';
  await assert.rejects(analyzeSentence({...request,previousSentence:'Truncated'}),/截断/);
  finishReason='stop';
  const cached=storage.elt_analysis_cache_v2.find(entry=>entry.key.includes('I tried.'));
  cached.analysis.schemaVersion=1;
  const before=calls;await analyzeSentence(request);assert.equal(calls,before+1,'malformed cache refreshes');
  result=fixtures.question;
  await analyzeSentence({targetSentence:result.structure.orig});
  const beforeQuestion=calls;await analyzeSentence({targetSentence:result.structure.orig});assert.equal(calls,beforeQuestion);
  const repairRequest={targetSentence:contractedText,previousSentence:'Correction succeeds'};
  replies=[contracted,fixtures.contractions];
  const beforeRepair=calls;
  const repaired=await analyzeSentence(repairRequest);
  assert.equal(calls,beforeRepair+2,'one corrective request for a word-boundary failure');
  assert.equal(repaired.analysis.partialStructure,false);
  assert.equal(lastBody.messages.length,4);
  assert.equal(JSON.parse(lastBody.messages[3].content).offendingSpan,'She');
  assert(lastBody.messages[0].content.includes("I'm"));
  await analyzeSentence(repairRequest);assert.equal(calls,beforeRepair+2,'corrected complete result is cached');
  result=contracted;
  const partialRequest={targetSentence:contractedText,previousSentence:'Repeated invalid subdivision'};
  const beforePartial=calls;
  const partialResponse=await analyzeSentence(partialRequest);
  assert.equal(calls,beforePartial+2,'invalid correction stops after one retry');
  assert.equal(partialResponse.analysis.partialStructure,true);
  assert(!storage.elt_analysis_cache_v2.some(entry=>entry.key.includes('Repeated invalid subdivision')),'partial results never become a seven-day cache hit');
  result=fixtures.contractions;
  const completeResponse=await analyzeSentence(partialRequest);
  assert.equal(calls,beforePartial+3,'manual retry can fetch a complete response immediately');
  assert.equal(completeResponse.analysis.partialStructure,false);
  await assert.rejects(analyzeSentence({targetSentence:'x'.repeat(2001)}),/格式/);
  console.log('Syntax hierarchy, coverage, word boundaries, source references, fragment handling, cache isolation and request lifecycle passed.');
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
