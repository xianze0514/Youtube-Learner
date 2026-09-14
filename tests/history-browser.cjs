const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = 'http://127.0.0.1:4178';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route(/https:\/\/.*/, route => route.abort());
    await context.route('**/learning-player.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      EnglishListeningTyping.createYouTubeVideo = () => ({ currentTime: 0, paused: true, playbackRate: 1,
        ready: Promise.resolve(), pause() { this.paused = true; }, destroy() {},
        playSegment(start) { this.currentTime = start; this.paused = false; return Promise.resolve(); } });
    ` }));
    await context.addInitScript(() => {
      window.__ELT_TEST__ = true;
      window.chrome = { runtime: {
        onMessage: { addListener() {} },
        async sendMessage(message) {
          const segments = [
            { id: 'a', text: 'Hello there.', startMs: 0, endMs: 2000 },
            { id: 'b', text: 'Keep going.', startMs: 3000, endMs: 5000 },
            { id: 'c', text: 'You can do it.', startMs: 6000, endMs: 8000 },
          ];
          if (message.type === 'ELT_GET_LEARNING') return { session: {
            videoId: 'RcGyVTAoXEU', sourceUrl: 'https://www.youtube.com/watch?v=RcGyVTAoXEU', title: 'Small steps, real progress',
            startTime: 3, prepared: { segments, trackLabel: 'English' },
            progress: JSON.parse(localStorage.getItem('progress') || 'null'),
          } };
          if (message.type === 'ELT_SAVE_PROGRESS') {
            if (window.failSave) return { error: '模拟存储失败' };
            localStorage.setItem('progress', JSON.stringify(message.progress));
            return { ok: true };
          }
          if (message.type === 'ELT_GET_SETTINGS') return { settings: { translationEnabled: false, apiKeyConfigured: false } };
          if (message.type === 'ELT_LINKING_HINTS') return { hints: [] };
          if (message.type === 'ELT_LIST_HISTORY') return { records: JSON.parse(localStorage.getItem('records') || '[]') };
          if (message.type === 'ELT_RESUME_LEARNING') { window.resumedVideo = message.videoId; return { error: '测试：已收到续学请求' }; }
          return { ok: true };
        }
      }, storage: { onChanged: { addListener() {} } },
      tabs: { async query() { return [{ id: 1, url: 'https://example.org/' }]; } } };
    });
    const page = await context.newPage();
    await page.goto(`${base}/learning.html?session=test&video=RcGyVTAoXEU`);
    await page.waitForFunction(() => window.__ELT_TEST_API__?.state.phase === 'listening');
    await page.evaluate(() => { __ELT_TEST_API__.state.video.currentTime = 5; });
    await page.waitForFunction(() => __ELT_TEST_API__.state.phase === 'typing');
    await page.keyboard.type('Keep ');
    await page.waitForFunction(() => JSON.parse(localStorage.progress).typedText === 'Keep ');
    await page.reload();
    await page.waitForFunction(() => window.__ELT_TEST_API__?.state.phase === 'listening');
    assert.equal(await page.evaluate(() => __ELT_TEST_API__.state.typedText), 'Keep ');
    assert.equal(await page.locator('#elt-counter').innerText(), '2 / 3');
    await page.evaluate(() => { __ELT_TEST_API__.state.video.currentTime = 5; });
    await page.waitForFunction(() => __ELT_TEST_API__.state.phase === 'typing');
    await page.keyboard.type('going');
    await page.waitForFunction(() => JSON.parse(localStorage.progress).completedIndices.includes(1));
    await page.reload();
    await page.waitForFunction(() => window.__ELT_TEST_API__?.state.phase === 'reviewing');
    assert.equal(await page.locator('#elt-phase-title').innerText(), '本句已完成');
    assert.equal(await page.evaluate(() => __ELT_TEST_API__.state.completedIndices.size), 1);
    await page.locator('#elt-skip').click();
    await page.evaluate(() => { __ELT_TEST_API__.state.video.currentTime = 8; });
    await page.waitForFunction(() => __ELT_TEST_API__.state.phase === 'typing');
    await page.keyboard.type('X');
    await page.waitForFunction(() => JSON.parse(localStorage.progress).totalMistakes === 1);
    await page.waitForFunction(() => !__ELT_TEST_API__.state.isResettingWord);
    await page.keyboard.type('You ');
    await page.waitForFunction(() => JSON.parse(localStorage.progress).typedText === 'You ');
    await page.locator('#elt-speed').click();
    await page.waitForFunction(() => JSON.parse(localStorage.progress).playbackRate === 1.25);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${base}/learning.html?session=test&video=RcGyVTAoXEU`);
    await reopened.waitForFunction(() => window.__ELT_TEST_API__?.state.phase === 'listening');
    assert.deepEqual(await reopened.evaluate(() => {
      const s = __ELT_TEST_API__.state;
      return [s.index, s.typedText, s.totalMistakes, s.completedIndices.size, s.video.playbackRate];
    }), [2, 'You ', 1, 1, 1.25]);
    await reopened.evaluate(() => { window.failSave = true; });
    await reopened.locator('#elt-speed').click();
    await reopened.getByText(/进度未保存：模拟存储失败/).waitFor();
    await reopened.evaluate(() => { window.failSave = false; });
    await reopened.locator('#elt-save-status').click();
    await reopened.getByText('进度已保存到本机').waitFor();
    await reopened.screenshot({ path: '/tmp/elt-history-learning.png' });
    // Display and interact with the real popup using stored record fixtures.
    await reopened.goto(`${base}/popup.html`);
    await reopened.locator('#empty:not([hidden])').waitFor();
    assert.equal(await reopened.locator('#video-count').innerText(), '0');
    await reopened.evaluate(() => localStorage.setItem('records', JSON.stringify([
      { videoId: 'RcGyVTAoXEU', title: 'How to speak so that people want to listen | Julian Treasure | TED', total: 148, updatedAt: Date.now(), progress: { index: 23, completedIndices: Array.from({length: 23}, (_, i) => i) } },
      { videoId: '8KkKuTCFvzI', title: 'What makes a good life? Lessons from the longest study on happiness', total: 120, updatedAt: Date.now() - 86400000, progress: { index: 9, completedIndices: [0, 1, 2, 3, 4, 5] } }
    ])));
    // Chrome measures a popup from a tiny initial viewport; its intrinsic width
    // must not shrink to that viewport before the browser resizes the window.
    await reopened.setViewportSize({ width: 100, height: 600 });
    await reopened.reload();
    assert.deepEqual(await reopened.evaluate(() => [document.documentElement.offsetWidth, document.body.offsetWidth]), [420, 420]);
    await reopened.setViewportSize({ width: 420, height: 660 });
    await reopened.reload();
    await reopened.locator('.record').first().waitFor();
    assert.equal(await reopened.locator('#sentence-count').innerText(), '29');
    assert.equal(await reopened.locator('#video-count').innerText(), '2');
    assert.match(await reopened.locator('.record').first().innerText(), /上次学到第 24 句/);
    assert(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await reopened.screenshot({ path: '/tmp/elt-history-popup.png', fullPage: true });
    await reopened.locator('.record button').first().click();
    assert.equal(await reopened.evaluate(() => resumedVideo), 'RcGyVTAoXEU');
    await reopened.getByText('测试：已收到续学请求').waitFor();
    assert.equal(await reopened.locator('.record button').first().isEnabled(), true);
    // The launcher belongs to the settings/fullscreen controls and survives replacement.
    await reopened.goto(`${base}/popup.html`);
    await reopened.route('https://www.youtube.com/watch?v=RcGyVTAoXEU', route => route.fulfill({ contentType: 'text/html', body: '<div id="movie_player"><div class="ytp-right-controls"><div class="ytp-right-controls-left"><button class="ytp-subtitles-button">字幕</button><button class="ytp-settings-button">设置</button></div><div class="ytp-right-controls-right"><button class="ytp-fullscreen-button">全屏</button></div></div></div>' }));
    await reopened.goto('https://www.youtube.com/watch?v=RcGyVTAoXEU');
    await reopened.evaluate(() => { chrome.runtime.getURL = path => 'http://127.0.0.1:4178/' + path; });
    await reopened.addScriptTag({ content: fs.readFileSync('content/launcher.js', 'utf8') });
    await reopened.addStyleTag({ content: fs.readFileSync('styles/launcher.css', 'utf8') });
    assert.equal(await reopened.evaluate(() => document.querySelector('.ytp-settings-button').previousElementSibling.id), 'elt-launch-learning');
    await reopened.evaluate(async () => { await document.querySelector('#movie_player').requestFullscreen(); });
    assert.equal(await reopened.locator('#elt-launch-learning').isVisible(), true);
    await reopened.evaluate(async () => {
      await document.exitFullscreen();
      document.querySelector('.ytp-right-controls').outerHTML = '<div class="ytp-right-controls"><button class="ytp-settings-button">设置</button></div>';
    });
    await reopened.locator('#elt-launch-learning').waitFor();
    assert.equal(await reopened.locator('#elt-launch-learning').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Browser history tests passed: partial typing, refresh, completion, close/reopen, mistakes, speed, storage failure/retry, popup, launcher placement and fullscreen.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
