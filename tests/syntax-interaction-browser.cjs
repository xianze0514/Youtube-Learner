const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.__ELT_TEST__=true;
      HTMLMediaElement.prototype.play=async function(){this.mockPaused=false;};
      HTMLMediaElement.prototype.pause=function(){this.mockPaused=true;};
      Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return this.mockPaused!==false;}});
      Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{get(){return this.mockTime||0;},set(v){this.mockTime=v;}});
    });
    await page.route(/https:\/\/.*/,route=>route.abort());
    await page.goto('http://127.0.0.1:4178/preview.html?scenario=syntax');
    const sentence=page.locator('#elt-character-slots');
    const separators=sentence.locator('.elt-syntax-separator');
    const unit=id=>sentence.locator(`[data-syntax-id="${id}"]`);
    await unit('s.0').waitFor();
    const original=await sentence.textContent();
    const topColors=await sentence.locator('.elt-review-block').evaluateAll(nodes=>nodes.map(n=>n.style.getPropertyValue('--block-color')));
    assert.equal(await separators.count(),9,'all existing internal levels are visible without clicking');
    assert.equal(await page.locator('.elt-analysis-details[open]').count(),4,'structure opens by default while vocabulary stays closed');
    assert.equal(await unit('s.0').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.elt-analysis-block').first().locator(':scope > details').getAttribute('open'),'');
    await page.screenshot({path:'/tmp/elt-syntax-default-desktop.png'});
    // Clicking an already visible leaf selects its relationship without folding it.
    await unit('s.1.2.0').click();
    assert.equal(await separators.count(),9);
    assert.match(await page.locator('.elt-syntax-info').innerText(),/what.*前置宾语/);
    assert.match(await page.locator('.elt-syntax-info').innerText(),/do/);
    const selectedCard=page.locator('[data-node-id="s.1.2.0"]');
    assert(await selectedCard.isVisible());
    assert(await selectedCard.evaluate(n=>n.classList.contains('elt-analysis-selected')));
    assert.equal(await sentence.textContent(),original,'labels and separators never mutate source text');
    assert.equal(await sentence.locator('.elt-review-word').count(),15);
    assert.deepEqual(await sentence.locator('.elt-review-block').evaluateAll(nodes=>nodes.map(n=>n.style.getPropertyValue('--block-color'))),topColors);
    assert(await separators.evaluateAll(nodes=>nodes.every(n=>n.textContent==='' && n.getAttribute('aria-hidden')==='true')));
    assert(await separators.evaluateAll(nodes=>nodes.every(n=>n.closest('.elt-syntax-start')?.querySelector('.elt-review-word'))),'separator stays with next word');
    const copied=await sentence.evaluate(element=>{
      const selection=getSelection(), range=document.createRange();range.selectNodeContents(element);
      selection.removeAllRanges();selection.addRange(range);const text=selection.toString();selection.removeAllRanges();return text;
    });
    assert.equal(copied,original,'copying yields original sentence without visual dividers or labels');
    await page.locator('#elt-subtitles-tab').click();
    await page.locator('#elt-analysis-tab').click();
    assert.equal(await separators.count(),9,'panel switches preserve inline expansion');

    await page.getByRole('button',{name:'收起当前组',exact:true}).click();
    assert.equal(await separators.count(),7);
    await page.getByRole('button',{name:'收起全部',exact:true}).click();
    assert.equal(await separators.count(),0);
    assert.equal(await page.locator('.elt-analysis-details[open]').count(),0);
    await page.locator('#elt-subtitles-tab').click();
    await page.locator('#elt-analysis-tab').click();
    assert.equal(await separators.count(),0,'manual folding is not reset by rerendering');
    await page.evaluate(async()=>{
      await __ELT_TEST_API__.playSegment(0,'reviewingPlayback',false);
      __ELT_TEST_API__.state.phase='reviewing';
    });
    assert.equal(await separators.count(),0,'replay preserves manual folding');

    // Keyboard activation must not advance the exercise or start playback.
    await unit('s.0').focus();
    await page.keyboard.press('Enter');
    assert.equal(await separators.count(),3);
    assert.equal(await page.evaluate(()=>__ELT_TEST_API__.state.index),0);
    assert.equal(await page.evaluate(()=>__ELT_TEST_API__.state.phase),'reviewing');
    await page.keyboard.press('Enter');
    assert.equal(await separators.count(),0,'focused parent can be toggled again');
    await page.keyboard.press('Space');
    assert.equal(await separators.count(),3);
    assert.equal(await page.evaluate(()=>__ELT_TEST_API__.state.phase),'reviewing');

    // Panel disclosure controls the same structure without losing keyboard focus.
    const contentDetails=page.locator('.elt-analysis-block').nth(1).locator(':scope > details');
    await contentDetails.locator(':scope > summary').click();
    await page.waitForFunction(()=>document.querySelectorAll('.elt-syntax-separator').length===5);
    assert.equal(await unit('s.1').getAttribute('aria-expanded'),'true');
    await contentDetails.locator(':scope > summary').click();
    await page.waitForFunction(()=>document.querySelectorAll('.elt-syntax-separator').length===3);
    await unit('s.1').getByText('what',{exact:true}).click();
    await unit('s.1.2').getByText('what',{exact:true}).click();
    await unit('s.1.2.0').click();
    await page.screenshot({path:'/tmp/elt-syntax-dividers-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
    assert(await sentence.evaluate(n=>n.scrollWidth<=n.clientWidth),'expanded sentence fits narrow screen');
    assert(await separators.evaluateAll(nodes=>nodes.every(n=>{
      const word=n.parentElement.querySelector('.elt-review-word');
      const a=n.getBoundingClientRect(),b=word.getClientRects()[0];return a.top>=b.top-2 && a.bottom<=b.bottom+2;
    })),'no orphan separator on wrapped lines');
    await page.screenshot({path:'/tmp/elt-syntax-dividers-mobile.png',fullPage:true});

    // A new unsolved caption must not retain syntax controls or reveal an old answer.
    await page.evaluate(async()=>{
      const api=__ELT_TEST_API__;api.state.segments.push({id:1,text:'A new sentence.',startMs:6500,endMs:9000});
      await api.playSegment(1,'listening',false);
    });
    assert.equal(await page.locator('.elt-syntax-tools').count(),0);
    assert.equal(await separators.count(),0);
    assert.equal(await sentence.locator('.elt-review-word').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Inline syntax tests passed: recursive single dividers, labels, panel sync, collapse, keyboard, source copy, narrow wrapping and answer isolation.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
