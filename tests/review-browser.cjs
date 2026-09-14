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
      if(message.type==='ELT_ANALYZE_SENTENCE' && message.targetSentence===__ELT_TEST_API__.state.segments[0].text) window.afterLoadAnalysisCalls++;
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
  await page.locator('.elt-analysis-heading').first().scrollIntoViewIfNeeded();
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
  const phrase=orig=>({orig,type:'短语',role:'句内成分',relation:'属于当前片段',trans:'释义',expl:'用法解释',children:[]});
  const analysis=validationContext.validateAnalysis({
    schemaVersion:2,
    explanation:{translation:'也就是，“你天生就是这样吗？”',meaning:'询问天赋。',grammar:'一般过去时疑问句。',status:'fragment'},
    structure:{...phrase(quotedText),children:['which is,','“','Were','you','born with','this','?','”'].map(phrase)},
    vocabulary:[],annotations:[],
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

  assert.match(await page.locator('.elt-analysis-notice').innerText(),/字幕片段/);

  // Reported failure: preserve usable parent groups if the model splits contractions.
  const contractionFixture=JSON.parse(fs.readFileSync('tests/fixtures/syntax-analysis.json','utf8')).contractions;
  const brokenContractions=JSON.parse(JSON.stringify(contractionFixture));
  brokenContractions.structure.children[0].children=[phrase('She'),phrase("'s like,")];
  brokenContractions.structure.children[1].children=[phrase('I'),phrase("'m giving"),phrase('the mentalist'),phrase('nothing.')];
  const partialContractions=validationContext.validateAnalysis(brokenContractions,contractionFixture.structure.orig,{allowPartial:true});
  const completeContractions=validationContext.validateAnalysis(contractionFixture,contractionFixture.structure.orig);
  await page.goto('http://127.0.0.1:4178/preview.html');
  await page.evaluate(async({partial,complete,text})=>{
    const original=chrome.runtime.sendMessage;
    window.contractionRequests=0;
    chrome.runtime.sendMessage=message=>{
      if(message.type==='ELT_ANALYZE_SENTENCE' && message.targetSentence===text) {
        return Promise.resolve({analysis:++window.contractionRequests===1?partial:complete});
      }
      return original(message);
    };
    const api=__ELT_TEST_API__;
    api.state.segments[0].text=text;
    api.state.settings.translationEnabled=false;
    api.state.completedIndices.add(0);
    await api.playSegment(0,'reviewingPlayback',false);
  },{partial:partialContractions,complete:completeContractions,text:contractionFixture.structure.orig});
  await page.locator('#elt-analysis-tab').click();
  await page.getByRole('button',{name:'重试完整结构',exact:true}).waitFor();
  assert.equal(await page.getByText('暂时无法生成详解',{exact:true}).count(),0);
  assert.equal(await page.locator('.elt-review-block').count(),2);
  assert.equal(await page.locator('.elt-analysis-block > details').count(),0,'unsafe child splits are not exposed');
  assert.equal(await page.locator('#elt-character-slots').textContent(),contractionFixture.structure.orig);
  assert((await page.locator('.elt-review-word').allTextContents()).includes("She's"));
  await page.getByRole('button',{name:'重试完整结构',exact:true}).click();
  await page.waitForFunction(()=>window.contractionRequests===2 && !document.querySelector('.elt-analysis-notice'));
  await page.waitForFunction(()=>document.querySelectorAll('.elt-syntax-separator').length===2);
  assert((await page.locator('.elt-analysis-child-source').allTextContents()).includes("I'm giving"));
  assert.equal(await page.locator('#elt-character-slots').textContent(),contractionFixture.structure.orig);
  await page.screenshot({path:'/tmp/elt-contraction-recovery.png'});

  // The user's question is grouped into a frame + embedded coordinated content,
  // with internal clauses visible by default and separate nonlocal relations.
  const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/syntax-analysis.json','utf8'));
  const questionText=fixtures.question.structure.orig;
  await page.goto('http://127.0.0.1:4178/preview.html?scenario=syntax');
  await page.waitForFunction(()=>document.querySelectorAll('.elt-review-block').length===2);
  await page.locator('#elt-analysis-tab').click();
  assert.deepEqual(await page.locator('.elt-review-block').allTextContents(),['did you have any idea','who I was or what I was going to do?']);
  assert.equal(await page.locator('.elt-analysis-notice').count(),0);
  assert.equal(await page.locator('.elt-review-word').count(),15,'word lookup remains independent of grouping');
  assert.equal(await page.locator('.elt-analysis-block > .elt-analysis-details[open]').count(),2,'both outer groups show their internal structure by default');
  const contentGroup=page.locator('.elt-analysis-block').nth(1);
  assert(await contentGroup.getByText('who I was',{exact:true}).isVisible());
  const secondClause=contentGroup.locator('.elt-analysis-child').filter({has:page.locator('.elt-analysis-child-source',{hasText:/^what I was going to do\?$/})}).first();
  assert(await secondClause.getByText('was going to do?',{exact:true}).isVisible());
  assert(await secondClause.getByText('动词结构 · 谓语部分',{exact:true}).isVisible());
  await page.locator('#elt-subtitles-tab').click();
  await page.locator('#elt-analysis-tab').click();
  assert.equal(await page.locator('.elt-analysis-details[open]').count(),4,'all open levels survive panel switching');
  const reference=page.getByRole('button',{name:'在原句中标出：did … have',exact:true});
  await reference.focus();
  assert.deepEqual(await page.locator('.elt-word-related').allTextContents(),['did','have'],'only linked spans highlighted; subject is not swallowed');
  await page.locator('#elt-analysis-tab').focus();
  assert.equal(await page.locator('.elt-word-related').count(),0);
  await page.getByText('词汇与词形 · 2 个词',{exact:true}).click();
  assert(await page.locator('.elt-analysis-vocabulary').first().isVisible());
  await page.locator('.elt-analysis-block').nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/elt-syntax-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/elt-syntax-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'nested structure fits narrow screens');
  assert(await page.evaluate(()=>{const panel=document.querySelector('.elt-analysis-panel');return panel.scrollWidth<=panel.clientWidth;}),'expanded cards have no horizontal overflow');

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
