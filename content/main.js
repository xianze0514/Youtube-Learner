(() => {
  if (globalThis.__englishListeningTypingLoaded) return;
  globalThis.__englishListeningTypingLoaded = true;

  const OVERLAY_ID = "elt-overlay";
  const END_TOLERANCE_SECONDS = 0.035;
  const NEXT_SENTENCE_DELAY_MS = 350;
  const WRONG_FEEDBACK_MS = 320;
  const SOURCE_BOUNDARY_PREROLL_MS = 120;
  const ESTIMATED_BOUNDARY_PREROLL_MS = 700;
  const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5];
  const TRANSLATION_PRELOAD_SIZE = 10;
  const TRANSLATION_TRIGGER_THRESHOLD = 5;

  const state = {
    overlay: null,
    video: null,
    originalVideo: null,
    segments: [],
    playbackSegment: null,
    index: 0,
    phase: "loading",
    typedText: "",
    wrongIndex: -1,
    isResettingWord: false,
    sentenceMistakes: 0,
    totalMistakes: 0,
    completed: 0,
    completedIndices: new Set(),
    showAnswer: false,
    panelWidth: 28,
    panelView: "subtitles",
    trackLabel: "",
    videoId: "",
    error: "",
    animationFrame: 0,
    timer: 0,
    feedbackTimer: 0,
    typingFeedbackTimer: 0,
    soundEnabled: true,
    typingAudioContext: null,
    typingAudioMasterGain: null,
    dictionaryHoverTimer: 0,
    dictionaryCloseTimer: 0,
    dictionaryRequestId: 0,
    dictionaryWord: "",
    dictionaryData: null,
    dictionaryLoading: false,
    dictionaryError: "",
    dictionaryAudio: null,
    settings: {
      translationEnabled: true,
      completionMode: "manual",
      apiKeyConfigured: false,
      model: "deepseek-v4-flash",
    },
    translations: new Map(),
    translationLoadingIds: new Set(),
    translationErrors: new Map(),
    translationGeneration: 0,
    runId: 0,
    originalOverflow: "",
    elements: {},
  };

  const modules = globalThis.EnglishListeningTyping || {};
  const { playTypingSound } = modules.createAudioController(state);
  const { findStartingIndex, getCompletedSentence, joinCaptionText, mergeCuesIntoSentences, splitSegmentsForPractice, segmentTextIntoSentences } = modules.captions;
  const { loadSubtitleSegments, getVideoId } = modules.createTranscriptLoader(
    modules.captions,
    setLoadingMessage,
  );
  const dictionary = modules.createDictionaryController(state);
  const {
    cleanLookupWord,
    scheduleDictionaryLookup,
    scheduleDictionaryClose,
    cancelDictionaryClose,
    closeDictionary,
    closeDictionaryImmediately,
  } = dictionary;
  const {
    render,
    setPanelView,
    renderCurrentTranslation,
    renderTypingState,
    updatePlaybackProgress,
  } =
    modules.createRenderer(state, dictionary, {
      getTargetModel,
      openSettings,
      playSegment,
      prefetchTranslations,
      renderSoundToggle,
    });
  const { overlayMarkup } = modules;

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "ELT_SETTINGS_UPDATED") {
        applyPublicSettings(message.settings);
        return;
      }
      if (message?.type !== "ELT_TOGGLE_TRAINER") return;

      if (state.overlay) {
        closeTrainer();
      } else {
        void openTrainer(message.playerData);
      }
    });
  }

  async function openStandaloneTrainer() {
    createOverlay();
    state.overlay.classList.add("elt-standalone");
    state.elements.videoTitle.textContent = "正在准备你的听写练习";
    state.overlay.querySelector(".elt-brand strong").textContent = "英语精听";
    state.overlay.querySelector("#elt-close").textContent = "返回 YouTube";
    try {
      const response = await chrome.runtime.sendMessage({ type: "ELT_GET_LEARNING" });
      if (response?.error) throw new Error(response.error);
      const session = response.session;
      state.videoId = session.videoId;
      state.elements.videoTitle.textContent = session.title;
      document.title = `${session.title} · 英语精听`;
      const video = modules.createYouTubeVideo(state.elements.videoShell, session.videoId, session.startTime);
      state.video = video;
      video.onError = (message) => { stopScheduledWork(); showFatalError(message); };
      video.onBlocked = () => {
        state.error = "请点击视频中的播放按钮，或点击下方“重播本句”开始。";
        if (state.phase !== "loading") render();
      };
      const loader = modules.createTranscriptLoader(modules.captions, setLoadingMessage, { standalone: true, pageUrl: session.sourceUrl });
      const [prepared] = await Promise.all([
        session.prepared || loader.loadSubtitleSegments(session.playerData),
        loadPublicSettings(),
        video.ready,
      ]);
      if (!prepared.segments?.length) throw new Error("没有找到可训练的英文字幕");
      state.segments = prepared.segments;
      state.trackLabel = prepared.trackLabel;
      state.index = findStartingIndex(state.segments, session.startTime * 1000);
      void chrome.runtime.sendMessage({ type: "ELT_CACHE_LEARNING", prepared }).catch(() => {});
      await playSegment(state.index, "listening", true);
    } catch (error) {
      state.video?.pause();
      showFatalError(error.message || "学习页暂时无法加载，请返回原视频重试。");
    }
  }

  async function openTrainer(playerData) {
    const video =
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video");

    createOverlay();

    if (!(video instanceof HTMLVideoElement)) {
      showFatalError("当前页面没有找到视频，请打开一个 YouTube 视频后重试。");
      return;
    }

    state.video = video;
    moveVideoIntoTrainer(video);

    try {
      setLoadingMessage("正在读取 YouTube 字幕……");
      const settingsPromise = loadPublicSettings();
      const { segments, trackLabel } = await loadSubtitleSegments(playerData);
      await settingsPromise;

      if (!state.overlay) return;
      if (segments.length === 0) {
        throw new Error("没有找到可训练的字幕句子");
      }

      state.segments = segments;
      state.trackLabel = trackLabel;
      state.videoId = playerData?.videoId || getVideoId() || "unknown";
      state.translations = new Map();
      state.translationLoadingIds = new Set();
      state.translationErrors = new Map();
      state.translationGeneration += 1;
      state.index = findStartingIndex(segments, video.currentTime * 1000);
      state.phase = "listening";
      render();
      void prefetchTranslations(state.index);
      await playSegment(state.index, "listening", true);
    } catch (error) {
      console.error("[English Listening Typing] 字幕加载失败：", error);
      showFatalError(
        `${error instanceof Error ? error.message : "字幕加载失败"}。请确认该视频提供字幕，然后重试。`,
      );
    }
  }

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = overlayMarkup;

    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    state.originalOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    state.elements = {
      videoShell: overlay.querySelector("#elt-video-shell"),
      loading: overlay.querySelector("#elt-loading"),
      loadingMessage: overlay.querySelector("#elt-loading-message"),
      error: overlay.querySelector("#elt-error"),
      errorMessage: overlay.querySelector("#elt-error-message"),
      complete: overlay.querySelector("#elt-complete"),
      completeSummary: overlay.querySelector("#elt-complete-summary"),
      practice: overlay.querySelector("#elt-practice"),
      keyboardCapture: overlay.querySelector("#elt-keyboard-capture"),
      videoTitle: overlay.querySelector("#elt-video-title"),
      trackLabel: overlay.querySelector("#elt-track-label"),
      phaseTitle: overlay.querySelector("#elt-phase-title"),
      phaseDetail: overlay.querySelector("#elt-phase-detail"),
      typingFeedback: overlay.querySelector("#elt-typing-feedback"),
      counter: overlay.querySelector("#elt-counter"),
      progressBar: overlay.querySelector("#elt-progress-bar"),
      playError: overlay.querySelector("#elt-play-error"),
      characterSlots: overlay.querySelector("#elt-character-slots"),
      translation: overlay.querySelector("#elt-translation"),
      sentenceContext: overlay.querySelector("#elt-sentence-context"),
      sentenceText: overlay.querySelector("#elt-sentence-text"),
      replaySentence: overlay.querySelector("#elt-replay-sentence"),
      characterCount: overlay.querySelector("#elt-character-count"),
      mistakeCount: overlay.querySelector("#elt-mistake-count"),
      previous: overlay.querySelector("#elt-previous"),
      replay: overlay.querySelector("#elt-replay"),
      showAnswer: overlay.querySelector("#elt-show-answer"),
      skip: overlay.querySelector("#elt-skip"),
      speed: overlay.querySelector("#elt-speed"),
      sound: overlay.querySelector("#elt-sound"),
      settings: overlay.querySelector("#elt-settings"),
      totalMistakes: overlay.querySelector("#elt-total-mistakes"),
      segmentTime: overlay.querySelector("#elt-segment-time"),
      shortcutHint: overlay.querySelector("#elt-shortcut-hint"),
      panel: overlay.querySelector("#elt-panel"),
      panelSummary: overlay.querySelector("#elt-panel-summary"),
      panelCount: overlay.querySelector("#elt-panel-count"),
      subtitleList: overlay.querySelector("#elt-subtitle-list"),
      analysisPanel: overlay.querySelector("#elt-analysis-panel"),
      subtitlesTab: overlay.querySelector("#elt-subtitles-tab"),
      analysisTab: overlay.querySelector("#elt-analysis-tab"),
      panelFooter: overlay.querySelector("#elt-panel-footer"),
      divider: overlay.querySelector("#elt-divider"),
      dictionary: overlay.querySelector("#elt-dictionary"),
    };

    state.elements.videoTitle.textContent = getVideoTitle();

    overlay.querySelector("#elt-close").addEventListener("click", closeTrainer);
    overlay.querySelector("#elt-error-close").addEventListener("click", closeTrainer);
    overlay.querySelector("#elt-restart").addEventListener("click", restartTraining);
    for (const [tab, view] of [[state.elements.subtitlesTab, "subtitles"], [state.elements.analysisTab, "analysis"]]) {
      tab.addEventListener("click", () => setPanelView(view));
      tab.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "subtitles" : event.key === "End" ? "analysis" : view === "analysis" ? "subtitles" : "analysis";
        setPanelView(next);
        state.elements[next === "analysis" ? "analysisTab" : "subtitlesTab"].focus();
      });
    }
    state.elements.previous.addEventListener("click", previousSentence);
    state.elements.replay.addEventListener("click", replaySentence);
    state.elements.replaySentence.addEventListener("click", replayCompletedSentence);
    state.elements.skip.addEventListener("click", skipSentence);
    state.elements.speed.addEventListener("click", cyclePlaybackRate);
    state.elements.sound.addEventListener("click", toggleTypingSound);
    state.elements.settings.addEventListener("click", openSettings);
    state.elements.showAnswer.addEventListener("click", toggleAnswer);
    state.elements.divider.addEventListener("pointerdown", startPanelResize);
    state.elements.dictionary.addEventListener("pointerenter", cancelDictionaryClose);
    state.elements.dictionary.addEventListener("pointerleave", closeDictionary);
    window.addEventListener("keydown", handleOverlayShortcut, true);
    window.addEventListener("keyup", handleOverlayKeyUp, true);
    overlay.addEventListener("click", event => {
      if (!event.target.closest("button, [tabindex], #elt-panel, #elt-dictionary")) focusKeyboardCapture();
    });
  }

  function getVideoTitle() {
    return (
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string")
        ?.textContent?.trim() ||
      document.title.replace(/\s*-\s*YouTube\s*$/, "").trim() ||
      "听写打字训练"
    );
  }

  async function loadPublicSettings() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ELT_GET_SETTINGS",
      });
      if (response?.settings) applyPublicSettings(response.settings);
    } catch (error) {
      console.warn("[English Listening Typing] 设置读取失败，使用默认值：", error);
    }
  }

  function applyPublicSettings(settings) {
    if (!settings || typeof settings !== "object") return;
    state.settings = {
      translationEnabled: settings.translationEnabled !== false,
      completionMode: settings.completionMode === "auto" ? "auto" : "manual",
      apiKeyConfigured: Boolean(settings.apiKeyConfigured),
      model: settings.model || "deepseek-v4-flash",
    };

    if (state.settings.translationEnabled && state.settings.apiKeyConfigured) {
      void prefetchTranslations(state.index);
    }
    if (
      state.overlay &&
      !["loading", "error"].includes(state.phase)
    ) {
      render();
    }
  }

  function openSettings(event) {
    event?.preventDefault();
    event?.stopPropagation();
    void chrome.runtime.sendMessage({ type: "ELT_OPEN_SETTINGS" }).catch((error) => {
      state.error = `设置页打开失败：${error instanceof Error ? error.message : String(error)}`;
      render();
    });
  }

  async function prefetchTranslations(startIndex) {
    if (
      !state.overlay ||
      !state.settings.translationEnabled ||
      !state.settings.apiKeyConfigured ||
      state.segments.length === 0 ||
      state.translationLoadingIds.size > 0
    ) {
      return;
    }

    let translatedAhead = 0;
    while (
      startIndex + translatedAhead < state.segments.length &&
      state.translations.has(
        String(state.segments[startIndex + translatedAhead].id),
      )
    ) {
      translatedAhead += 1;
    }
    if (translatedAhead >= TRANSLATION_TRIGGER_THRESHOLD) return;

    const firstMissingIndex = startIndex + translatedAhead;
    const batch = state.segments
      .slice(firstMissingIndex, firstMissingIndex + TRANSLATION_PRELOAD_SIZE)
      .filter(
        (segment) =>
          !state.translations.has(String(segment.id)) &&
          !state.translationLoadingIds.has(String(segment.id)),
      );
    if (batch.length === 0) return;

    const generation = state.translationGeneration;
    batch.forEach((segment) => {
      const id = String(segment.id);
      state.translationLoadingIds.add(id);
      state.translationErrors.delete(id);
    });
    renderCurrentTranslation();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ELT_TRANSLATE_SEGMENTS",
        videoId: state.videoId,
        segments: batch.map((segment) => ({
          id: segment.id,
          text: segment.text,
        })),
      });
      if (generation !== state.translationGeneration || !state.overlay) return;
      if (response?.apiKeyRequired) {
        state.settings.apiKeyConfigured = false;
        return;
      }
      if (response?.error) throw new Error(response.error);

      const expectedIds = new Set(batch.map(segment => String(segment.id)));
      const returnedIds = new Set();
      for (const translation of response?.translations || []) {
        const id = String(translation?.id);
        const translatedText = String(translation?.translatedText || "").trim();
        if (!expectedIds.has(id) || returnedIds.has(id) || !translatedText) continue;
        returnedIds.add(id);
        state.translations.set(id, translatedText);
      }
      batch.forEach((segment) => {
        const id = String(segment.id);
        if (!returnedIds.has(id) && !state.translations.has(id)) {
          state.translationErrors.set(id, "DeepSeek 未返回这一句的翻译");
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      batch.forEach((segment) => {
        state.translationErrors.set(String(segment.id), message);
      });
    } finally {
      if (generation === state.translationGeneration) {
        batch.forEach((segment) =>
          state.translationLoadingIds.delete(String(segment.id)),
        );
        if (state.overlay) render();
      }
    }
  }

  function focusKeyboardCapture() {
    if (state.phase === "typing") {
      state.elements.keyboardCapture?.focus({ preventScroll: true });
    } else {
      state.elements.practice?.focus({ preventScroll: true });
    }
  }

  function moveVideoIntoTrainer(video) {
    state.originalVideo = {
      parent: video.parentNode,
      nextSibling: video.nextSibling,
      style: video.getAttribute("style"),
      controls: video.controls,
    };

    video.pause();
    state.elements.videoShell.appendChild(video);
    video.controls = false;
    video.style.cssText =
      "display:block !important;width:100% !important;height:100% !important;max-width:none !important;max-height:none !important;position:static !important;object-fit:contain !important;transform:none !important;";
  }

  function restoreVideo() {
    const video = state.video;
    const original = state.originalVideo;
    if (!video || !original?.parent) return;

    if (original.nextSibling?.parentNode === original.parent) {
      original.parent.insertBefore(video, original.nextSibling);
    } else {
      original.parent.appendChild(video);
    }

    video.controls = original.controls;
    if (original.style === null) {
      video.removeAttribute("style");
    } else {
      video.setAttribute("style", original.style);
    }
  }

  function closeTrainer() {
    if (document.documentElement.dataset.eltLearning === "true") {
      state.video?.pause();
      void chrome.runtime.sendMessage({ type: "ELT_RETURN_SOURCE" }).catch(() => {});
      return;
    }
    stopScheduledWork();
    if (state.typingFeedbackTimer) clearTimeout(state.typingFeedbackTimer);
    state.typingFeedbackTimer = 0;
    if (state.typingAudioContext) {
      void state.typingAudioContext.close().catch(() => {});
      state.typingAudioContext = null;
      state.typingAudioMasterGain = null;
    }
    closeDictionaryImmediately();
    window.removeEventListener("keydown", handleOverlayShortcut, true);
    window.removeEventListener("keyup", handleOverlayKeyUp, true);
    state.video?.pause();
    restoreVideo();
    state.overlay?.remove();
    document.documentElement.style.overflow = state.originalOverflow;

    state.overlay = null;
    state.video = null;
    state.originalVideo = null;
    state.segments = [];
    state.playbackSegment = null;
    state.completedIndices = new Set();
    state.translations = new Map();
    state.translationLoadingIds = new Set();
    state.translationErrors = new Map();
    state.translationGeneration += 1;
    state.elements = {};
    state.runId += 1;
  }

  function stopScheduledWork() {
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    if (state.timer) clearTimeout(state.timer);
    if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
    if (state.dictionaryHoverTimer) clearTimeout(state.dictionaryHoverTimer);
    if (state.dictionaryCloseTimer) clearTimeout(state.dictionaryCloseTimer);
    state.animationFrame = 0;
    state.timer = 0;
    state.feedbackTimer = 0;
    state.dictionaryHoverTimer = 0;
    state.dictionaryCloseTimer = 0;
  }

  function setLoadingMessage(message) {
    if (state.elements.loadingMessage) {
      state.elements.loadingMessage.textContent = message;
    }
  }

  function showFatalError(message) {
    state.phase = "error";
    state.elements.loading?.classList.add("elt-hidden");
    state.elements.practice?.classList.add("elt-hidden");
    state.elements.error?.classList.remove("elt-hidden");
    state.elements.errorMessage.textContent = message;
  }


  function getSegmentPlaybackStartMs(segment) {
    const prerollMs = segment.hasEstimatedStart
      ? ESTIMATED_BOUNDARY_PREROLL_MS
      : SOURCE_BOUNDARY_PREROLL_MS;
    const previous = state.segments.findLast((item) => item.startMs < segment.startMs);
    const earliest = previous ? Math.min(previous.endMs, segment.startMs) : 0;
    return Math.max(0, earliest, segment.startMs - prerollMs);
  }

  async function playSegment(index, phase, resetInput, playbackSegment = null) {
    const segment = playbackSegment || state.segments[index];
    const video = state.video;
    if (!segment || !video || !state.overlay) return;

    stopScheduledWork();
    const runId = ++state.runId;
    state.index = index;
    state.playbackSegment = segment;
    state.phase = phase;
    state.error = "";
    state.showAnswer = false;
    if (phase !== "replaying") clearTypingFeedback();
    closeDictionaryImmediately();
    state.wrongIndex = -1;
    state.isResettingWord = false;

    if (resetInput) {
      state.typedText = "";
      state.sentenceMistakes = 0;
      state.completedIndices.delete(index);
    }

    video.pause();
    video.currentTime = getSegmentPlaybackStartMs(segment) / 1000;
    render();
    void prefetchTranslations(index);

    try {
      if (typeof video.playSegment === "function") {
        await video.playSegment(getSegmentPlaybackStartMs(segment) / 1000, segment.endMs / 1000);
      } else {
        await video.play();
      }
    } catch (error) {
      if (runId !== state.runId || !state.overlay) return;
      console.error("[English Listening Typing] 视频播放失败：", error);
      if (phase === "reviewingPlayback") {
        state.phase = "reviewing";
        state.playbackSegment = state.segments[index];
      }
      state.error = "浏览器阻止了自动播放，请点击“播放本句”。";
      render();
      return;
    }
    if (runId !== state.runId || !state.overlay) return;

    const monitorEnd = () => {
      if (runId !== state.runId || !state.overlay || !state.video) return;

      const requestedEnd = segment.endMs / 1000;
      const effectiveEnd =
        Number.isFinite(state.video.duration) && state.video.duration > 0
          ? Math.min(requestedEnd, state.video.duration)
          : requestedEnd;

      if (
        !state.video.ended &&
        state.video.currentTime < effectiveEnd - END_TOLERANCE_SECONDS
      ) {
        updatePlaybackProgress();
        state.animationFrame = requestAnimationFrame(monitorEnd);
        return;
      }

      state.video.pause();
      state.animationFrame = 0;
      state.playbackSegment = state.segments[index];

      if (phase === "listening") {
        state.phase = "typing";
        render();
        focusKeyboardCapture();
        return;
      }

      if (phase === "reviewingPlayback") {
        state.phase = "reviewing";
        render();
        focusKeyboardCapture();
        return;
      }

      state.completedIndices.add(index);
      state.completed = state.completedIndices.size;
      if (state.settings.completionMode === "manual") {
        state.phase = "reviewing";
        render();
        focusKeyboardCapture();
        return;
      }

      const nextIndex = index + 1;
      if (nextIndex >= state.segments.length) {
        state.phase = "complete";
        render();
        return;
      }

      state.timer = window.setTimeout(() => {
        void playSegment(nextIndex, "listening", true);
      }, NEXT_SENTENCE_DELAY_MS);
    };

    state.animationFrame = requestAnimationFrame(monitorEnd);
  }

  function normalizeText(text) {
    return text
      .normalize("NFKC")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function isRequiredCharacter(character) {
    return /[\p{L}\p{N}'’\s]/u.test(character);
  }

  function getTargetModel() {
    const text = state.segments[state.index]?.text || "";
    const characters = Array.from(text);
    const requiredIndices = [];

    characters.forEach((character, index) => {
      if (isRequiredCharacter(character)) requiredIndices.push(index);
    });

    return { text, characters, requiredIndices };
  }

  function normalizeInputCharacter(character) {
    return character
      .normalize("NFKC")
      .replace(/[‘’]/g, "'")
      .toLocaleLowerCase();
  }

  function handleTypingCharacter(character) {
    if (state.phase !== "typing" || state.isResettingWord) return;

    const { characters, requiredIndices } = getTargetModel();
    const requiredPosition = Array.from(state.typedText).length;
    const targetIndex = requiredIndices[requiredPosition];
    const expected = characters[targetIndex];
    if (expected === undefined) return;

    const matches =
      normalizeInputCharacter(character) === normalizeInputCharacter(expected);

    if (!matches) {
      const missedSpace = /\s/u.test(expected) && !/\s/u.test(character);
      state.wrongIndex = targetIndex;
      state.isResettingWord = true;
      state.sentenceMistakes += 1;
      state.totalMistakes += 1;
      playTypingSound("wrong");
      showTypingFeedback("wrong", "本词有误，请重新输入", 900);
      renderTypingState();
      const feedbackTarget =
        state.elements.characterSlots.querySelector(
          ".elt-word-resetting, .elt-space-slot.elt-slot-wrong",
        ) ||
        state.elements.characterSlots;
      feedbackTarget.classList.remove("elt-shake");
      void feedbackTarget.offsetWidth;
      feedbackTarget.classList.add("elt-shake");

      if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
      const preservedPrefix = getPreservedPrefixAfterMistake(
        state.typedText,
        missedSpace,
      );
      state.feedbackTimer = window.setTimeout(() => {
        state.typedText = preservedPrefix;
        state.wrongIndex = -1;
        state.isResettingWord = false;
        state.feedbackTimer = 0;
        renderTypingState();
      }, WRONG_FEEDBACK_MS);
      return;
    }

    state.wrongIndex = -1;
    state.typedText += expected;
    const sentenceComplete =
      Array.from(state.typedText).length === requiredIndices.length;
    const nextTargetIndex = requiredIndices[requiredPosition + 1];
    const wordComplete =
      !/\s/u.test(expected) &&
      (nextTargetIndex === undefined || /\s/u.test(characters[nextTargetIndex]));
    if (sentenceComplete) {
      playTypingSound("complete");
      showTypingFeedback("correct", "整句正确", 1000);
    } else if (wordComplete) {
      playTypingSound("word");
      showTypingFeedback("correct", "单词正确", 520);
    } else {
      playTypingSound("key");
    }
    renderTypingState();

    if (sentenceComplete) {
      state.completedIndices.add(state.index);
      state.completed = state.completedIndices.size;
      state.phase = "replaying";
      render();
      state.timer = window.setTimeout(() => {
        void playSegment(state.index, "replaying", false);
      }, 260);
    }
  }

  function findCurrentWordStart(acceptedCharacters) {
    for (let index = acceptedCharacters.length - 1; index >= 0; index -= 1) {
      if (/\s/u.test(acceptedCharacters[index])) return index + 1;
    }
    return 0;
  }

  function getPreservedPrefixAfterMistake(typedText, missedSpace) {
    if (missedSpace) return typedText;
    const acceptedCharacters = Array.from(typedText);
    return acceptedCharacters
      .slice(0, findCurrentWordStart(acceptedCharacters))
      .join("");
  }

  function previousSentence() {
    void playSegment(Math.max(0, state.index - 1), "listening", true);
  }

  function replaySentence() {
    const isReviewing =
      state.completedIndices.has(state.index) &&
      ["replaying", "reviewing", "reviewingPlayback"].includes(state.phase);
    void playSegment(
      state.index,
      isReviewing ? "reviewingPlayback" : "listening",
      false,
    );
  }

  function skipSentence() {
    const nextIndex = state.index + 1;
    if (nextIndex >= state.segments.length) {
      stopScheduledWork();
      state.runId += 1;
      state.video?.pause();
      state.phase = "complete";
      render();
      return;
    }
    void playSegment(nextIndex, "listening", true);
  }

  function replayCompletedSentence() {
    const sentence = getCompletedSentence(state.segments, state.index, state.completedIndices);
    if (!sentence) return;
    return playSegment(state.index, "reviewingPlayback", false, sentence);
  }

  function toggleAnswer(event) {
    event?.preventDefault();
    if (state.phase !== "typing") return;
    state.showAnswer = !state.showAnswer;
    if (!state.showAnswer) closeDictionaryImmediately();
    renderTypingState();
  }

  function restartTraining() {
    state.completed = 0;
    state.totalMistakes = 0;
    state.completedIndices = new Set();
    void playSegment(0, "listening", true);
  }

  function cyclePlaybackRate() {
    if (!state.video) return;
    const currentIndex = PLAYBACK_RATES.findIndex(
      (rate) => Math.abs(rate - state.video.playbackRate) < 0.01,
    );
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
    state.video.playbackRate = nextRate;
    state.elements.speed.textContent = `${nextRate}×`;
  }

  function toggleTypingSound(event) {
    event?.preventDefault();
    event?.stopPropagation();
    state.soundEnabled = !state.soundEnabled;
    renderSoundToggle();
  }

  function renderSoundToggle() {
    if (!state.elements.sound) return;
    state.elements.sound.textContent = state.soundEnabled ? "音效 开" : "音效 关";
    state.elements.sound.setAttribute("aria-pressed", String(state.soundEnabled));
  }

  function handleOverlayShortcut(event) {
    if (!state.overlay) return;

    // Preserve native keyboard navigation inside the panel and dictionary.
    if (event.key !== "Escape" && event.target?.closest?.("#elt-panel, #elt-dictionary, .elt-review-word")) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeTrainer();
      return;
    }

    if (event.key === "Tab" && state.phase === "typing") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) toggleAnswer(event);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
      event.preventDefault();
      event.stopImmediatePropagation();
      replaySentence();
      return;
    }

    if (
      state.phase === "reviewing" &&
      (event.key === "Enter" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      skipSentence();
      return;
    }

    if (state.phase === "typing") {
      event.stopImmediatePropagation();

      if (state.isResettingWord) {
        event.preventDefault();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        const accepted = Array.from(state.typedText);
        if (accepted.length > 0) {
          accepted.pop();
          playTypingSound("delete");
        }
        state.typedText = accepted.join("");
        state.wrongIndex = -1;
        renderTypingState();
        return;
      }

      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        handleTypingCharacter(event.key);
      }
      return;
    }

    if (event.code === "Space" && state.video) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.phase === "reviewing") {
        replaySentence();
        return;
      }
      if (state.video.paused) {
        void state.video.play().catch(() => {
          state.error = "浏览器阻止了自动播放，请点击“重播本句”。";
          render();
        });
      } else {
        state.video.pause();
      }
    }
  }

  function handleOverlayKeyUp(event) {
    if (!state.overlay) return;

    if (state.phase === "typing") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

  }

  function startPanelResize(event) {
    event.preventDefault();
    const container = state.elements.panel?.parentElement;
    if (!container) return;

    state.elements.divider.classList.add("elt-divider-active");

    const handleMove = (moveEvent) => {
      const bounds = container.getBoundingClientRect();
      const width = ((bounds.right - moveEvent.clientX) / bounds.width) * 100;
      state.panelWidth = Math.max(20, Math.min(50, width));
      state.elements.panel.style.width = `${state.panelWidth}%`;
    };

    const handleEnd = () => {
      state.elements.divider.classList.remove("elt-divider-active");
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleEnd, true);
    };

    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleEnd, true);
  }

  function showTypingFeedback(type, message, durationMs) {
    const feedback = state.elements.typingFeedback;
    if (!feedback) return;
    if (state.typingFeedbackTimer) clearTimeout(state.typingFeedbackTimer);
    feedback.className = `elt-typing-feedback elt-typing-feedback-${type}`;
    feedback.textContent = message;
    void feedback.offsetWidth;
    feedback.classList.add("elt-typing-feedback-pop");
    state.typingFeedbackTimer = window.setTimeout(() => {
      clearTypingFeedback();
    }, durationMs);
  }

  function clearTypingFeedback() {
    if (state.typingFeedbackTimer) clearTimeout(state.typingFeedbackTimer);
    state.typingFeedbackTimer = 0;
    const feedback = state.elements.typingFeedback;
    if (!feedback) return;
    feedback.className = "elt-typing-feedback elt-hidden";
    feedback.textContent = "";
  }

  function openLocalPreview() {
    const previewRoot = document.documentElement;
    if (previewRoot.dataset.eltPreview !== "true") return;

    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return;

    createOverlay();
    state.video = video;
    moveVideoIntoTrainer(video);
    state.segments = [
      {
        id: 0,
        text: "Small steps every day lead to remarkable progress.",
        startMs: 0,
        endMs: 6200,
      },
      {
        id: 1,
        text: "Listen carefully, then type the sentence you heard.",
        startMs: 6500,
        endMs: 12800,
      },
      {
        id: 2,
        text: "Practice makes unfamiliar sounds feel natural.",
        startMs: 13100,
        endMs: 18700,
      },
      {
        id: 3,
        text: "Confidence grows one correct word at a time.",
        startMs: 19000,
        endMs: 24500,
      },
    ];
    // Synthetic timings are only for the visual demo, not production captions.
    state.segments[0].wordTimings = [...state.segments[0].text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
      .map((match, index) => ({ start: match.index, end: match.index + match[0].length,
        startMs: index * 550, endMs: (index + 1) * 550 }));
    state.trackLabel = "English · 预览字幕";
    state.index = 0;
    state.phase = "typing";
    state.completedIndices = new Set();
    state.settings = {
      translationEnabled: true,
      completionMode: "manual",
      apiKeyConfigured: true,
      model: "deepseek-v4-flash",
    };
    state.videoId = "preview";
    if (new URL(location.href).searchParams.get("scenario") === "context") {
      state.segments = modules.captions.buildPracticeSegments([
        { text: "Listen to the speaker", startMs: 200, endMs: 1800 },
        { text: "then try it yourself.", startMs: 1800, endMs: 4600 },
      ]);
      state.index = 1;
      state.typedText = "then try it yourself";
      state.completedIndices = new Set([0, 1]);
      state.phase = "reviewing";
      state.settings.translationEnabled = false;
    }
    if (new URL(location.href).searchParams.get("scenario") === "review") {
      state.completedIndices.add(0);
      state.phase = "reviewing";
    }
    state.translations = new Map();
    state.translationGeneration += 1;
    void prefetchTranslations(0);
    render();
    focusKeyboardCapture();
  }

  if (globalThis.__ELT_TEST__) {
    globalThis.__ELT_TEST_API__ = {
      state,
      playSegment,
      replayCompletedSentence,
      getSegmentPlaybackStartMs,
      skipSentence,
      joinCaptionText,
      mergeCuesIntoSentences,
      splitSegmentsForPractice,
      segmentTextIntoSentences,
    };
  }

  if (document.documentElement.dataset.eltLearning === "true") {
    void openStandaloneTrainer();
    window.addEventListener("pagehide", () => state.video?.destroy?.());
  } else {
    openLocalPreview();
  }
})();
