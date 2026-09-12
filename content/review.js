(() => {
  const namespace = (globalThis.EnglishListeningTyping ||= {});
  const COLORS = ["#c4b5fd", "#7dd3fc", "#6ee7b7", "#fcd34d", "#fda4af", "#fdba74", "#a5b4fc", "#67e8f9"];
  const PRELOAD_SIZE = 10;
  const CONCURRENCY = 3;
  namespace.createReviewController = (state, dictionary, { openSettings, onChange }) => {
    const entries = new Map();
    let queue = [];
    let activeRequests = 0;
    let sessionOverlay, sessionSegments, sessionVideoId;
    let wordNodes = [];
    let activeWord = null;
    const linkingEntries = new Map();
    let linkingSession, linkingVideoId, observedContainer, linkingFrame = 0;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleLinking) : null;
    const solved = () => state.completedIndices.has(state.index);
    const requestData = (index = state.index) => ({ targetSentence: state.segments[index]?.text || "",
      previousSentence: state.segments[index - 1]?.text || "",
      followingSentence: state.segments[index + 1]?.text || "" });
    const keyFor = (index = state.index) => JSON.stringify([state.videoId, requestData(index)]);
    const currentEntry = () => entries.get(keyFor());
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const color = (element, index) => element.style.setProperty("--block-color", COLORS[index % COLORS.length]);

    function prefetchLinking() {
      if (!state.overlay || !state.segments[state.index]) return;
      if (linkingSession !== state.segments || linkingVideoId !== state.videoId) {
        linkingEntries.clear();
        linkingSession = state.segments;
        linkingVideoId = state.videoId;
      }
      const text = state.segments[state.index].text;
      const cached = linkingEntries.get(text);
      if (cached && (!cached.retryAt || Date.now() < cached.retryAt)) return;
      const entry = { links: [] };
      linkingEntries.set(text, entry);
      while (linkingEntries.size > 150) linkingEntries.delete(linkingEntries.keys().next().value);
      const segments = state.segments, overlay = state.overlay;
      Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ELT_LINKING_HINTS", targetSentence: text }))
        .then(result => {
          if (result?.error || !Array.isArray(result?.links)) throw new Error("连读提示暂不可用");
          entry.links = result.links;
          if (result.incomplete) entry.retryAt = Date.now() + 30000;
        }).catch(() => { entry.retryAt = Date.now() + 30000; })
        .finally(() => {
          if (state.overlay === overlay && state.segments === segments && linkingEntries.get(text) === entry &&
              state.segments[state.index]?.text === text && solved()) scheduleLinking();
        });
    }

    function scheduleLinking() {
      if (linkingFrame || !state.overlay || !solved()) return;
      linkingFrame = requestAnimationFrame(() => { linkingFrame = 0; drawLinking(); });
    }

    function clearLinking() {
      if (linkingFrame) cancelAnimationFrame(linkingFrame);
      linkingFrame = 0;
      resizeObserver?.disconnect();
      observedContainer = null;
      state.elements.characterSlots?.querySelector(".elt-linking-layer")?.remove();
    }

    function drawLinking() {
      const container = state.elements.characterSlots;
      if (!container?.isConnected || !solved() || !container.classList.contains("elt-review-sentence")) return;
      container.querySelector(".elt-linking-layer")?.remove();
      const links = linkingEntries.get(state.segments[state.index]?.text)?.links || [];
      if (!links.length) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("elt-linking-layer");
      svg.setAttribute("aria-hidden", "true");
      const box = container.getBoundingClientRect();
      for (const link of links) {
        const left = wordNodes.find(w => w.start === link.leftStart && w.end === link.leftEnd)?.element;
        const right = wordNodes.find(w => w.start === link.rightStart && w.end === link.rightEnd)?.element;
        if (!left || !right) continue;
        // No arcs across line breaks, split words, or unexpectedly distant spans.
        if (left.getClientRects().length !== 1 || right.getClientRects().length !== 1) continue;
        const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
        if (Math.abs(a.bottom - b.bottom) > 3 || b.left < a.right - 1 || b.left - a.right > 40) continue;
        const x1 = a.right - box.left - 4, x2 = b.left - box.left + 4;
        const y = Math.max(a.bottom, b.bottom) - box.top + 7;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y} Q ${(x1 + x2) / 2} ${y + 12} ${x2} ${y}`);
        path.dataset.leftStart = String(link.leftStart);
        path.dataset.rightStart = String(link.rightStart);
        svg.append(path);
      }
      if (svg.childNodes.length) container.append(svg);
    }

    function prefetchAnalysis() {
      if (sessionOverlay !== state.overlay || sessionSegments !== state.segments || sessionVideoId !== state.videoId) {
        entries.clear();
        queue = [];
        sessionOverlay = state.overlay;
        sessionSegments = state.segments;
        sessionVideoId = state.videoId;
      }
      if (!state.overlay || !state.settings.apiKeyConfigured) { queue = []; return; }
      // Rebuild the waiting queue around the current sentence after navigation.
      // In-flight, successful and failed entries are reused; errors retry explicitly.
      queue = [];
      for (let index = state.index; index < Math.min(state.segments.length, state.index + PRELOAD_SIZE); index++) {
        const key = keyFor(index);
        if (!entries.has(key)) queue.push({ key, input: requestData(index) });
      }
      drainQueue();
    }

    function drainQueue() {
      if (!state.overlay || !state.settings.apiKeyConfigured || state.overlay !== sessionOverlay ||
          state.segments !== sessionSegments || state.videoId !== sessionVideoId) return;
      while (activeRequests < CONCURRENCY && queue.length) {
        const job = queue.shift();
        if (!entries.has(job.key)) void requestAnalysis(job);
      }
    }

    function ensureAnalysis(retry = false) {
      if (retry && !currentEntry()?.loading) entries.delete(keyFor());
      prefetchAnalysis();
    }

    async function requestAnalysis({ key, input }) {
      const entry = { loading: true };
      entries.set(key, entry);
      activeRequests++;
      if (key === keyFor() && solved()) renderPanel();
      try {
        const result = await chrome.runtime.sendMessage({ type: "ELT_ANALYZE_SENTENCE", ...input });
        if (result?.error) throw new Error(result.error);
        if (result?.apiKeyRequired) throw new Error("请先在设置中配置 DeepSeek API Key");
        if (!result?.analysis?.blocks?.length) throw new Error("未收到句子详解，请重试");
        entry.analysis = result.analysis;
      } catch (error) { entry.error = error.message || "句子详解暂时不可用"; }
      entry.loading = false;
      activeRequests--;
      // A late response must never replace another sentence or a new exercise.
      if (state.overlay === sessionOverlay && state.segments === sessionSegments && state.videoId === sessionVideoId &&
          entries.get(key) === entry && key === keyFor() && solved()) onChange();
      drainQueue();
    }

    function addWords(parent, text, offset, timings) {
      for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu)) {
        const lookup = dictionary.cleanLookupWord(match[0]);
        if (!lookup) { parent.append(document.createTextNode(match[0])); continue; }
        const word = node("span", "elt-review-word", match[0]);
        word.tabIndex = 0;
        word.setAttribute("aria-label", `查询 ${lookup}`);
        word.addEventListener("pointerenter", () => dictionary.scheduleDictionaryLookup(lookup, word));
        word.addEventListener("pointerleave", dictionary.scheduleDictionaryClose);
        word.addEventListener("focus", () => dictionary.scheduleDictionaryLookup(lookup, word));
        word.addEventListener("blur", dictionary.scheduleDictionaryClose);
        const start = offset + match.index;
        const timing = timings.find(item => item.start === start && item.end === start + match[0].length);
        wordNodes.push({ element: word, timing, start, end: start + match[0].length });
        parent.append(word);
      }
    }

    function renderSentence() {
      const segment = state.segments[state.index];
      const container = state.elements.characterSlots;
      wordNodes = [];
      activeWord = null;
      container.replaceChildren();
      container.setAttribute("aria-label", "完整句子，可悬停或聚焦单词查词");
      const blocks = currentEntry()?.analysis?.blocks || [];
      let cursor = 0;
      for (const [index, block] of blocks.entries()) {
        if (block.start > cursor) addWords(container, segment.text.slice(cursor, block.start), cursor, segment.wordTimings || []);
        const span = node("span", "elt-review-block");
        color(span, index);
        span.dataset.blockIndex = String(index);
        addWords(span, segment.text.slice(block.start, block.end), block.start, segment.wordTimings || []);
        container.append(span);
        cursor = block.end;
      }
      addWords(container, segment.text.slice(cursor), cursor, segment.wordTimings || []);
      if (observedContainer !== container) {
        resizeObserver?.disconnect();
        resizeObserver?.observe(container);
        observedContainer = container;
        document.fonts?.ready.then(scheduleLinking);
      }
      prefetchLinking();
      scheduleLinking();
      updateHighlight();
      void ensureAnalysis();
    }

    function updateHighlight() {
      const time = (state.video?.currentTime || 0) * 1000;
      const playing = solved() && ["replaying", "reviewingPlayback"].includes(state.phase);
      const next = playing ? wordNodes.find(({ timing }) => timing && time >= timing.startMs && time < timing.endMs)?.element : null;
      if (next === activeWord) return;
      activeWord?.classList.remove("elt-word-playing");
      next?.classList.add("elt-word-playing");
      activeWord = next || null;
    }

    function renderPanel() {
      const { subtitleList, analysisPanel, subtitlesTab, analysisTab, panelFooter } = state.elements;
      if (!analysisPanel) return;
      const detail = state.panelView === "analysis";
      subtitleList.classList.toggle("elt-hidden", detail);
      analysisPanel.classList.toggle("elt-hidden", !detail);
      subtitlesTab.setAttribute("aria-selected", String(!detail));
      analysisTab.setAttribute("aria-selected", String(detail));
      subtitlesTab.tabIndex = detail ? -1 : 0;
      analysisTab.tabIndex = detail ? 0 : -1;
      panelFooter.textContent = detail ? "下划线与同色解释块一一对应" : "已完成字幕会自动显示，当前句与后续句保持隐藏";
      if (!detail) return;
      const key = keyFor();
      if (analysisPanel.dataset.sentenceKey !== key) analysisPanel.scrollTop = 0;
      analysisPanel.dataset.sentenceKey = key;
      analysisPanel.replaceChildren();
      const status = (title, body, action, callback) => {
        const box = node("div", "elt-analysis-status");
        box.append(node("strong", "", title), node("p", "", body));
        if (action) {
          const button = node("button", "elt-analysis-action", action);
          button.type = "button";
          button.addEventListener("click", callback);
          box.append(button);
        }
        analysisPanel.append(box);
      };
      if (!solved()) {
        status("答对后解锁单句详解", "先完成当前句的拼写，再查看翻译、语法和词组解析。");
        return;
      }
      if (!state.settings.apiKeyConfigured) {
        status("开启句子详解", "在设置中填写 DeepSeek API Key，练习时提前加载详解，答对后显示。", "打开设置", openSettings);
        return;
      }
      const entry = currentEntry();
      if (!entry || entry.loading) {
        status("正在拆解本句…", "翻译、语法和词组解释准备好后，会与原句的彩色下划线一起显示。");
        return;
      }
      if (entry.error) {
        status("暂时无法生成详解", entry.error, "重新生成", () => void ensureAnalysis(true));
        return;
      }
      const { explanation, blocks } = entry.analysis;
      const source = node("p", "elt-analysis-source", state.segments[state.index].text);
      analysisPanel.append(node("div", "elt-analysis-eyebrow", `第 ${state.index + 1} 句 · 单句详解`), source);
      for (const [key, title] of [["translation", "中文翻译"], ["meaning", "语义解释"], ["grammar", "语法要点"]]) {
        const section = node("section", "elt-analysis-section");
        section.append(node("h3", "", title), node("p", "", explanation[key]));
        analysisPanel.append(section);
      }
      analysisPanel.append(node("h3", "elt-analysis-heading", `词与短语 · ${blocks.length} 个块`));
      blocks.forEach((block, index) => {
        const section = node("section", "elt-analysis-block");
        color(section, index);
        section.dataset.blockIndex = String(index);
        const heading = node("div", "elt-analysis-block-heading");
        heading.append(node("span", "elt-analysis-chip", block.orig));
        if (block.baseform !== block.orig) heading.append(node("span", "elt-analysis-base", block.baseform));
        section.append(heading, node("div", "elt-analysis-pos", block.partofspeech),
          node("strong", "elt-analysis-trans", block.trans), node("p", "", block.expl));
        analysisPanel.append(section);
      });
    }

    function setPanelView(view) {
      state.panelView = view;
      renderPanel();
      if (view === "analysis") void ensureAnalysis();
    }
    return { renderSentence, renderPanel, setPanelView, updateHighlight, prefetchAnalysis, prefetchLinking, clearLinking };
  };
})();
