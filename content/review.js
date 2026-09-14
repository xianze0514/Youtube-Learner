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
    let syntaxTools;
    let syntaxNodes = new Map();
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
      syntaxTools?.remove();
      syntaxTools = null;
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
        if (result?.analysis?.schemaVersion !== 2 || !result.analysis.structure || !result.analysis.blocks?.length) throw new Error("未收到句子详解，请重试");
        entry.analysis = result.analysis;
        // Initialize once per analysis, so later renders preserve manual folding.
        entry.expanded = new Set();
        const expandStructure = block => {
          if (!block.children?.length) return;
          entry.expanded.add(block.id);
          block.children.forEach(expandStructure);
        };
        entry.analysis.blocks.forEach(expandStructure);
      } catch (error) { entry.error = error.message || "句子详解暂时不可用"; }
      entry.loading = false;
      activeRequests--;
      // A late response must never replace another sentence or a new exercise.
      if (state.overlay === sessionOverlay && state.segments === sessionSegments && state.videoId === sessionVideoId &&
          entries.get(key) === entry && key === keyFor() && solved()) onChange();
      drainQueue();
    }

    function addWords(parent, text, offset, timings, boundary = false) {
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
        if (boundary) {
          // Keep a visual separator with the next word across line wrapping.
          // It has no text, so copying/lookup/timing still use the original sentence.
          const start = node("span", "elt-syntax-start");
          const separator = node("span", "elt-syntax-separator");
          separator.setAttribute("aria-hidden", "true");
          start.append(separator, word);
          parent.append(start);
          boundary = false;
        } else parent.append(word);
      }
    }

    function selectStructure(block, toggle = false, focus = false) {
      const entry = currentEntry();
      if (!entry?.analysis || !solved()) return;
      const expanded = (entry.expanded ||= new Set());
      if (toggle && block.children.length) {
        if (expanded.has(block.id)) expanded.delete(block.id); else expanded.add(block.id);
      }
      entry.selectedNode = block.id;
      dictionary.scheduleDictionaryClose?.();
      state.panelView = "analysis";
      renderSentence();
      renderPanel();
      const panel = state.elements.analysisPanel;
      const card = [...panel.querySelectorAll("[data-node-id]")].find(item => item.dataset.nodeId === block.id);
      if (card) panel.scrollTop += card.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12;
      if (focus) {
        const unit = [...state.elements.characterSlots.querySelectorAll("[data-syntax-id]")]
          .find(item => item.dataset.syntaxId === block.id);
        unit?.focus({ preventScroll: true });
      }
    }

    function renderSyntaxTools(entry) {
      syntaxTools?.remove();
      syntaxTools = node("div", "elt-syntax-tools");
      const selected = syntaxNodes.get(entry.selectedNode);
      const info = node("div", "elt-syntax-info");
      info.setAttribute("aria-live", "polite");
      if (selected) {
        info.append(node("strong", "", `${selected.orig} · ${selected.type} · ${selected.role}`),
          node("span", "", selected.relation === selected.role ? selected.expl : selected.relation));
      } else info.append(node("span", "", "短竖线表示结构边界 · 点击成分查看关系"));
      syntaxTools.append(info);
      const expanded = (entry.expanded ||= new Set());
      let current = selected;
      while (current && !expanded.has(current.id)) current = syntaxNodes.get(current.id.slice(0, current.id.lastIndexOf(".")));
      if (current) {
        const target = current;
        const collapse = node("button", "", "收起当前组");
        collapse.type = "button";
        collapse.addEventListener("click", () => selectStructure(target, true, true));
        syntaxTools.append(collapse);
      }
      if ([...expanded].some(id => syntaxNodes.has(id))) {
        const reset = node("button", "", "收起全部");
        reset.type = "button";
        reset.addEventListener("click", () => {
          for (const id of syntaxNodes.keys()) expanded.delete(id);
          const block = entry.analysis.blocks[0];
          selectStructure(block, false, true);
        });
        syntaxTools.append(reset);
      }
      state.elements.characterSlots.after(syntaxTools);
    }

    function renderSentence() {
      const segment = state.segments[state.index];
      const container = state.elements.characterSlots;
      wordNodes = [];
      activeWord = null;
      container.replaceChildren();
      container.setAttribute("aria-label", "完整句子，可悬停或聚焦单词查词");
      const entry = currentEntry();
      const blocks = entry?.analysis?.blocks || [];
      const expanded = entry ? (entry.expanded ||= new Set()) : new Set();
      syntaxNodes = new Map();
      const remember = block => { syntaxNodes.set(block.id, block); block.children.forEach(remember); };
      blocks.forEach(remember);
      const text = segment.text, timings = segment.wordTimings || [];
      function renderUnit(block, boundary = false) {
        syntaxNodes.set(block.id, block);
        const unit = node("span", "elt-syntax-unit");
        unit.dataset.syntaxId = block.id;
        unit.tabIndex = 0;
        unit.setAttribute("role", "button");
        const open = block.children.length > 0 && expanded.has(block.id);
        if (block.children.length) unit.setAttribute("aria-expanded", String(open));
        unit.setAttribute("aria-label", `${block.orig}，${block.type}，${block.role}，${block.children.length ? (open ? "收起内部结构" : "展开内部结构") : "查看成分关系"}`);
        unit.title = `${block.type} · ${block.role}\n${block.relation}`;
        unit.classList.toggle("elt-syntax-selected", entry.selectedNode === block.id);
        if (open) {
          let cursor = block.start;
          block.children.forEach((child, index) => {
            if (child.start > cursor) addWords(unit, text.slice(cursor, child.start), cursor, timings);
            unit.append(renderUnit(child, index > 0 || boundary));
            cursor = child.end;
          });
          addWords(unit, text.slice(cursor, block.end), cursor, timings);
        } else addWords(unit, text.slice(block.start, block.end), block.start, timings, boundary);
        return unit;
      }
      let cursor = 0;
      for (const [index, block] of blocks.entries()) {
        if (block.start > cursor) addWords(container, text.slice(cursor, block.start), cursor, timings);
        const span = node("span", "elt-review-block");
        color(span, index);
        span.dataset.blockIndex = String(index);
        span.append(renderUnit(block));
        const activate = event => {
          if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
          if (event.type === "click" && document.getSelection()?.toString()) return;
          const target = event.target.closest("[data-syntax-id]");
          const selected = syntaxNodes.get(target?.dataset.syntaxId);
          if (!selected) return;
          event.preventDefault();
          event.stopPropagation();
          selectStructure(selected, true, true);
        };
        span.addEventListener("click", activate);
        span.addEventListener("keydown", activate);
        container.append(span);
        cursor = block.end;
      }
      addWords(container, text.slice(cursor), cursor, timings);
      if (blocks.length) renderSyntaxTools(entry);
      else { syntaxTools?.remove(); syntaxTools = null; }
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
      for (const word of wordNodes) word.element.classList.remove("elt-word-related");
      const detail = state.panelView === "analysis";
      subtitleList.classList.toggle("elt-hidden", detail);
      analysisPanel.classList.toggle("elt-hidden", !detail);
      subtitlesTab.setAttribute("aria-selected", String(!detail));
      analysisTab.setAttribute("aria-selected", String(detail));
      subtitlesTab.tabIndex = detail ? -1 : 0;
      analysisTab.tabIndex = detail ? 0 : -1;
      panelFooter.textContent = detail ? "同色下划线对应结构分组，短竖线表示内部边界" : "已完成字幕会自动显示，当前句与后续句保持隐藏";
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
        status("正在拆解本句…", "正在识别短语、从句及其关系，完成后显示结构分组。");
        return;
      }
      if (entry.error) {
        status("暂时无法生成详解", entry.error, "重新生成", () => void ensureAnalysis(true));
        return;
      }
      const { explanation, blocks, structure, annotations, vocabulary } = entry.analysis;
      const expanded = (entry.expanded ||= new Set());
      const source = node("p", "elt-analysis-source", state.segments[state.index].text);
      analysisPanel.append(node("div", "elt-analysis-eyebrow", `第 ${state.index + 1} 句 · 单句详解`), source);
      if (explanation.status !== "complete") {
        analysisPanel.append(node("p", "elt-analysis-notice", explanation.status === "fragment"
          ? "字幕片段 · 仅分析已出现的内容，不补全缺失成分。"
          : "存在歧义 · 以下按语境中较合理的读法分析，具体说明见结构解释。"));
      }
      if (entry.analysis.partialStructure) {
        const notice = node("div", "elt-analysis-notice");
        notice.append(node("p", "", "部分内部成分未能对齐原文，已保留上层结构及解释。"));
        const retry = node("button", "elt-analysis-action", "重试完整结构");
        retry.type = "button";
        retry.addEventListener("click", () => void ensureAnalysis(true));
        notice.append(retry);
        analysisPanel.append(notice);
      }
      for (const [key, title] of [["translation", "中文翻译"], ["meaning", "语义解释"]]) {
        const section = node("section", "elt-analysis-section");
        section.append(node("h3", "", title), node("p", "", explanation[key]));
        analysisPanel.append(section);
      }
      analysisPanel.append(node("h3", "elt-analysis-heading", `句法结构 · ${blocks.length} 个分组`));
      analysisPanel.append(node("p", "elt-analysis-overview", explanation.grammar));
      analysisPanel.append(node("p", "elt-analysis-root-type", structure.type));

      function disclosure(id, title) {
        const details = node("details", "elt-analysis-details");
        details.open = expanded.has(id);
        details.append(node("summary", "", title));
        details.addEventListener("toggle", () => {
          if (!details.isConnected || currentEntry() !== entry || expanded.has(id) === details.open) return;
          if (details.open) expanded.add(id); else expanded.delete(id);
          if (id !== "vocabulary" && solved()) {
            entry.selectedNode = id;
            renderSentence();
          }
        });
        return details;
      }
      function structureCard(block, index, nested = false) {
        const section = node("section", nested ? "elt-analysis-child" : "elt-analysis-block");
        color(section, index);
        section.dataset.nodeId = block.id;
        section.classList.toggle("elt-analysis-selected", entry.selectedNode === block.id);
        if (!nested) section.dataset.blockIndex = String(index);
        const heading = node("div", "elt-analysis-block-heading");
        heading.append(node("span", nested ? "elt-analysis-child-source" : "elt-analysis-chip", block.orig));
        section.append(heading, node("div", "elt-analysis-pos", `${block.type} · ${block.role}`),
          node("p", "elt-analysis-relation", block.relation),
          node("strong", "elt-analysis-trans", block.trans), node("p", "", block.expl));
        if (block.children?.length) {
          const details = disclosure(block.id, `展开内部结构 · ${block.children.length} 个成分`);
          const children = node("div", "elt-analysis-children");
          for (const child of block.children) children.append(structureCard(child, index, true));
          details.append(children);
          section.append(details);
        }
        return section;
      }
      blocks.forEach((block, index) => analysisPanel.append(structureCard(block, index)));

      if (annotations.length) {
        const section = node("section", "elt-analysis-annotations");
        section.append(node("h3", "elt-analysis-heading", "语法与表达"));
        for (const item of annotations) {
          const article = node("article", "elt-analysis-annotation");
          const kind = { grammar: "语法点", expression: "固定表达", relation: "结构关联" }[item.kind];
          const reference = node("button", "elt-analysis-reference", item.parts.map(part => part.orig).join(" … "));
          reference.type = "button";
          reference.setAttribute("aria-label", `在原句中标出：${reference.textContent}`);
          const mark = active => {
            for (const word of wordNodes) word.element.classList.toggle("elt-word-related", active &&
              item.parts.some(part => word.start >= part.start && word.end <= part.end));
          };
          reference.addEventListener("pointerenter", () => mark(true));
          reference.addEventListener("pointerleave", () => mark(document.activeElement === reference));
          reference.addEventListener("focus", () => mark(true));
          reference.addEventListener("blur", () => mark(false));
          article.append(node("div", "elt-analysis-pos", kind), node("h4", "", item.title), reference, node("p", "", item.expl));
          section.append(article);
        }
        analysisPanel.append(section);
      }
      if (vocabulary.length) {
        const details = disclosure("vocabulary", `词汇与词形 · ${vocabulary.length} 个词`);
        for (const item of vocabulary) {
          const article = node("article", "elt-analysis-vocabulary");
          article.append(node("strong", "", item.orig), node("span", "elt-analysis-base", `原形 ${item.lemma}`),
            node("div", "elt-analysis-pos", `${item.pos} · ${item.morphology}`), node("p", "", item.trans));
          details.append(article);
        }
        analysisPanel.append(details);
      }
    }

    function setPanelView(view) {
      state.panelView = view;
      renderPanel();
      if (view === "analysis") void ensureAnalysis();
    }
    return { renderSentence, renderPanel, setPanelView, updateHighlight, prefetchAnalysis, prefetchLinking, clearLinking };
  };
})();
