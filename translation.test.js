const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const segments = [
  {id:2, text:'In the past year, I want you to just raise your hand'},
  {id:3, text:"if you've experienced relatively little stress."},
  {id:4, text:'Anyone?'},
];
const chinese = ['回想过去一年，我想请你举一下手', '如果你经历的压力相对较小。', '有人吗？'];
function harness(reply) {
  let stored = {}, calls = [], active = 0, peak = 0;
  const context = vm.createContext({AbortController, setTimeout, clearTimeout, DEEPSEEK_MODEL:'test-model',
    loadSettings:async()=>({translationEnabled:true,deepseekApiKey:'test-key'}),
    chrome:{storage:{local:{get:async()=>structuredClone(stored),set:async data=>{stored=structuredClone(data);}}}},
    fetch:async(_,options)=>{
      const body=JSON.parse(options.body);
      const input=JSON.parse(body.messages[1].content);
      assert.deepEqual(Object.keys(input),['text'],'each request contains one isolated fragment');
      calls.push(input);active++;peak=Math.max(peak,active);
      try {
        const result=await reply(input.text);
        return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]})};
      } finally {active--;}
    },
  });
  const source=fs.readFileSync('background/translation.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export .*;\n/gm,'');
  vm.runInContext(source+'\nglobalThis.api={translateSegments,requestDeepSeekTranslations,getTranslationCacheId};',context);
  return {api:context.api,calls,setStored:data=>stored=data,getStored:()=>stored,getPeak:()=>peak};
}

(async()=>{
  const h=harness(async text=>{
    const index=segments.findIndex(segment=>segment.text===text);
    await new Promise(resolve=>setTimeout(resolve,[15,1,5][index]));
    // Deliberately return a wrong ID: IDs must be owned by the caller.
    return {id:999,sourceText:text,translatedText:chinese[index]};
  });
  const cacheId=h.api.getTranslationCacheId('video',segments[1].text);
  h.setStored({elt_translation_cache_v1:{version:1,entries:{[cacheId]:{translatedText:'有人吗？',createdAt:Date.now()}}}});
  const result=await h.api.translateSegments({videoId:'video',segments});
  assert.deepEqual(plain(result.translations),segments.map((segment,i)=>({id:segment.id,translatedText:chinese[i]})));
  assert.equal(h.calls.length,3,'old incorrect cache must not be reused');
  assert.equal(h.getPeak(),3);
  const stored=h.getStored().elt_translation_cache_v1;
  assert.equal(stored.version,2);
  assert.equal(stored.entries[cacheId].sourceText,segments[1].text);
  const cached=await h.api.translateSegments({videoId:'video',segments:[{...segments[1],id:51}]});
  assert.deepEqual(plain(cached.translations),[{id:51,translatedText:chinese[1]}]);
  assert.equal(h.calls.length,3,'valid same-source cache may be reused after subtitle renumbering');

  const wrong=harness(async text=>({sourceText:text===segments[1].text?'Anyone?':text,translatedText:'测试'}));
  const partial=await wrong.api.translateSegments({videoId:'video',segments});
  assert.deepEqual(plain(partial.translations.map(x=>x.id)),[2,4],'reject mismatched source without shifting successful neighbors');
  assert.equal(wrong.getStored().elt_translation_cache_v1.entries[cacheId],undefined,'never cache mismatched results');
  await assert.rejects(wrong.api.requestDeepSeekTranslations([segments[1]],'test-key'),/不对应/);

  const legacy=harness(async()=>({translations:[{id:2,translatedText:'合并的译文'}]}));
  await assert.rejects(legacy.api.requestDeepSeekTranslations([segments[0]],'test-key'),/不对应/);
  await assert.rejects(h.api.requestDeepSeekTranslations([{id:1,text:'A'},{id:'1',text:'B'}],'test-key'),/编号不能重复/);

  const concurrent=harness(async text=>{await new Promise(resolve=>setTimeout(resolve,2));return {sourceText:text,translatedText:'测试'};});
  const ten=Array.from({length:10},(_,id)=>({id,text:`Fragment ${id}`}));
  assert.equal((await concurrent.api.requestDeepSeekTranslations(ten,'test-key')).length,10);
  assert(concurrent.getPeak()<=3);
  console.log('Translation isolation, source binding, partial failure, concurrency and cache migration tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
