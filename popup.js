(() => {
  const $ = id => document.getElementById(id);
  let busy = false;
  let currentTab = null;

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.error) throw new Error(response?.error || "扩展未响应，请重新加载扩展后重试");
    return response;
  }
  function showError(error) {
    $('status').hidden = false;
    $('status').className = 'error';
    $('status').textContent = error.message;
  }
  async function open(button, message) {
    if (busy) return;
    busy = true;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '正在打开…';
    try { await send(message); window.close(); }
    catch (error) { showError(error); }
    finally { busy = false; button.disabled = false; button.textContent = label; }
  }
  function text(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }
  function render(records) {
    $('video-count').textContent = records.length;
    $('sentence-count').textContent = records.reduce((sum, record) => sum + (record.progress?.completedIndices?.length || 0), 0);
    $('history').replaceChildren();
    $('empty').hidden = records.length > 0;
    for (const [index, record] of records.entries()) {
      const progress = record.progress;
      const completed = progress?.completedIndices?.length || 0;
      const finished = completed === record.total;
      const card = text('article', 'record', '');
      const heading = text('div', 'record-heading', '');
      const icon = text('div', 'video-icon', '▷');
      icon.setAttribute('aria-hidden', 'true');
      const info = text('div', 'record-info', '');
      const title = text('h2', '', record.title);
      title.title = record.title;
      const date = new Date(record.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      info.append(title, text('span', 'last-seen', `${index === 0 ? '最近学习 · ' : ''}${date}`));
      heading.append(icon, info);
      const counts = text('div', 'record-progress', '');
      counts.append(text('span', '', `已完成 ${completed} / ${record.total} 句`), text('span', '', `${Math.round(completed / record.total * 100)}%`));
      const bar = document.createElement('progress');
      bar.max = record.total;
      bar.value = completed;
      bar.setAttribute('aria-label', `${record.title}：已完成 ${completed} 句，共 ${record.total} 句`);
      const footer = text('div', 'record-footer', '');
      const button = text('button', 'primary', finished ? '回顾练习 ↗' : '继续学习 →');
      button.type = 'button';
      button.setAttribute('aria-label', `${finished ? '回顾' : '继续学习'}：${record.title}`);
      button.addEventListener('click', () => { void open(button, { type: 'ELT_RESUME_LEARNING', videoId: record.videoId }); });
      footer.append(text('span', '', finished ? '全部句子已完成' : `上次学到第 ${(progress?.index || 0) + 1} 句`), button);
      card.append(heading, counts, bar, footer);
      $('history').appendChild(card);
    }
    if (currentTab) $('start-current').textContent = records.some(record => currentTab.url.includes(`v=${record.videoId}`)) ? '继续学习' : '开始学习';
  }
  async function refresh() {
    try {
      const { records } = await send({ type: 'ELT_LIST_HISTORY' });
      render(records);
      $('status').hidden = true;
    } catch (error) { showError(error); }
  }
  $('settings').addEventListener('click', () => { void send({ type: 'ELT_OPEN_SETTINGS' }).catch(showError); });
  $('open-youtube').addEventListener('click', () => {
    void chrome.tabs.create({ url: 'https://www.youtube.com/' }).then(() => window.close()).catch(showError);
  });
  $('start-current').addEventListener('click', () => {
    if (currentTab) void open($('start-current'), { type: 'ELT_OPEN_CURRENT', tabId: currentTab.id });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(key => key.startsWith('elt_history_v1_'))) void refresh();
  });
  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab?.url || 'about:blank');
      if (url.origin === 'https://www.youtube.com' && url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || '')) {
        currentTab = tab;
        $('current-title').textContent = tab.title?.replace(/\s*-\s*YouTube$/, '') || '当前视频';
        $('current-video').hidden = false;
      }
    } catch { /* History remains available on pages without activeTab access. */ }
    await refresh();
  })();
})();
