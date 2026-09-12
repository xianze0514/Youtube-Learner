(() => {
  function createDictionaryController(state) {
    const dictionaryCache = new Map();

  function cleanLookupWord(value) {
    return (
      String(value || "").match(/[\p{L}]+(?:['’][\p{L}]+)*/u)?.[0] || ""
    ).replace(/[’]/g, "'");
  }

  function canLookup() {
    return (state.showAnswer && state.phase === "typing") || state.completedIndices.has(state.index);
  }

  function scheduleDictionaryLookup(word, anchor) {
    if (!canLookup()) return;
    cancelDictionaryClose();
    if (state.dictionaryHoverTimer) clearTimeout(state.dictionaryHoverTimer);
    state.dictionaryHoverTimer = window.setTimeout(() => {
      state.dictionaryHoverTimer = 0;
      void lookupDictionaryWord(word, anchor);
    }, 300);
  }

  function scheduleDictionaryClose() {
    if (state.dictionaryHoverTimer) clearTimeout(state.dictionaryHoverTimer);
    state.dictionaryHoverTimer = 0;
    if (state.dictionaryCloseTimer) clearTimeout(state.dictionaryCloseTimer);
    state.dictionaryCloseTimer = window.setTimeout(() => {
      closeDictionaryImmediately();
    }, 800);
  }

  function cancelDictionaryClose() {
    if (state.dictionaryCloseTimer) clearTimeout(state.dictionaryCloseTimer);
    state.dictionaryCloseTimer = 0;
  }

  function closeDictionary() {
    closeDictionaryImmediately();
  }

  function closeDictionaryImmediately() {
    if (state.dictionaryHoverTimer) clearTimeout(state.dictionaryHoverTimer);
    if (state.dictionaryCloseTimer) clearTimeout(state.dictionaryCloseTimer);
    state.dictionaryHoverTimer = 0;
    state.dictionaryCloseTimer = 0;
    state.dictionaryRequestId += 1;
    state.dictionaryWord = "";
    state.dictionaryData = null;
    state.dictionaryLoading = false;
    state.dictionaryError = "";
    if (state.dictionaryAudio) {
      state.dictionaryAudio.pause();
      state.dictionaryAudio = null;
    }
    state.elements.dictionary?.classList.add("elt-hidden");
  }

  async function lookupDictionaryWord(word, anchor) {
    const dictionary = state.elements.dictionary;
    if (!dictionary || !canLookup()) return;

    state.dictionaryWord = word;
    state.dictionaryError = "";
    positionDictionary(anchor);

    const cacheKey = word.toLocaleLowerCase();
    const cached = dictionaryCache.get(cacheKey);
    if (cached) {
      state.dictionaryData = cached;
      state.dictionaryLoading = false;
      renderDictionary();
      return;
    }

    const requestId = ++state.dictionaryRequestId;
    state.dictionaryData = null;
    state.dictionaryLoading = true;
    renderDictionary();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ELT_LOOKUP_WORD",
        word,
      });
      if (requestId !== state.dictionaryRequestId || !canLookup()) return;
      if (!response?.entry) {
        throw new Error(response?.error || "没有找到这个单词");
      }

      dictionaryCache.set(cacheKey, response.entry);
      if (dictionaryCache.size > 50) {
        dictionaryCache.delete(dictionaryCache.keys().next().value);
      }
      state.dictionaryData = response.entry;
    } catch (error) {
      if (requestId !== state.dictionaryRequestId) return;
      state.dictionaryError =
        error instanceof Error ? error.message : "查词失败，请稍后重试";
    } finally {
      if (requestId === state.dictionaryRequestId) {
        state.dictionaryLoading = false;
        renderDictionary();
      }
    }
  }

  function positionDictionary(anchor) {
    const dictionary = state.elements.dictionary;
    if (!dictionary || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    const cardWidth = 348;
    const cardHeight = 430;
    const margin = 14;
    let left = rect.right + margin;
    if (left + cardWidth > window.innerWidth - margin) {
      left = rect.left - cardWidth - margin;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - cardWidth - margin));

    let top = rect.top - cardHeight - margin;
    if (top < 70) top = rect.bottom + margin;
    top = Math.max(70, Math.min(top, window.innerHeight - cardHeight - margin));

    dictionary.style.left = `${left}px`;
    dictionary.style.top = `${top}px`;
    dictionary.dataset.side = left > rect.left ? "left" : "right";
    const arrowY = Math.max(
      28,
      Math.min(cardHeight - 28, rect.top + rect.height / 2 - top),
    );
    dictionary.style.setProperty("--elt-dictionary-arrow-y", `${arrowY}px`);
  }

  function renderDictionary() {
    const dictionary = state.elements.dictionary;
    if (!dictionary || !state.dictionaryWord) return;

    const fragment = document.createDocumentFragment();
    const header = document.createElement("div");
    header.className = "elt-dictionary-header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "elt-dictionary-title-group";
    const source = document.createElement("span");
    source.className = "elt-dictionary-source";
    source.textContent = "夸克词典";
    const titleLine = document.createElement("div");
    titleLine.className = "elt-dictionary-title-line";
    const title = document.createElement("strong");
    title.textContent = state.dictionaryData?.word || state.dictionaryWord;
    const translation = document.createElement("span");
    translation.className = "elt-dictionary-translation";
    translation.textContent = state.dictionaryData?.translation || "";
    titleLine.append(title, translation);
    titleGroup.append(source, titleLine);

    const actions = document.createElement("div");
    actions.className = "elt-dictionary-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭词典");
    close.textContent = "×";
    close.addEventListener("click", closeDictionaryImmediately);
    actions.appendChild(close);
    header.append(titleGroup, actions);
    fragment.appendChild(header);

    const phonetics = state.dictionaryData?.phonetics || [];
    if (phonetics.length > 0) {
      const pronunciation = document.createElement("div");
      pronunciation.className = "elt-dictionary-pronunciation";
      phonetics.forEach((item) => {
        const speak = document.createElement("button");
        speak.type = "button";
        speak.className = "elt-dictionary-pronunciation-button";
        speak.title = `播放${item.label}音`;
        speak.setAttribute("aria-label", `播放${item.label}音 ${item.text}`);
        const label = document.createElement("span");
        label.className = "elt-dictionary-pronunciation-label";
        label.textContent = `${item.label}音`;
        const phonetic = document.createElement("span");
        phonetic.className = "elt-dictionary-phonetic";
        phonetic.textContent = item.text;
        const play = document.createElement("span");
        play.className = "elt-dictionary-play-label";
        play.textContent = "播放";
        speak.append(label, phonetic, play);
        speak.addEventListener("click", (event) => {
          playDictionaryPronunciation(event, item.audioUrl);
        });
        pronunciation.appendChild(speak);
      });
      fragment.appendChild(pronunciation);
    }

    const body = document.createElement("div");
    body.className = "elt-dictionary-body";
    if (state.dictionaryLoading) {
      const loading = document.createElement("div");
      loading.className = "elt-dictionary-loading";
      loading.setAttribute("aria-label", "正在查询");
      for (let index = 0; index < 4; index += 1) {
        const line = document.createElement("span");
        line.className = "elt-dictionary-skeleton";
        loading.appendChild(line);
      }
      body.appendChild(loading);
    } else if (state.dictionaryError) {
      const error = document.createElement("p");
      error.className = "elt-dictionary-error";
      error.textContent = state.dictionaryError;
      body.appendChild(error);
    } else {
      const meanings = (state.dictionaryData?.meanings || []).slice(0, 5);
      if (meanings.length > 0) {
        body.appendChild(
          createDictionarySectionHeader("释义", `${meanings.length} 条`),
        );
      }
      meanings.forEach((meaning) => {
        const item = document.createElement("section");
        item.className = "elt-dictionary-meaning";
        const part = document.createElement("span");
        part.className = "elt-dictionary-part";
        part.textContent = meaning.partOfSpeech || "释义";
        const definition = document.createElement("p");
        definition.textContent = meaning.definition;
        item.append(part, definition);
        body.appendChild(item);
      });

      const examples = state.dictionaryData?.examples || [];
      if (examples.length > 0) {
        const examplesSection = document.createElement("section");
        examplesSection.className = "elt-dictionary-examples";
        examplesSection.appendChild(
          createDictionarySectionHeader("例句", `${examples.length} 条`),
        );
        examples.forEach((example, index) => {
          const block = document.createElement("blockquote");
          const number = document.createElement("span");
          number.className = "elt-dictionary-example-number";
          number.textContent = String(index + 1).padStart(2, "0");
          const copy = document.createElement("div");
          const english = document.createElement("span");
          english.textContent = example.en;
          const chinese = document.createElement("small");
          chinese.textContent = example.zh;
          copy.append(english, chinese);
          block.append(number, copy);
          examplesSection.appendChild(block);
        });
        body.appendChild(examplesSection);
      }
    }
    fragment.appendChild(body);
    dictionary.replaceChildren(fragment);
    dictionary.classList.remove("elt-hidden");
  }

  function createDictionarySectionHeader(titleText, metaText) {
    const header = document.createElement("div");
    header.className = "elt-dictionary-section-header";
    const title = document.createElement("span");
    title.textContent = titleText;
    const meta = document.createElement("small");
    meta.textContent = metaText;
    header.append(title, meta);
    return header;
  }

  function playDictionaryPronunciation(event, pronunciationUrl = "") {
    event?.preventDefault();
    event?.stopPropagation();
    if (!state.dictionaryWord) return;

    const audioUrl = pronunciationUrl;
    if (audioUrl) {
      state.dictionaryAudio?.pause();
      const audio = new Audio(audioUrl);
      state.dictionaryAudio = audio;
      audio.addEventListener(
        "ended",
        () => {
          if (state.dictionaryAudio === audio) state.dictionaryAudio = null;
        },
        { once: true },
      );
      void audio.play().catch(() => {
        if (state.dictionaryAudio === audio) state.dictionaryAudio = null;
        playSpeechSynthesisPronunciation();
      });
      return;
    }

    playSpeechSynthesisPronunciation();
  }

  function playSpeechSynthesisPronunciation() {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(state.dictionaryWord);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }


    return Object.freeze({
      cleanLookupWord,
      scheduleDictionaryLookup,
      scheduleDictionaryClose,
      cancelDictionaryClose,
      closeDictionary,
      closeDictionaryImmediately,
    });
  }

  const namespace = (globalThis.EnglishListeningTyping ||= {});
  namespace.createDictionaryController = createDictionaryController;
})();
