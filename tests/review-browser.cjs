const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
  const browser = await chromium.launch({headless:true,channel:"chrome"});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.addInitScript(() => {
    window.__ELT_TEST__=true;
    HTMLMediaElement.prototype.play=async function(){this.mockPaused=false;};
    HTMLMediaElement.prototype.pause=function(){this.mockPaused=true;};
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this.mockPaused !== false;}});
    Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{get(){return this.mockTime || 0;},set(v){this.mockTime=v;}});
  });
  await page.route(/https:\/\/.*/, route=>route.abort());
  await page.goto('http://127.0.0.1:4178/preview.html');
  await page.evaluate(()=>{
    const original=chrome.runtime.sendMessage;
    window.afterLoadAnalysisCalls=0;
    chrome.runtime.sendMessage=message=>{
      if(message.type==='ELT_ANALYZE_SENTENCE') window.afterLoadAnalysisCalls++;
      return original(message);
    };
  });
  await page.locator('#elt-analysis-tab').click();
  await page.getByText('答对后解锁单句详解').waitFor();
  assert.equal(await page.locator('.elt-review-word').count(),0);
  await page.locator('#elt-replay').click();
  assert.equal(await page.locator('.elt-review-word').count(),0, 'unsolved replay keeps slots');
  // Finish listening then really type the answer through the keyboard handler.
  await page.evaluate(()=>{__ELT_TEST_API__.state.video.currentTime=6.2;});
  await page.waitForFunction(()=>__ELT_TEST_API__.state.phase==='typing');
  await page.locator('#elt-subtitles-tab').click();
  await page.locator('#elt-practice').focus();
  await page.keyboard.type('Small steps every day lead to remarkable progress');
  await page.waitForFunction(()=>__ELT_TEST_API__.state.completedIndices.has(0));
  await page.waitForFunction(()=>document.querySelectorAll('.elt-review-block').length===4);
  assert.equal(await page.locator('#elt-subtitles-tab').getAttribute('aria-selected'),'true','no forced tab switch');
  assert.equal(await page.locator('.elt-character-slot').count(),0);
  assert.equal(await page.locator('.elt-dictation-meta').isVisible(),false);
  await page.locator('#elt-analysis-tab').click();
  assert.equal(await page.locator('.elt-analysis-chip').count(),4);
  assert.equal(await page.evaluate(()=>window.afterLoadAnalysisCalls),0,'analysis was prefetched before typing and opening the panel');
  const colors=await page.evaluate(()=>[...document.querySelectorAll('.elt-review-block')].map((e,i)=>[
    e.style.getPropertyValue('--block-color'),document.querySelectorAll('.elt-analysis-block')[i].style.getPropertyValue('--block-color')]));
  assert(colors.every(([a,b])=>a===b));
  // Replay uses source word times, not analysis phrase boundaries.
  await page.waitForTimeout(350);
  await page.evaluate(()=>{__ELT_TEST_API__.state.video.currentTime=1.2;});
  await page.waitForFunction(()=>document.querySelector('.elt-word-playing')?.textContent==='every');
  await page.evaluate(()=>{__ELT_TEST_API__.state.video.currentTime=1.8;});
  await page.waitForFunction(()=>document.querySelector('.elt-word-playing')?.textContent==='day');
  await page.locator('.elt-review-word').filter({hasText:/^remarkable$/}).hover();
  await page.locator('#elt-dictionary:not(.elt-hidden)').waitFor();
  assert.match(await page.locator('#elt-dictionary').innerText(),/remarkable/);
  await page.mouse.move(30,30);
  await page.evaluate(()=>{__ELT_TEST_API__.state.video.currentTime=6.2;});
  await page.waitForFunction(()=>__ELT_TEST_API__.state.phase==='reviewing');
  assert.equal(await page.locator('.elt-word-playing').count(),0);
  await page.waitForTimeout(900);
  await page.locator('.elt-analysis-heading').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/elt-review-desktop.png'});
  await page.locator('#elt-replay').click();
  await page.evaluate(()=>{__ELT_TEST_API__.state.video.currentTime=2.9;});
  await page.waitForFunction(()=>document.querySelector('.elt-word-playing')?.textContent==='to');
  assert.equal(await page.locator('.elt-analysis-source').innerText(),'Small steps every day lead to remarkable progress.');
  await page.locator('#elt-skip').click();
  await page.getByText('答对后解锁单句详解').waitFor();
  assert.equal(await page.locator('.elt-review-block').count(),0);
  assert.equal(await page.locator('.elt-analysis-source').count(),0);
  assert.equal(await page.locator('#elt-analysis-tab').getAttribute('aria-selected'),'true');
  // Delayed analysis cannot replace the next, unsolved sentence.
  await page.goto('http://127.0.0.1:4178/preview.html');
  await page.evaluate(async () => {
    const original=chrome.runtime.sendMessage;
    window.analysisCalls=0;
    chrome.runtime.sendMessage=message=>{
      if(message.type==='ELT_ANALYZE_SENTENCE' && message.targetSentence===__ELT_TEST_API__.state.segments[0].text) {
        window.analysisCalls++;
        return new Promise(resolve=>{window.finishAnalysis=async()=>resolve(await original(message));});
      }
      return original(message);
    };
    __ELT_TEST_API__.state.videoId='delayed-prefetch';
    await __ELT_TEST_API__.playSegment(0,'listening',true);
  });
  await page.waitForFunction(()=>window.analysisCalls===1);
  assert.equal(await page.locator('.elt-review-block').count(),0,'in-flight prefetch keeps the answer hidden');
  await page.evaluate(()=>{__ELT_TEST_API__.state.video.currentTime=6.2;});
  await page.waitForFunction(()=>__ELT_TEST_API__.state.phase==='typing');
  await page.keyboard.type('Small steps every day lead to remarkable progress');
  await page.waitForFunction(()=>window.analysisCalls===1);
  await page.locator('#elt-analysis-tab').click();
  await page.getByText('正在拆解本句…').waitFor();
  await page.locator('#elt-skip').click();
  await page.evaluate(()=>window.finishAnalysis());
  await page.getByText('答对后解锁单句详解').waitFor();
  assert.equal(await page.locator('.elt-analysis-chip').count(),0);
  assert.equal(await page.locator('.elt-review-block').count(),0);
  assert.equal(await page.evaluate(()=>window.analysisCalls),1);

  // No API key still allows completed-sentence lookup and replay.
  await page.evaluate(async()=>{
    const api=__ELT_TEST_API__;
    api.state.settings.apiKeyConfigured=false;
    api.state.completedIndices.add(1);
    await api.playSegment(1,'reviewingPlayback',false);
  });
  await page.getByText('开启句子详解').waitFor();
  assert((await page.locator('.elt-review-word').count())>0);
  assert.equal(await page.locator('.elt-character-slot').count(),0);
  assert.equal(await page.evaluate(()=>window.analysisCalls),1,'no request without a configured key');

  // Error state offers an explicit retry; rerenders must not retry automatically.
  await page.evaluate(async()=>{
    const original=chrome.runtime.sendMessage;
    chrome.runtime.sendMessage=async message=>{
      if(message.type==='ELT_ANALYZE_SENTENCE' && message.targetSentence===__ELT_TEST_API__.state.segments[1].text){window.analysisCalls++;return {error:'测试网络错误'};}
      return original(message);
    };
    const api=__ELT_TEST_API__;
    api.state.videoId='prefetch-error';
    api.state.settings.apiKeyConfigured=true;
    await api.playSegment(1,'reviewingPlayback',false);
  });
  await page.getByText('测试网络错误').waitFor();
  assert.equal(await page.evaluate(()=>window.analysisCalls),2);
  await page.locator('#elt-subtitles-tab').click();
  await page.locator('#elt-analysis-tab').click();
  assert.equal(await page.evaluate(()=>window.analysisCalls),2);
  await page.getByRole('button',{name:'重新生成'}).click();
  await page.waitForFunction(()=>window.analysisCalls===3);
  await page.getByText('测试网络错误').waitFor();

  // Exercise the real validator and renderer with the reported quotation case.
  const validationContext=vm.createContext({Map});
  vm.runInContext(fs.readFileSync('background/analysis.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''),validationContext);
  const quotedText='which is, “Were you born with this?”';
  const analysis=validationContext.validateAnalysis({
    explanation:{translation:'也就是，“你天生就是这样吗？”',meaning:'询问天赋。',grammar:'一般过去时疑问句。'},
    blocks:['which is,','“','Were','you','born with','this','?','”'].map(orig=>({orig,baseform:orig,partofspeech:'短语',trans:'释义',expl:'用法解释'})),
  },quotedText);
  await page.goto('http://127.0.0.1:4178/preview.html');
  await page.evaluate(async({text,analysis})=>{
    const original=chrome.runtime.sendMessage;
    chrome.runtime.sendMessage=message=>message.type==='ELT_ANALYZE_SENTENCE' ? Promise.resolve({analysis}) : original(message);
    const api=__ELT_TEST_API__;
    api.state.segments[0].text=text;
    api.state.completedIndices.add(0);
    await api.playSegment(0,'reviewingPlayback',false);
  },{text:quotedText,analysis});
  await page.waitForFunction(()=>document.querySelectorAll('.elt-review-block').length===5);
  await page.locator('#elt-analysis-tab').click();
  assert.deepEqual(await page.locator('.elt-analysis-chip').allTextContents(),['which is,','Were','you','born with','this']);
  assert.equal(await page.evaluate(()=>__ELT_TEST_API__.state.elements.characterSlots.textContent),quotedText,'source punctuation remains intact');
  assert(await page.evaluate(()=>[...document.querySelectorAll('.elt-review-block')].every((block,i)=>
    /[\p{L}\p{N}]/u.test(block.textContent) && block.style.getPropertyValue('--block-color')===
      document.querySelectorAll('.elt-analysis-block')[i].style.getPropertyValue('--block-color'))),'only lexical blocks are underlined, with matching card colors');

  await page.goto('http://127.0.0.1:4178/preview.html?scenario=review');
  await page.locator('.elt-review-block').first().waitFor();
  await page.locator('#elt-analysis-tab').click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/elt-review-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no mobile horizontal overflow');
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('Review browser tests passed: typing, replay, colors, panel lock, dictionary, late responses, missing key, retries and responsive layout.');
})().catch(error=>{console.error(error);process.exit(1);});
