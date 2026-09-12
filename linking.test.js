const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const data = {pick:['pɪk'],it:['ɪt'],up:['ʌp'],an:['æn'],honest:['ˈɑːnɪst'],
    university:['ˌjuːnɪˈvɜːrsəti'],one:['wʌn'],i:['aɪ'],am:['æm','əm'],
    bill:['bɪl'],as:['æz','əz'],wallet:['ˈwɑːlɪt'],and:['ænd','ənd'],
    apply:['əˈplaɪ'],stop:['stɑːp'],have:['hæv'],read:['riːd','red']};
  const calls = [], store = {};
  let active = 0, peak = 0;
  const context = vm.createContext({console,Map,Set,Date,Promise,
    chrome:{storage:{local:{get:async k=>({[k]:store[k]}),set:async x=>Object.assign(store,x)}}},
    lookupDictionaryWord:async (word, options)=>{
      assert.equal(options.phoneticsOnly,true);
      calls.push(word); active++; peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,2)); active--;
      if (word==='broken') throw new Error('network');
      return {word,phonetics:[{label:'美',text:data[word] ? `[ ${data[word].join('; ')} ]` : '美式发音'}]};
    },
  });
  for (const file of ['background/linking-rules.js','background/linking.js']) {
    vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
  }
  return {api:context,calls,store,peak:()=>peak};
}

(async()=>{
  const {api,calls,store,peak}=setup();
  assert.deepEqual(Array.from(api.phonemes('ˈkwestʃən')),['k','w','e','s','tʃ','ə','n']);
  assert.deepEqual(Array.from(api.phonemes('aɪ')),['aɪ']);
  assert.equal(api.parsePronunciations({word:'word',phonetics:[{label:'美',text:'美式发音'}]},'word').length,0);
  assert.equal(api.parsePronunciations({word:'wrong',phonetics:[{label:'美',text:'[wɜːrd]'}]},'word').length,0);
  const ask=text=>api.getLinkingHints({targetSentence:text});
  const pairs=(text,r)=>Array.from(r.links,l=>`${text.slice(l.leftStart,l.leftEnd)}|${text.slice(l.rightStart,l.rightEnd)}`);
  const text='Pick it up, pick it up.';
  const [a,b]=await Promise.all([ask(text),ask(text)]);
  assert.deepEqual(pairs(text,a),['Pick|it','it|up','pick|it','it|up']);
  assert.equal(a.links[2].leftStart,12,'repeated words use their own offsets');
  assert.equal(b.links.length,4);
  assert.equal(calls.length,3,'deduplicate words across concurrent sentences');
  await ask(text); assert.equal(calls.length,3,'reuse cached pronunciations');
  assert.equal((await ask('an honest')).links.length,1,'silent h is resolved by phonetics');
  assert.equal((await ask('an university')).links.length,0,'vowel spelling does not imply vowel sound');
  assert.equal((await ask('an one')).links.length,0);
  assert.equal((await ask('I am')).links.length,0,'optional vowel glides are outside the first release');
  assert.equal((await ask('pick, it')).links.length,0,'punctuation blocks a link');
  assert.equal((await ask('pick-it')).links.length,0,'do not link inside a compound');
  assert.equal((await ask('pick 2026 it')).links.length,0,'unknown tokens are not skipped across');
  assert.equal((await ask('billed as')).links.length,1,'derive a regular past tense from dictionary lemma');
  assert.equal((await ask("I've applied")).links.length,1,'contraction and past-tense fallback');
  assert.equal((await ask('wallets and')).links.length,1,'regular plurals');
  assert.equal(api.addInflection('stɑːp','ed'),'stɑːpt');
  assert.equal(api.addInflection('niːd','ed'),'niːdɪd');
  assert.equal(api.addInflection('bʌs','s'),'bʌsɪz');
  const partial=await ask('broken pick it');
  assert(partial.incomplete); assert.equal(partial.links.length,1,'a network error does not remove available links');
  const before=calls.filter(w=>w==='broken').length;
  await ask('broken pick it');
  assert.equal(calls.filter(w=>w==='broken').length,before+1,'network errors are not persisted');
  assert(Array.isArray(store.elt_linking_ipa_v1));
  assert(peak() <= 3,'all background phonetic queries share the concurrency limit');
  await assert.rejects(ask(''),/格式/);
  await assert.rejects(ask('a '.repeat(151)),/格式/);
  console.log('Linking tests passed: phonetics, offsets, boundaries, morphology, caching, deduplication and partial failures.');
})().catch(error=>{console.error(error);process.exitCode=1;});
