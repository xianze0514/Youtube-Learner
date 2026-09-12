const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const EXT = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VIDEO = 'RcGyVTAoXEU';

async function testSessions() {
  const stored = {}, calls = [], tabs = new Map([[1, {id:1, windowId:2, url:`https://www.youtube.com/watch?v=${VIDEO}`}]]);
  let removed, failRule = false, count = 100;
  const chrome = {
    runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getURL: path => `${EXT}/${path}` },
    storage: { session: {
      set: async items => Object.assign(stored, structuredClone(items)),
      get: async key => key === null ? structuredClone(stored) : {[key]: structuredClone(stored[key])},
      remove: async keys => { for (const key of [].concat(keys)) delete stored[key]; },
    } },
    tabs: {
      create: async props => { const tab = {id:++count, ...props}; tabs.set(tab.id,tab); calls.push(['create',props]); return tab; },
      get: async id => { if (!tabs.has(id)) throw Error('closed'); return tabs.get(id); },
      update: async (id,props) => { Object.assign(tabs.get(id),props); calls.push(['update',id,props]); },
      remove: async id => { tabs.delete(id); calls.push(['remove',id]); await removed(id); },
      onRemoved: {addListener: fn => {removed=fn;}},
    },
    windows: {update: async (...args) => calls.push(['focus',...args])},
    scripting: {executeScript: async data => calls.push(['pause',data.target.tabId])},
    declarativeNetRequest: { updateSessionRules: async rule => { calls.push(['rule',rule]); if (failRule && rule.addRules) throw Error('rule failure'); } },
  };
  const context = vm.createContext({chrome, URL, Map, crypto: {randomUUID:()=>'session-'+count},
    readPlayerData: async () => ({videoId:VIDEO,currentTime:42,title:'TED'}),
    fetchTranscriptInPage: async (tabId,options) => ({tabId,options}),
    isTrustedExtensionPage: sender => sender.id===chrome.runtime.id && sender.url.startsWith(EXT+'/'),
  });
  const source=fs.readFileSync('background/learning.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  vm.runInContext(source+'\nglobalThis.api={openLearningTab,handleLearningMessage};', context);
  const api = context.api;
  await assert.rejects(api.openLearningTab({id:2,url:'https://example.com/watch?v='+VIDEO}), /YouTube/);
  const first=api.openLearningTab(tabs.get(1)), second=api.openLearningTab(tabs.get(1));
  assert.equal(first,second,'rapid repeated clicks must share one launch');
  await first;
  assert.equal(calls.filter(c=>c[0]==='create').length,1);
  const entry=Object.values(stored)[0];
  const sender={id:chrome.runtime.id,url:`${EXT}/learning.html?session=${entry.sessionId}`,tab:{id:entry.learningTabId},frameId:0};
  const session=(await api.handleLearningMessage({type:'ELT_GET_LEARNING'},sender)).session;
  assert.equal(session.startTime,42);
  const rule=calls.find(c=>c[0]==='rule'&&c[1].addRules)[1].addRules[0];
  assert.deepEqual(Array.from(rule.condition.tabIds),[entry.learningTabId]);
  assert.equal(rule.condition.urlFilter,'|https://www.youtube.com/embed/');
  assert.deepEqual(Array.from(rule.condition.resourceTypes),['sub_frame']);
  assert.equal(rule.action.requestHeaders[0].header,'Referer');
  assert(calls.findIndex(c=>c[0]==='pause')>calls.findIndex(c=>c[0]==='update'),'do not pause original until destination opens');
  await assert.rejects(api.handleLearningMessage({type:'ELT_GET_LEARNING'},{...sender,tab:{id:999}}),/失效/);
  await assert.rejects(api.handleLearningMessage({type:'ELT_GET_LEARNING'},{...sender,url:'https://www.youtube.com/'}),/无权/);
  await assert.rejects(api.handleLearningMessage({type:'ELT_OPEN_LEARNING'},{...sender,frameId:4}),/入口/);
  const prepared={segments:[{startMs:1000,endMs:2000,text:'Hello.'}],trackLabel:'English'};
  await api.handleLearningMessage({type:'ELT_CACHE_LEARNING',prepared},sender);
  tabs.delete(1);
  assert.equal((await api.handleLearningMessage({type:'ELT_GET_LEARNING'},sender)).session.prepared.segments[0].text,'Hello.','cached captions survive source close');
  await assert.rejects(api.handleLearningMessage({type:'ELT_LEARNING_TRANSCRIPT'},sender),/保持原/);
  await api.handleLearningMessage({type:'ELT_RETURN_SOURCE'},sender);
  assert.equal(calls.at(-1)[1].url,`https://www.youtube.com/watch?v=${VIDEO}`);
  await removed(entry.learningTabId);
  assert.equal(Object.keys(stored).length,0,'closing learning tab removes cached session');
  failRule=true;
  const pauses=calls.filter(c=>c[0]==='pause').length;
  await assert.rejects(api.openLearningTab({id:9,url:`https://www.youtube.com/watch?v=${VIDEO}`}),/rule failure/);
  assert.equal(calls.filter(c=>c[0]==='pause').length,pauses,'failed launch keeps source playing');
  assert.equal(Object.keys(stored).length,0,'failed launch cleans session');
}

async function testBridge() {
  let listener;
  const sent=[];
  const frame={contentWindow:{postMessage: message=>sent.push(message)},remove(){this.removed=true;}};
  const context=vm.createContext({URLSearchParams,location:{origin:EXT},crypto:{randomUUID:()=> 'channel'},
    document:{createElement:()=>frame},window:{addEventListener:(_,fn)=>listener=fn,removeEventListener:()=>{}},setTimeout:()=>1,clearTimeout:()=>{}});
  vm.runInContext(fs.readFileSync('learning-player.js','utf8'),context);
  const video=context.EnglishListeningTyping.createYouTubeVideo({appendChild:()=>{}},VIDEO,10);
  const deliver=(data,other={})=>listener({source:frame.contentWindow,origin:EXT,data:{channel:'channel',...data},...other});
  deliver({type:'ready'},{origin:'https://www.youtube.com'});
  await assert.rejects(video.playSegment(10,12),/尚未/);
  deliver({type:'ready'});
  await video.ready;
  await video.playSegment(10,12);
  const request=sent.at(-1).request;
  deliver({type:'state',request:request-1,time:50,positionReady:true});
  assert.equal(video.currentTime,10);
  deliver({type:'state',request,time:50,positionReady:false});
  assert.equal(video.currentTime,10,'a seek must not accept stale pre-seek position');
  deliver({type:'state',request,time:11,positionReady:true,duration:100,rate:1,paused:false,ended:false});
  assert.equal(video.currentTime,11);
  deliver({type:'state',request,time:12,positionReady:true,paused:true,ended:true});
  assert.equal(video.ended,true);
  video.destroy();
  deliver({type:'state',request,time:20,positionReady:true,ended:true});
  assert.equal(video.currentTime,12);
  assert.equal(frame.removed,true);
}

function testPlayerBoundary() {
  let listener, tick, options, time=80, paused=0;
  const messages=[];
  const player={getCurrentTime:()=>time,getPlayerState:()=>1,getDuration:()=>100,getPlaybackRate:()=>1,
    seekTo:()=>{}, playVideo:()=>{}, pauseVideo:()=>paused++,setPlaybackRate:()=>{}};
  const parent={postMessage: data=>messages.push(data)};
  const context=vm.createContext({URLSearchParams,location:{origin:EXT,hash:'#channel=channel&video='+VIDEO},parent,
    window:{addEventListener:(type,fn)=>{if(type==='message')listener=fn;}},
    setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{},
    YT:{Player:function(_,opts){options=opts;return player;}}});
  vm.runInContext(fs.readFileSync('player.js','utf8'),context);
  context.window.onYouTubeIframeAPIReady(); options.events.onReady();
  const command={channel:'channel',type:'command',command:'segment',value:{start:10,end:12},request:1};
  listener({source:parent,origin:'https://attacker.example',data:command});
  tick(); assert.equal(messages.at(-1).request,0);
  listener({source:parent,origin:EXT,data:command});
  tick(); assert.equal(paused,0,'stale pre-seek position cannot finish the sentence');
  time=10.1;tick();assert.equal(messages.at(-1).positionReady,true);
  time=12;tick();assert.equal(paused,1);assert.equal(messages.at(-1).ended,true);
  tick();assert.equal(paused,1,'pause once per sentence');
}

async function testLauncher() {
  let observer, calls=0, resolveLaunch;
  const buttons=[];
  const caption={caption:true};
  const makeControls=()=>({children:[caption],querySelector:()=>caption,
    insertBefore(button,before){this.children.splice(this.children.indexOf(before),0,button);button.parentElement=this;}});
  let controls=makeControls();
  const location={pathname:'/watch',href:'https://www.youtube.com/watch?v='+VIDEO};
  const context=vm.createContext({URL,location,requestAnimationFrame:fn=>fn(),
    MutationObserver:function(fn){observer=fn;this.observe=()=>{};},
    document:{documentElement:{},addEventListener:()=>{},querySelector:()=>controls,
      getElementById:id=>buttons.find(b=>b.id===id&&b.parentElement),
      createElement:()=>{const button={listeners:{},setAttribute:()=>{},appendChild:()=>{},
        addEventListener(type,fn){this.listeners[type]=fn;},
        remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(b=>b!==this);this.parentElement=null;}};buttons.push(button);return button;}},
    chrome:{runtime:{getURL:path=>EXT+'/'+path,sendMessage:()=>{calls++;return new Promise(resolve=>resolveLaunch=resolve);}}}
  });
  vm.runInContext(fs.readFileSync('content/launcher.js','utf8'),context);
  const first=controls.children[0];
  assert.equal(first.id,'elt-launch-learning');assert.equal(controls.children[1],caption);
  observer();observer();assert.equal(controls.children.length,2,'DOM mutations must not duplicate the entry');
  const event={preventDefault(){},stopPropagation(){}};
  const launch=first.listeners.click(event);await first.listeners.click(event);
  assert.equal(calls,1);assert.equal(first.disabled,true);
  resolveLaunch({ok:true});await launch;assert.equal(first.disabled,false);
  controls=makeControls();observer();
  assert.equal(controls.children[0].id,'elt-launch-learning','reinsert when YouTube rebuilds player controls');
  location.pathname='/';observer();assert.equal(controls.children.length,1,'remove on navigation away from videos');
  location.pathname='/watch';observer();assert.equal(controls.children.length,2,'restore after SPA navigation back');
}

function testManifest() {
  const manifest=JSON.parse(fs.readFileSync('manifest.json'));
  assert.equal(manifest.content_scripts[0].js[0],'content/launcher.js');
  for(const script of manifest.content_scripts[0].js) assert(fs.existsSync(script));
  for(const html of ['learning.html','player.html']) {
    const source=fs.readFileSync(html,'utf8');
    for(const [,url] of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert(!url.startsWith('https:'),'extension pages must not load remote executable resources');
      assert(fs.existsSync(url),url+' missing');
    }
  }
  assert(!manifest.sandbox,'YouTube needs its normal origin to initialize');
}

(async()=>{await testSessions();await testBridge();testPlayerBoundary();await testLauncher();testManifest();console.log('Learning launch, session isolation, playback boundary and manifest tests passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
