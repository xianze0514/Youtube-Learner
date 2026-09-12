(() => {
  function createRenderer(state, dictionary, actions) {
    const {
      cleanLookupWord,
      scheduleDictionaryLookup,
      scheduleDictionaryClose,
    } = dictionary;
    const {
      getTargetModel,
      openSettings,
      playSegment,
      prefetchTranslations,
      renderSoundToggle,
    } = actions;

    const review = globalThis.EnglishListeningTyping.createReviewController(state, dictionary, {
      openSettings,
      onChange() { renderTypingState(); review.renderPanel(); },
    });

  function render() {
    if (!state.overlay) return;

    const isComplete = state.phase === "complete";
    const isPractice = [
      "listening",
      "typing",
      "replaying",
      "reviewing",
      "reviewingPlayback",
    ].includes(state.phase);

    state.elements.loading.classList.add("elt-hidden");
    state.elements.error.classList.add("elt-hidden");
    state.elements.complete.classList.toggle("elt-hidden", !isComplete);
    state.elements.practice.classList.toggle("elt-hidden", !isPractice);
    state.elements.trackLabel.textContent = state.trackLabel || "YouTube 字幕";
    state.elements.panel.style.width = `${state.panelWidth}%`;
    state.elements.panelCount.textContent = `${state.segments.length} 条`;
    state.elements.panelSummary.textContent = `已完成 ${state.completedIndices.size} 句`;
    state.elements.totalMistakes.textContent = `错误 ${state.totalMistakes}`;
    state.elements.speed.textContent = `${state.video?.playbackRate || 1}×`;
    renderSoundToggle();
    review.renderPanel();

    if (isComplete) {
      state.elements.completeSummary.textContent = `完成 ${state.completedIndices.size} 句，累计错误 ${state.totalMistakes} 次`;
      renderSubtitleList();
      return;
    }

    if (!isPractice) return;
    review.prefetchAnalysis();

    const phaseContent = {
      listening: ["先听一遍", "专心听原声，句末会自动暂停"],
      typing: ["输入你听到的内容", "大小写不敏感，标点会自动跳过"],
      replaying: [
        "整句正确，正在复播",
        state.settings.completionMode === "auto"
          ? "复播结束后自动进入下一句"
          : "复播结束后会停留，可继续跟读",
      ],
      reviewing: ["本句已完成", "可反复重播跟读，按 Enter 进入下一句"],
      reviewingPlayback: ["正在重播本句", "可继续跟读，播放结束后仍停留本句"],
    }[state.phase];

    state.elements.phaseTitle.textContent = phaseContent[0];
    state.elements.phaseDetail.textContent = phaseContent[1];
    state.elements.counter.textContent = `${state.index + 1} / ${state.segments.length}`;
    state.elements.previous.disabled = state.index === 0;
    state.elements.replay.textContent =
      state.phase === "listening" ? "重新播放" : "重播本句";
    state.elements.skip.textContent =
      state.phase === "reviewing" && state.index >= state.segments.length - 1
        ? "完成训练"
        : "下一句";
    state.elements.playError.textContent = state.error;

    renderTypingState();
    renderCurrentTranslation();
    renderSentenceContext();
    renderSubtitleList();
    updatePlaybackProgress();
  }

  function renderTypingState() {
    if (!state.overlay || state.segments.length === 0) return;

    const model = getTargetModel();
    const acceptedCount = Array.from(state.typedText).length;
    state.elements.characterCount.textContent = `${acceptedCount} / ${model.requiredIndices.length} 字符`;
    state.elements.mistakeCount.textContent = `本句错误 ${state.sentenceMistakes} 次`;
    state.elements.totalMistakes.textContent = `错误 ${state.totalMistakes}`;
    state.elements.showAnswer.textContent = state.showAnswer
      ? "再按 Tab 隐藏答案"
      : "Tab 查看答案并查词";
    state.elements.showAnswer.disabled = state.phase !== "typing";
    const isSolved = state.completedIndices.has(state.index);
    state.elements.shortcutHint.textContent = isSolved
      ? "悬停查词 · Ctrl J 重播 · Enter 下一句"
      : "直接打字 · Ctrl J 重播 · Esc 退出";
    state.elements.practice.classList.toggle("elt-is-review", isSolved);
    state.elements.characterSlots.classList.toggle("elt-review-sentence", isSolved);
    if (isSolved) {
      review.renderSentence();
    } else {
      state.elements.characterSlots.setAttribute("aria-label", "听写输入区域");
      renderCharacterSlots(model);
    }
  }

  function renderSentenceContext() {
    const container = state.elements.sentenceContext;
    if (!container) return;
    const sentence = globalThis.EnglishListeningTyping.captions.getCompletedSentence(
      state.segments, state.index, state.completedIndices,
    );
    container.classList.toggle("elt-hidden", !sentence);
    state.elements.sentenceText.textContent = sentence?.text || "";
    const isPlaying = sentence && state.phase === "reviewingPlayback" &&
      state.playbackSegment === sentence;
    state.elements.replaySentence.textContent = isPlaying ? "正在连听…" : "连起来听";
    state.elements.replaySentence.disabled = Boolean(isPlaying);
    if (isPlaying) {
      state.elements.phaseTitle.textContent = "正在连听上下文";
      state.elements.phaseDetail.textContent = "播放结束后停留在当前片段";
    }
  }

  function renderCurrentTranslation() {
    const container = state.elements.translation;
    const segment = state.segments[state.index];
    if (!container || !segment) return;

    const isSolved = state.completedIndices.has(state.index);
    if (!isSolved || !state.settings.translationEnabled) {
      container.classList.add("elt-hidden");
      container.replaceChildren();
      return;
    }

    container.classList.remove("elt-hidden");
    container.classList.remove("elt-translation-pending");
    container.replaceChildren();

    const label = document.createElement("span");
    label.className = "elt-translation-label";
    label.textContent = "中文";
    const body = document.createElement("span");
    body.className = "elt-translation-text";
    const id = String(segment.id);
    const translatedText = state.translations.get(id);

    if (translatedText) {
      body.textContent = translatedText;
      container.append(label, body);
      return;
    }

    if (!state.settings.apiKeyConfigured) {
      body.textContent = "配置 DeepSeek API Key 后显示翻译";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "elt-translation-action";
      button.textContent = "去设置";
      button.addEventListener("click", openSettings);
      container.append(label, body, button);
      return;
    }

    if (state.translationLoadingIds.has(id)) {
      container.classList.add("elt-translation-pending");
      body.textContent = `正在使用 ${state.settings.model} 翻译…`;
      container.append(label, body);
      return;
    }

    const error = state.translationErrors.get(id);
    if (error) {
      body.textContent = error;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "elt-translation-action";
      retry.textContent = "重试";
      retry.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.translationErrors.delete(id);
        void prefetchTranslations(state.index);
      });
      container.append(label, body, retry);
      return;
    }

    body.textContent = "正在准备翻译…";
    container.append(label, body);
    void prefetchTranslations(state.index);
  }

  function renderCharacterSlots(model) {
    const container = state.elements.characterSlots;
    const acceptedCount = Array.from(state.typedText).length;
    const requiredPositionByIndex = new Map(
      model.requiredIndices.map((targetIndex, position) => [targetIndex, position]),
    );
    const fragment = document.createDocumentFragment();
    let absoluteIndex = 0;
    const chunks = model.text.match(/\S+|\s+/gu) || [];

    chunks.forEach((chunk) => {
      const chunkCharacters = Array.from(chunk);
      const chunkStart = absoluteIndex;
      const chunkEnd = chunkStart + chunkCharacters.length;

      if (/^\s+$/u.test(chunk)) {
        chunkCharacters.forEach((character) => {
          const requiredPosition = requiredPositionByIndex.get(absoluteIndex);
          const space = document.createElement("span");
          space.className = "elt-space-slot";
          if (requiredPosition < acceptedCount) space.classList.add("elt-slot-correct");
          if (requiredPosition === acceptedCount && state.phase === "typing") {
            space.classList.add("elt-slot-current");
          }
          if (absoluteIndex === state.wrongIndex) space.classList.add("elt-slot-wrong");
          space.textContent = " ";
          fragment.appendChild(space);
          absoluteIndex += 1;
        });
        return;
      }

      const word = document.createElement("span");
      word.className = "elt-word-slots";
      if (
        state.isResettingWord &&
        state.wrongIndex >= chunkStart &&
        state.wrongIndex < chunkEnd
      ) {
        word.classList.add("elt-word-resetting");
      }
      if (state.showAnswer) {
        const lookupWord = cleanLookupWord(chunk);
        if (lookupWord) {
          word.classList.add("elt-word-lookup");
          word.tabIndex = 0;
          word.setAttribute("aria-label", `查询 ${lookupWord}`);
          word.addEventListener("pointerenter", () => {
            scheduleDictionaryLookup(lookupWord, word);
          });
          word.addEventListener("pointerleave", scheduleDictionaryClose);
          word.addEventListener("focus", () => {
            scheduleDictionaryLookup(lookupWord, word);
          });
          word.addEventListener("blur", scheduleDictionaryClose);
        }
      }

      chunkCharacters.forEach((character) => {
        const slot = document.createElement("span");
        const requiredPosition = requiredPositionByIndex.get(absoluteIndex);
        const required = requiredPosition !== undefined;
        const completed = required && requiredPosition < acceptedCount;
        const isCurrent = required && requiredPosition === acceptedCount;
        const isWrong = absoluteIndex === state.wrongIndex;
        const revealAll = state.showAnswer || state.phase === "replaying";

        slot.className = required ? "elt-character-slot" : "elt-punctuation";
        if (completed) slot.classList.add("elt-slot-correct");
        if (isCurrent && state.phase === "typing") slot.classList.add("elt-slot-current");
        if (isWrong) slot.classList.add("elt-slot-wrong");
        if (revealAll && !completed && required) slot.classList.add("elt-slot-answer");
        slot.textContent = !required || completed || revealAll ? character : "_";
        word.appendChild(slot);
        absoluteIndex += 1;
      });

      fragment.appendChild(word);
    });

    container.replaceChildren(fragment);
  }

  function renderSubtitleList() {
    const list = state.elements.subtitleList;
    if (!list) return;

    const fragment = document.createDocumentFragment();
    state.segments.forEach((segment, index) => {
      const row = document.createElement("button");
      const isCurrent = index === state.index;
      const isCompleted = state.completedIndices.has(index);
      const mayReveal = isCompleted || (isCurrent && state.phase === "replaying");
      row.type = "button";
      row.className = `elt-subtitle-row${isCurrent ? " elt-subtitle-current" : ""}${isCompleted ? " elt-subtitle-completed" : ""}`;
      row.dataset.index = String(index);

      const rowHeader = document.createElement("span");
      rowHeader.className = "elt-subtitle-row-header";
      const number = document.createElement("span");
      number.textContent = `#${index + 1}`;
      const time = document.createElement("span");
      time.textContent = formatTimestamp(segment.startMs);
      rowHeader.append(number, time);

      const text = document.createElement("span");
      text.className = `elt-subtitle-text${mayReveal ? "" : " elt-subtitle-masked"}`;
      text.textContent = mayReveal
        ? segment.text
        : isCurrent
          ? "当前句正在训练，字幕已隐藏"
          : "完成前隐藏";

      row.append(rowHeader, text);
      const translatedText = state.translations.get(String(segment.id));
      if (isCompleted && state.settings.translationEnabled && translatedText) {
        const translation = document.createElement("span");
        translation.className = "elt-subtitle-translation";
        translation.textContent = translatedText;
        row.append(translation);
      }
      row.addEventListener("click", () => {
        void playSegment(index, "listening", true);
      });
      fragment.appendChild(row);
    });

    list.replaceChildren(fragment);
    const currentRow = list.querySelector(".elt-subtitle-current");
    currentRow?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function updatePlaybackProgress() {
    review.updateHighlight();
    const segment = state.playbackSegment || state.segments[state.index];
    if (!segment || !state.video || !state.elements.progressBar) return;
    const duration = Math.max(1, segment.endMs - segment.startMs);
    const elapsed = Math.max(0, state.video.currentTime * 1000 - segment.startMs);
    const percent = Math.min(100, (elapsed / duration) * 100);
    state.elements.progressBar.style.width = `${percent}%`;
    state.elements.segmentTime.textContent = `${formatTimestamp(elapsed)} / ${formatTimestamp(duration)}`;
  }

  function formatTimestamp(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

    return Object.freeze({
      render,
      setPanelView: review.setPanelView,
      renderCurrentTranslation,
      renderTypingState,
      updatePlaybackProgress,
    });
  }

  const namespace = (globalThis.EnglishListeningTyping ||= {});
  namespace.createRenderer = createRenderer;
})();
