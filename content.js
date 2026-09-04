(() => {
  if (globalThis.__englishListeningTypingLoaded) return;
  globalThis.__englishListeningTypingLoaded = true;

  const OVERLAY_ID = "elt-overlay";
  const END_TOLERANCE_SECONDS = 0.035;
  const NEXT_SENTENCE_DELAY_MS = 350;
  const WRONG_FEEDBACK_MS = 320;
  const SOURCE_BOUNDARY_PREROLL_MS = 120;
  const ESTIMATED_BOUNDARY_PREROLL_MS = 700;
  const TIMING_ALIGNMENT_WINDOW_BEFORE_MS = 2500;
  const TIMING_ALIGNMENT_WINDOW_AFTER_MS = 3500;
  const SOFT_SENTENCE_GAP_MS = 650;
  const HARD_SENTENCE_GAP_MS = 1500;
  const MAX_SENTENCE_DURATION_MS = 24000;
  const MAX_SENTENCE_CHARACTERS = 280;
  const PRACTICE_TARGET_WORDS = 11;
  const PRACTICE_MAX_WORDS = 14;
  const PRACTICE_MIN_WORDS = 5;
  const PRACTICE_MAX_CHARACTERS = 96;
  const PRACTICE_MAX_DURATION_MS = 8500;
  const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5];
  const TRANSLATION_PRELOAD_SIZE = 10;
  const TRANSLATION_TRIGGER_THRESHOLD = 5;
  const TYPING_SOUND_MASTER_GAIN = 2.4;
  const dictionaryCache = new Map();

  const state = {
    overlay: null,
    video: null,
    originalVideo: null,
    segments: [],
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
    overlay.innerHTML = `
      <header class="elt-header">
        <div class="elt-brand">
          <div>
            <strong>专注模式</strong>
            <span id="elt-track-label">YouTube 原声字幕</span>
          </div>
        </div>
        <div class="elt-header-center" id="elt-video-title">听写打字训练</div>
        <button id="elt-close" class="elt-exit-button" type="button">
          退出
        </button>
      </header>

      <main class="elt-workbench">
        <div class="elt-content">
          <section class="elt-video-stage">
            <div id="elt-video-shell" class="elt-video-shell"></div>

            <div id="elt-loading" class="elt-center-state">
              <div class="elt-spinner"></div>
              <h2>正在准备训练</h2>
              <p id="elt-loading-message">正在读取视频信息……</p>
            </div>

            <div id="elt-error" class="elt-center-state elt-hidden">
              <div class="elt-state-mark">!</div>
              <h2>暂时无法开始</h2>
              <p id="elt-error-message"></p>
              <button id="elt-error-close" class="elt-button elt-button-secondary" type="button">返回视频</button>
            </div>

            <div id="elt-complete" class="elt-center-state elt-hidden">
              <div class="elt-complete-mark">完成</div>
              <h2>本次训练完成</h2>
              <p id="elt-complete-summary"></p>
              <button id="elt-restart" class="elt-button elt-button-primary" type="button">从头再练一次</button>
            </div>

            <div id="elt-practice" class="elt-practice elt-hidden" tabindex="-1">
              <input
                id="elt-keyboard-capture"
                class="elt-keyboard-capture"
                type="text"
                tabindex="-1"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                aria-hidden="true"
              />
              <div class="elt-dictation-card" aria-live="polite">
                <div class="elt-phase-row">
                  <span id="elt-phase-title" class="elt-phase-title"></span>
                  <span id="elt-typing-feedback" class="elt-typing-feedback elt-hidden"></span>
                  <span id="elt-counter" class="elt-counter"></span>
                </div>
                <p id="elt-phase-detail" class="elt-phase-detail"></p>
                <div id="elt-character-slots" class="elt-character-slots" aria-label="听写输入区域"></div>
                <div id="elt-translation" class="elt-translation elt-hidden" aria-live="polite"></div>
                <p id="elt-play-error" class="elt-play-error"></p>
                <div class="elt-dictation-meta">
                  <span id="elt-character-count"></span>
                  <span id="elt-mistake-count"></span>
                  <button id="elt-show-answer" class="elt-hold-answer" type="button">Tab 查看答案并查词</button>
                </div>
              </div>
            </div>

            <aside id="elt-dictionary" class="elt-dictionary elt-hidden" aria-live="polite"></aside>
          </section>

          <div id="elt-divider" class="elt-divider" role="separator" aria-label="调整字幕列表宽度"></div>

          <aside id="elt-panel" class="elt-panel">
            <div class="elt-panel-header">
              <div>
                <h2>字幕列表</h2>
                <p id="elt-panel-summary">训练进度</p>
              </div>
              <span id="elt-panel-count" class="elt-panel-count"></span>
            </div>
            <div id="elt-subtitle-list" class="elt-subtitle-list"></div>
            <div class="elt-panel-footer">已完成字幕会自动显示，当前句与后续句保持隐藏</div>
          </aside>
        </div>

        <footer class="elt-controls">
          <div class="elt-control-group">
            <button id="elt-previous" class="elt-control-button" type="button">上一句</button>
            <button id="elt-replay" class="elt-control-button elt-control-main" type="button">重播本句</button>
            <button id="elt-skip" class="elt-control-button" type="button">下一句</button>
          </div>
          <div class="elt-timeline">
            <div class="elt-progress-track"><div id="elt-progress-bar" class="elt-progress-bar"></div></div>
            <div class="elt-timeline-copy">
              <span id="elt-segment-time">00:00</span>
              <span id="elt-shortcut-hint">直接打字 · Ctrl J 重播 · Esc 退出</span>
            </div>
          </div>
          <div class="elt-control-group elt-control-group-right">
            <button id="elt-settings" class="elt-control-button elt-settings-button" type="button" title="训练设置" aria-label="打开训练设置">设置</button>
            <button id="elt-sound" class="elt-control-button elt-sound-toggle" type="button" aria-pressed="true">音效 开</button>
            <button id="elt-speed" class="elt-control-button" type="button">1×</button>
            <span id="elt-total-mistakes" class="elt-total-mistakes">错误 0</span>
          </div>
        </footer>
      </main>
    `;

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
      panel: overlay.querySelector("#elt-panel"),
      panelSummary: overlay.querySelector("#elt-panel-summary"),
      panelCount: overlay.querySelector("#elt-panel-count"),
      subtitleList: overlay.querySelector("#elt-subtitle-list"),
      divider: overlay.querySelector("#elt-divider"),
      dictionary: overlay.querySelector("#elt-dictionary"),
    };

    state.elements.videoTitle.textContent = getVideoTitle();

    overlay.querySelector("#elt-close").addEventListener("click", closeTrainer);
    overlay.querySelector("#elt-error-close").addEventListener("click", closeTrainer);
    overlay.querySelector("#elt-restart").addEventListener("click", restartTraining);
    state.elements.previous.addEventListener("click", previousSentence);
    state.elements.replay.addEventListener("click", replaySentence);
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
    overlay.addEventListener("click", () => focusKeyboardCapture());
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

      const returnedIds = new Set();
      for (const translation of response?.translations || []) {
        const id = String(translation?.id);
        const translatedText = String(translation?.translatedText || "").trim();
        if (!translatedText) continue;
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

  async function loadSubtitleSegments(playerData) {
    let tracks = Array.isArray(playerData?.captionTracks)
      ? playerData.captionTracks.filter(
          (track) => typeof track?.baseUrl === "string",
        )
      : [];
    let apiKey = playerData?.apiKey || "";
    let videoId = playerData?.videoId || getVideoId();
    let pageHtml = "";

    if (tracks.length === 0 || !apiKey) {
      const response = await fetch(location.href, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`视频页面读取失败（${response.status}）`);
      }

      pageHtml = await response.text();
      if (tracks.length === 0) tracks = extractCaptionTracks(pageHtml);
      if (!apiKey) apiKey = extractInnerTubeApiKey(pageHtml);
    }

    if (tracks.length === 0) {
      throw new Error("这个视频没有可用字幕");
    }

    const preferredTrack = chooseCaptionTrack(tracks);
    setLoadingMessage(`正在加载${getTrackLabel(preferredTrack)}……`);

    let result = null;
    if (videoId && apiKey) {
      result = await fetchCuesViaInnerTube(
        videoId,
        apiKey,
        preferredTrack,
      );
    }

    if (!result) {
      const cues = await fetchCaptionCues(preferredTrack.baseUrl, "include");
      result = { cues, track: preferredTrack, clientName: "WEB" };
    }

    const segments = splitSegmentsForPractice(
      mergeCuesIntoSentences(result.cues),
    );
    let timingCues = result.cues;
    let timingSource = hasWordTiming(timingCues) ? result.track : null;

    if (!timingSource && videoId && apiKey) {
      const timingTrack = chooseWordTimingTrack(tracks, preferredTrack);
      if (timingTrack) {
        setLoadingMessage("正在同步逐词时间……");
        const timingResult = await fetchCuesViaInnerTube(
          videoId,
          apiKey,
          timingTrack,
        );
        if (timingResult && hasWordTiming(timingResult.cues)) {
          timingCues = timingResult.cues;
          timingSource = timingResult.track;
        }
      }
    }

    const alignedSegments = timingSource
      ? applyWordTimingsToSegments(segments, collectTimedTokens(timingCues))
      : segments;
    const timingLabel = alignedSegments.some((segment) => segment.hasExactStart)
      ? " · 逐词同步"
      : "";

    return {
      segments: alignedSegments,
      trackLabel: `${getTrackLabel(result.track)} · ${result.clientName}${timingLabel}`,
    };
  }

  function getVideoId() {
    const url = new URL(location.href);
    return (
      url.searchParams.get("v") ||
      location.pathname.match(/\/shorts\/([^/?]+)/)?.[1] ||
      null
    );
  }

  function extractInnerTubeApiKey(html) {
    return (
      html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1] || ""
    );
  }

  async function fetchCuesViaInnerTube(videoId, apiKey, preferredTrack) {
    try {
      const pageResult = await chrome.runtime.sendMessage({
        type: "ELT_FETCH_TRANSCRIPT",
        options: {
          videoId,
          apiKey,
          languageCode: preferredTrack?.languageCode,
          isAutomatic: preferredTrack?.kind === "asr",
        },
      });

      if (pageResult?.text) {
        const cues = parseCaptionBody(pageResult.text);
        if (cues.length > 0) {
          return {
            cues,
            track: pageResult.track || preferredTrack,
            clientName: pageResult.clientName || "InnerTube",
          };
        }
      }
    } catch (error) {
      console.warn(
        "[English Listening Typing] 页面内字幕请求失败，尝试备用方式：",
        error,
      );
    }

    const clients = [
      {
        name: "ANDROID",
        version: "20.10.38",
        extra: { androidSdkVersion: 30 },
      },
      { name: "IOS", version: "20.10.4", extra: {} },
      { name: "MWEB", version: "2.20250312.04.00", extra: {} },
    ];
    const failures = [];

    for (const client of clients) {
      try {
        setLoadingMessage(`正在通过 ${client.name} 获取字幕……`);
        const response = await fetch(
          `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            body: JSON.stringify({
              context: {
                client: {
                  clientName: client.name,
                  clientVersion: client.version,
                  hl: "en",
                  ...client.extra,
                },
              },
              videoId,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`player HTTP ${response.status}`);
        }

        const playerResponse = await response.json();
        const tracks =
          playerResponse?.captions?.playerCaptionsTracklistRenderer
            ?.captionTracks || [];
        if (tracks.length === 0) throw new Error("没有返回字幕轨");

        const selectedTrack = selectMatchingTrack(tracks, preferredTrack);
        const cues = await fetchCaptionCues(selectedTrack.baseUrl, "omit");
        if (cues.length > 0) {
          return { cues, track: selectedTrack, clientName: client.name };
        }
      } catch (error) {
        failures.push(
          `${client.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.warn(
      "[English Listening Typing] InnerTube 字幕获取失败：",
      failures.join(" | "),
    );
    return null;
  }

  function selectMatchingTrack(tracks, preferredTrack) {
    const languageCode = preferredTrack?.languageCode;
    const isAutomatic = preferredTrack?.kind === "asr";
    const baseLanguage = getBaseLanguage(languageCode);

    return (
      tracks.find(
        (track) =>
          track.languageCode === languageCode &&
          (track.kind === "asr") === isAutomatic,
      ) ||
      tracks.find(
        (track) =>
          getBaseLanguage(track.languageCode) === baseLanguage &&
          (track.kind === "asr") === isAutomatic,
      ) ||
      tracks.find((track) => track.languageCode === languageCode) ||
      tracks.find(
        (track) => getBaseLanguage(track.languageCode) === baseLanguage,
      ) ||
      chooseCaptionTrack(tracks)
    );
  }

  function extractCaptionTracks(html) {
    const marker = '"captionTracks":';
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) return [];

    const arrayStart = html.indexOf("[", markerIndex + marker.length);
    if (arrayStart === -1) return [];

    const json = extractBalancedJson(html, arrayStart, "[", "]");
    if (!json) return [];

    try {
      const tracks = JSON.parse(json);
      return Array.isArray(tracks)
        ? tracks.filter((track) => typeof track?.baseUrl === "string")
        : [];
    } catch {
      return [];
    }
  }

  function extractBalancedJson(source, start, openCharacter, closeCharacter) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const character = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === openCharacter) {
        depth += 1;
      } else if (character === closeCharacter) {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }

    return null;
  }

  function chooseCaptionTrack(tracks) {
    return [...tracks].sort((left, right) => {
      const leftEnglish = left.languageCode?.toLowerCase().startsWith("en")
        ? 0
        : 1;
      const rightEnglish = right.languageCode?.toLowerCase().startsWith("en")
        ? 0
        : 1;
      if (leftEnglish !== rightEnglish) return leftEnglish - rightEnglish;

      const leftAutomatic = left.kind === "asr" ? 1 : 0;
      const rightAutomatic = right.kind === "asr" ? 1 : 0;
      return leftAutomatic - rightAutomatic;
    })[0];
  }

  function getBaseLanguage(languageCode) {
    return String(languageCode || "").toLowerCase().split("-")[0];
  }

  function chooseWordTimingTrack(tracks, preferredTrack) {
    const baseLanguage = getBaseLanguage(preferredTrack?.languageCode);
    if (!baseLanguage) return null;

    const automaticTrack = tracks.find(
      (track) =>
        track.kind === "asr" &&
        getBaseLanguage(track.languageCode) === baseLanguage,
    );
    if (automaticTrack) return automaticTrack;

    // 部分 InnerTube 客户端返回的初始列表不含 ASR 轨。构造请求描述，
    // 后台会在新获取的轨道列表中按基础语言和 kind 再匹配一次。
    return {
      languageCode: preferredTrack.languageCode,
      kind: "asr",
      name: { simpleText: "English word timing" },
    };
  }

  function getTrackLabel(track) {
    const name =
      track.name?.simpleText ||
      track.name?.runs?.map((run) => run.text).join("") ||
      track.languageCode ||
      "视频字幕";
    return track.kind === "asr" ? `${name}（自动生成）` : name;
  }

  async function fetchCaptionCues(baseUrl, credentials) {
    const attempts = ["json3", "original"];
    const failures = [];

    for (const format of attempts) {
      try {
        const captionUrl = new URL(baseUrl, "https://www.youtube.com");
        if (format === "json3") {
          captionUrl.searchParams.set("fmt", "json3");
        } else {
          captionUrl.searchParams.delete("fmt");
        }

        const response = await fetch(captionUrl.toString(), { credentials });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const body = await response.text();
        if (!body.trim()) throw new Error("空内容");
        const cues = parseCaptionBody(body);
        if (cues.length === 0) throw new Error("没有可解析的字幕");
        return cues;
      } catch (error) {
        failures.push(
          `${format}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw new Error(`字幕接口读取失败（${failures.join("；")}）`);
  }

  function parseCaptionBody(body) {
    try {
      const data = JSON.parse(body);
      return parseJson3Cues(data.events || []);
    } catch {
      return parseXmlCues(body);
    }
  }

  function parseJson3Cues(events) {
    return events
      .filter((event) => Array.isArray(event.segs))
      .map((event) => {
        const text = cleanCaptionText(
          event.segs.map((segment) => segment.utf8 || "").join(""),
        );
        const startMs = Number(event.tStartMs) || 0;
        const durationMs = Math.max(Number(event.dDurationMs) || 0, 250);
        const endMs = startMs + durationMs;
        const hasOffsets = event.segs.some(
          (segment) =>
            Number.isFinite(Number(segment.tOffsetMs)) &&
            Number(segment.tOffsetMs) > 0,
        );
        const tokens = hasOffsets
          ? event.segs.flatMap((segment, index) => {
              const value = cleanCaptionText(segment.utf8 || "");
              if (!value) return [];

              const nextSegment = event.segs[index + 1];
              const tokenStartMs = Number.isFinite(Number(segment.tOffsetMs))
                ? startMs + Number(segment.tOffsetMs)
                : startMs;
              const tokenEndMs = Number.isFinite(Number(nextSegment?.tOffsetMs))
                ? startMs + Number(nextSegment.tOffsetMs)
                : endMs;
              const words = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ||
                value.split(/\s+/u).filter(Boolean);
              const wordDuration = Math.max(1, tokenEndMs - tokenStartMs) /
                Math.max(1, words.length);

              return words.map((word, wordIndex) => ({
                text: word,
                startMs: tokenStartMs + wordDuration * wordIndex,
                endMs: tokenStartMs + wordDuration * (wordIndex + 1),
              }));
            })
          : [];
        return { text, startMs, endMs, tokens };
      })
      .filter((cue) => cue.text);
  }

  function hasWordTiming(cues) {
    return cues.some((cue) => Array.isArray(cue.tokens) && cue.tokens.length > 1);
  }

  function collectTimedTokens(cues) {
    const tokens = cues
      .flatMap((cue) => cue.tokens || [])
      .filter(
        (token) =>
          normalizeAlignmentWord(token.text) &&
          Number.isFinite(token.startMs) &&
          Number.isFinite(token.endMs) &&
          token.endMs >= token.startMs,
      )
      .sort((left, right) => left.startMs - right.startMs);
    const unique = [];

    for (const token of tokens) {
      const previous = unique[unique.length - 1];
      const isDuplicate =
        previous &&
        normalizeAlignmentWord(previous.text) ===
          normalizeAlignmentWord(token.text) &&
        Math.abs(previous.startMs - token.startMs) <= 80;
      if (!isDuplicate) unique.push(token);
    }

    return unique.map((token, index) => ({ ...token, timingIndex: index }));
  }

  function applyWordTimingsToSegments(segments, timedTokens) {
    if (segments.length === 0 || timedTokens.length === 0) return segments;

    let nextTimingIndex = 0;
    const aligned = segments.map((segment) => {
      const candidates = timedTokens.filter(
        (token) =>
          token.timingIndex >= Math.max(0, nextTimingIndex - 2) &&
          token.endMs >= segment.startMs - TIMING_ALIGNMENT_WINDOW_BEFORE_MS &&
          token.startMs <= segment.endMs + TIMING_ALIGNMENT_WINDOW_AFTER_MS,
      );
      const alignment = alignSegmentWords(segment.text, candidates);
      if (!alignment) return { ...segment };

      const firstMatch = alignment.matches.find(
        (match) => match.sourceIndex === 0,
      );
      const lastSourceIndex = alignment.sourceWordCount - 1;
      const lastMatch = [...alignment.matches]
        .reverse()
        .find((match) => match.sourceIndex === lastSourceIndex);
      const finalMatch = alignment.matches[alignment.matches.length - 1];
      if (finalMatch) {
        nextTimingIndex = Math.max(nextTimingIndex, finalMatch.token.timingIndex + 1);
      }

      return {
        ...segment,
        startMs: firstMatch ? firstMatch.token.startMs : segment.startMs,
        hasExactStart: Boolean(firstMatch),
        hasEstimatedStart: firstMatch ? false : segment.hasEstimatedStart,
        alignedEndMs: lastMatch?.token.endMs,
        timingConfidence: alignment.coverage,
      };
    });

    return aligned.map((segment, index) => {
      const next = aligned[index + 1];
      let endMs = segment.endMs;
      let hasExactEnd = false;

      // 下一个句子的第一个词是最可靠的停播边界：当前句在它开始前结束，
      // 下次则从同一个时间点稍作前置播放，不会吞掉首词。
      if (
        next?.hasExactStart &&
        next.startMs > segment.startMs + 150 &&
        next.startMs <= segment.endMs + TIMING_ALIGNMENT_WINDOW_AFTER_MS
      ) {
        endMs = next.startMs;
        hasExactEnd = true;
      } else if (
        Number.isFinite(segment.alignedEndMs) &&
        segment.alignedEndMs > segment.startMs
      ) {
        endMs = segment.alignedEndMs;
        hasExactEnd = true;
      }

      const { alignedEndMs, ...cleanSegment } = segment;
      return {
        ...cleanSegment,
        endMs: Math.max(endMs, segment.startMs + 200),
        hasExactEnd,
      };
    });
  }

  function alignSegmentWords(text, candidateTokens) {
    const sourceWords = getAlignmentWords(text);
    if (sourceWords.length === 0 || candidateTokens.length === 0) return null;

    const rowCount = sourceWords.length + 1;
    const columnCount = candidateTokens.length + 1;
    const scores = new Float64Array(rowCount * columnCount);
    const directions = new Uint8Array(rowCount * columnCount);
    const sourceGapPenalty = 2.4;
    const timingGapPenalty = 1.15;

    for (let sourceIndex = 1; sourceIndex < rowCount; sourceIndex += 1) {
      scores[sourceIndex * columnCount] = -sourceGapPenalty * sourceIndex;
      directions[sourceIndex * columnCount] = 2;
    }

    // 自动字幕窗口前后的上下文可以免费跳过，只对句子本身要求覆盖。
    for (let timingIndex = 1; timingIndex < columnCount; timingIndex += 1) {
      scores[timingIndex] = 0;
      directions[timingIndex] = 3;
    }

    for (let sourceIndex = 1; sourceIndex < rowCount; sourceIndex += 1) {
      for (let timingIndex = 1; timingIndex < columnCount; timingIndex += 1) {
        const cell = sourceIndex * columnCount + timingIndex;
        const similarity = getWordSimilarity(
          sourceWords[sourceIndex - 1],
          normalizeAlignmentWord(candidateTokens[timingIndex - 1].text),
        );
        const diagonal =
          scores[(sourceIndex - 1) * columnCount + timingIndex - 1] +
          (similarity > 0 ? similarity : -3.2);
        const skipSource =
          scores[(sourceIndex - 1) * columnCount + timingIndex] -
          sourceGapPenalty;
        const skipTiming = scores[cell - 1] - timingGapPenalty;

        if (diagonal >= skipSource && diagonal >= skipTiming) {
          scores[cell] = diagonal;
          directions[cell] = 1;
        } else if (skipSource >= skipTiming) {
          scores[cell] = skipSource;
          directions[cell] = 2;
        } else {
          scores[cell] = skipTiming;
          directions[cell] = 3;
        }
      }
    }

    let sourceIndex = sourceWords.length;
    let timingIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 1; index < columnCount; index += 1) {
      const score = scores[sourceIndex * columnCount + index];
      if (score > bestScore) {
        bestScore = score;
        timingIndex = index;
      }
    }

    const matches = [];
    while (sourceIndex > 0 && timingIndex > 0) {
      const direction = directions[sourceIndex * columnCount + timingIndex];
      if (direction === 1) {
        const similarity = getWordSimilarity(
          sourceWords[sourceIndex - 1],
          normalizeAlignmentWord(candidateTokens[timingIndex - 1].text),
        );
        if (similarity > 0) {
          matches.push({
            sourceIndex: sourceIndex - 1,
            token: candidateTokens[timingIndex - 1],
          });
        }
        sourceIndex -= 1;
        timingIndex -= 1;
      } else if (direction === 2) {
        sourceIndex -= 1;
      } else if (direction === 3) {
        timingIndex -= 1;
      } else {
        break;
      }
    }
    matches.reverse();

    const coverage = matches.length / sourceWords.length;
    const requiredMatches = Math.min(3, sourceWords.length);
    if (matches.length < requiredMatches || coverage < 0.6) return null;

    return {
      matches,
      coverage,
      sourceWordCount: sourceWords.length,
    };
  }

  function getAlignmentWords(text) {
    return (
      text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []
    ).map(normalizeAlignmentWord);
  }

  function normalizeAlignmentWord(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[‘’]/g, "'")
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
  }

  function getWordSimilarity(source, candidate) {
    if (!source || !candidate) return 0;
    if (source === candidate) return 4;
    if (source.replace(/'/g, "") === candidate.replace(/'/g, "")) return 3.5;
    if (
      Math.min(source.length, candidate.length) >= 5 &&
      hasSingleEditDifference(source, candidate)
    ) {
      return 1.5;
    }
    return 0;
  }

  function hasSingleEditDifference(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    if (left.length === right.length) {
      let differences = 0;
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) differences += 1;
        if (differences > 1) return false;
      }
      return differences === 1;
    }

    const shorter = left.length < right.length ? left : right;
    const longer = left.length < right.length ? right : left;
    let shortIndex = 0;
    let longIndex = 0;
    let skipped = false;
    while (shortIndex < shorter.length && longIndex < longer.length) {
      if (shorter[shortIndex] === longer[longIndex]) {
        shortIndex += 1;
        longIndex += 1;
      } else if (skipped) {
        return false;
      } else {
        skipped = true;
        longIndex += 1;
      }
    }
    return true;
  }

  function parseXmlCues(xml) {
    const documentNode = new DOMParser().parseFromString(xml, "text/xml");
    return [...documentNode.querySelectorAll("text")]
      .map((node) => {
        const startMs = Number(node.getAttribute("start") || 0) * 1000;
        const durationMs = Number(node.getAttribute("dur") || 0) * 1000;
        return {
          text: cleanCaptionText(node.textContent || ""),
          startMs,
          endMs: startMs + Math.max(durationMs, 250),
        };
      })
      .filter((cue) => cue.text);
  }

  function cleanCaptionText(text) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = stripCaptionMarkup(String(text || ""));
    return stripNonSpeechCues(stripCaptionMarkup(decoder.value))
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripNonSpeechCues(text) {
    const cleaned = String(text || "")
      // YouTube 使用方括号或花括号标注声音、说话人和编辑提示；这些都不属于对白。
      .replace(/\[[^\]\n]{1,80}\]|\{[^{}\n]{1,80}\}/gu, " ")
      // 圆括号可能是真实插入语，只删除明确属于非语言声音的内容。
      .replace(/\([^()\n]{1,80}\)/gu, (wrappedCue) => {
        const cue = wrappedCue.slice(1, -1);
        return isNonSpeechCue(cue) ? " " : wrappedCue;
      });

    const trimmed = cleaned
      .replace(/^\s*[,;:·–—-]+\s*/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    return trimmed;
  }

  function isNonSpeechCue(value) {
    const cue = String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[.!?…,:;·_–—-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (!cue || cue.length > 80) return false;

    return /\b(?:music|applause|clapping|laughter|laughs?|laughing|chuckles?|chuckling|giggles?|giggling|cheers?|cheering|sighs?|sighing|gasps?|gasping|coughs?|coughing|groans?|groaning|cries|crying|sobs?|sobbing|screams?|screaming|whispers?|whispering|singing|humming|mumbling|murmuring|panting|grunts?|yells?|shouts?|inaudible|unintelligible|silence|chatter|background noise|crowd noise|audience noise|sound effects?|footsteps?|knocking|beeping|buzzing|thunder|rain|wind blowing|engine revving|phone ring(?:s|ing)?|door slam(?:s|ming)?|bell ring(?:s|ing)?)\b/u.test(
      cue,
    );
  }

  function stripCaptionMarkup(text) {
    return text
      .replace(/<br\s*\/?>/gi, " ")
      .replace(
        /<\/?(?:b|i|u|strong|em|font|ruby|rt|v|c(?:\.[^\s>]+)?)(?:\s[^>]*)?>/gi,
        "",
      );
  }

  function mergeCuesIntoSentences(cues) {
    const results = [];
    let current = null;
    const sentenceFragments = cues
      .flatMap(splitCueIntoSentenceFragments)
      .filter((cue) => cue.text?.trim())
      .sort((left, right) => left.startMs - right.startMs);

    sentenceFragments.forEach((cue, cueIndex) => {
      const nextCue = sentenceFragments[cueIndex + 1];
      if (!current) {
        current = { ...cue };
      } else {
        current.text = joinCaptionText(current.text, cue.text);
        current.endMs = Math.max(current.endMs, cue.endMs);
      }

      const duration = current.endMs - current.startMs;
      const gapAfter = nextCue ? nextCue.startMs - cue.endMs : Infinity;
      const sentenceEnded = hasTerminalSentencePunctuation(current.text);
      const hasHardTimeBoundary = gapAfter >= HARD_SENTENCE_GAP_MS;
      const hasSoftSemanticBoundary =
        gapAfter >= SOFT_SENTENCE_GAP_MS &&
        looksSemanticallyComplete(current.text) &&
        nextCue &&
        looksLikeNewSentence(nextCue.text);
      const reachedSafetyLimit =
        (duration >= MAX_SENTENCE_DURATION_MS ||
          current.text.length >= MAX_SENTENCE_CHARACTERS) &&
        !looksSyntacticallyIncomplete(current.text);
      const shouldFinish =
        sentenceEnded ||
        hasHardTimeBoundary ||
        hasSoftSemanticBoundary ||
        reachedSafetyLimit ||
        !nextCue;

      if (shouldFinish) {
        results.push({
          id: results.length,
          text: current.text.trim(),
          startMs: current.startMs,
          endMs: Math.max(current.endMs, current.startMs + 400),
          hasEstimatedStart: Boolean(current.hasEstimatedStart),
        });
        current = null;
      }
    });

    return repairDanglingSentenceFragments(results)
      .filter((segment) => segment.text.length > 0)
      .map((segment, index) => ({ ...segment, id: index }));
  }

  function splitSegmentsForPractice(segments) {
    return segments
      .flatMap(splitSegmentForPractice)
      .filter((segment) => segment.text?.trim())
      .map((segment, index) => ({ ...segment, id: index }));
  }

  function splitSegmentForPractice(segment) {
    const text = String(segment?.text || "").trim();
    const words = getWordsWithOffsets(text);
    const duration = Math.max(1, segment.endMs - segment.startMs);
    const shouldSplit =
      words.length > PRACTICE_MAX_WORDS ||
      text.length > PRACTICE_MAX_CHARACTERS ||
      duration > PRACTICE_MAX_DURATION_MS;
    if (!shouldSplit || words.length < PRACTICE_MIN_WORDS * 2) {
      return [{ ...segment, text }];
    }

    const desiredChunkCount = Math.max(
      2,
      Math.ceil(words.length / PRACTICE_TARGET_WORDS),
      Math.ceil(text.length / PRACTICE_MAX_CHARACTERS),
      Math.ceil(duration / PRACTICE_MAX_DURATION_MS),
    );
    const targetWords = Math.max(
      PRACTICE_MIN_WORDS,
      Math.ceil(words.length / desiredChunkCount),
    );
    const breakWordIndices = findPracticeBreaks(text, words, targetWords);
    if (breakWordIndices.length <= 1) return [{ ...segment, text }];

    let startWordIndex = 0;
    return breakWordIndices.map((endWordIndex, chunkIndex) => {
      const startCharacter =
        startWordIndex === 0 ? 0 : words[startWordIndex].start;
      const endCharacter =
        endWordIndex >= words.length ? text.length : words[endWordIndex].start;
      const chunkText = text.slice(startCharacter, endCharacter).trim();
      const startRatio = startWordIndex / words.length;
      const endRatio = endWordIndex / words.length;
      const chunk = {
        ...segment,
        text: chunkText,
        startMs: segment.startMs + duration * startRatio,
        endMs: segment.startMs + duration * endRatio,
        hasEstimatedStart:
          chunkIndex > 0 || Boolean(segment.hasEstimatedStart),
      };
      startWordIndex = endWordIndex;
      return chunk;
    });
  }

  function findPracticeBreaks(text, words, targetWords) {
    const wordCount = words.length;
    const costs = new Float64Array(wordCount + 1);
    const previous = new Int16Array(wordCount + 1);
    costs.fill(Number.POSITIVE_INFINITY);
    previous.fill(-1);
    costs[0] = 0;

    for (let start = 0; start < wordCount; start += 1) {
      if (!Number.isFinite(costs[start])) continue;
      const remainingAtStart = wordCount - start;
      const minimumEnd = Math.min(
        wordCount,
        start + (remainingAtStart <= PRACTICE_MAX_WORDS ? 1 : PRACTICE_MIN_WORDS),
      );
      const maximumEnd = Math.min(wordCount, start + PRACTICE_MAX_WORDS);

      for (let end = minimumEnd; end <= maximumEnd; end += 1) {
        const remaining = wordCount - end;
        if (remaining > 0 && remaining < PRACTICE_MIN_WORDS) continue;

        const chunkWords = end - start;
        // 每多切一段都付出固定成本，避免为了追求平均字数而拆散完整短语。
        let cost = costs[start] + 50 + (chunkWords - targetWords) ** 2 * 2;
        if (chunkWords < PRACTICE_MIN_WORDS) cost += 80;
        if (end < wordCount) {
          cost += getPracticeBoundaryCost(text, words, end);
        }

        if (cost < costs[end]) {
          costs[end] = cost;
          previous[end] = start;
        }
      }
    }

    if (previous[wordCount] < 0) return [wordCount];
    const breaks = [];
    let cursor = wordCount;
    while (cursor > 0) {
      breaks.push(cursor);
      cursor = previous[cursor];
      if (cursor < 0) return [wordCount];
    }
    return breaks.reverse();
  }

  function getPracticeBoundaryCost(text, words, endWordIndex) {
    const previousWord = words[endWordIndex - 1];
    const nextWord = words[endWordIndex];
    const between = text.slice(previousWord.end, nextWord.start);
    const previousNormalized = previousWord.normalized;
    const nextNormalized = nextWord.normalized;
    let cost = 0;

    if (/[.!?]["'’”)]?\s*$/u.test(between)) {
      cost -= 100;
    } else if (/[;:]["'’”)]?\s*$/u.test(between)) {
      cost -= 72;
    } else if (/[,]["'’”)]?\s*$/u.test(between)) {
      cost -= 58;
    } else if (/[–—]\s*$/u.test(between)) {
      cost -= 50;
    }

    if (
      new Set([
        "and",
        "but",
        "or",
        "so",
        "yet",
        "because",
        "although",
        "though",
        "if",
        "when",
        "while",
        "which",
        "who",
        "whose",
        "where",
        "what",
        "how",
      ]).has(nextNormalized)
    ) {
      cost -= 22;
    }

    if (
      new Set([
        "a",
        "an",
        "the",
        "to",
        "of",
        "for",
        "with",
        "from",
        "into",
        "onto",
        "at",
        "by",
        "about",
        "as",
        "than",
        "and",
        "or",
        "but",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "can",
        "could",
        "should",
        "may",
        "might",
        "must",
      ]).has(previousNormalized)
    ) {
      cost += 68;
    }

    return cost;
  }

  function hasTerminalSentencePunctuation(text) {
    return /[.!?]["'’”)]?$/.test(String(text || "").trim());
  }

  function looksSemanticallyComplete(text) {
    const words = getAlignmentWords(text);
    return words.length >= 2 && !looksSyntacticallyIncomplete(text);
  }

  function looksSyntacticallyIncomplete(text) {
    const normalized = String(text || "")
      .trim()
      .toLocaleLowerCase()
      .replace(/["'’”)]*$/u, "");
    if (!normalized) return true;
    if (/[,;:\-–—]$/u.test(normalized)) return true;

    const words = getAlignmentWords(normalized);
    const lastWord = words[words.length - 1] || "";
    const strongContinuationWords = new Set([
      "a",
      "an",
      "the",
      "and",
      "or",
      "but",
      "because",
      "although",
      "though",
      "if",
      "unless",
      "when",
      "while",
      "that",
      "which",
      "who",
      "whose",
      "where",
      "how",
      "to",
      "of",
      "for",
      "with",
      "from",
      "into",
      "onto",
      "at",
      "by",
      "about",
      "as",
      "than",
      "without",
      "within",
      "between",
      "among",
      "through",
      "during",
      "before",
      "after",
      "over",
      "under",
    ]);
    if (strongContinuationWords.has(lastWord)) return true;

    return /\b(?:i|you|we|they|he|she|it|there|this|that)\s+(?:am|is|are|was|were|have|has|had|do|does|did|can|could|would|should|will|may|might|must)$/u.test(
      normalized,
    );
  }

  function looksLikeNewSentence(text) {
    const value = String(text || "").trim();
    const firstLetter = value.match(/\p{L}/u)?.[0] || "";
    if (!firstLetter || firstLetter !== firstLetter.toLocaleUpperCase()) {
      return false;
    }

    const firstWord = getAlignmentWords(value)[0] || "";
    return !new Set([
      "and",
      "or",
      "but",
      "because",
      "although",
      "though",
      "that",
      "which",
      "who",
      "whose",
      "when",
      "while",
      "where",
      "if",
      "unless",
      "than",
      "to",
      "of",
      "for",
      "with",
      "from",
      "into",
      "onto",
      "at",
      "by",
      "about",
      "as",
      "without",
      "within",
      "between",
      "among",
      "through",
      "during",
      "before",
      "after",
      "over",
      "under",
    ]).has(firstWord);
  }

  function repairDanglingSentenceFragments(segments) {
    const repaired = [];

    for (const segment of segments) {
      const previous = repaired[repaired.length - 1];
      if (previous && isRepeatedOverlappingSegment(previous, segment)) {
        previous.endMs = Math.max(previous.endMs, segment.endMs);
        continue;
      }
      if (!previous || !shouldMergeDanglingPair(previous, segment)) {
        repaired.push({ ...segment });
        continue;
      }

      previous.text = joinCaptionText(previous.text, segment.text);
      previous.endMs = Math.max(previous.endMs, segment.endMs);
    }

    return repaired;
  }

  function shouldMergeDanglingPair(previous, next) {
    const gap = next.startMs - previous.endMs;
    if (gap >= HARD_SENTENCE_GAP_MS || hasTerminalSentencePunctuation(previous.text)) {
      return false;
    }

    const nextValue = String(next.text || "").trim();
    const firstLetter = nextValue.match(/\p{L}/u)?.[0] || "";
    const startsLowercase =
      firstLetter && firstLetter === firstLetter.toLocaleLowerCase();

    return (
      looksSyntacticallyIncomplete(previous.text) ||
      startsLowercase
    );
  }

  function isRepeatedOverlappingSegment(previous, next) {
    if (next.startMs > previous.endMs) return false;
    const normalize = (value) =>
      getAlignmentWords(value).join(" ").toLocaleLowerCase();
    const previousText = normalize(previous.text);
    const nextText = normalize(next.text);
    return Boolean(previousText && previousText === nextText);
  }

  function splitCueIntoSentenceFragments(cue) {
    const text = cue.text?.trim();
    if (!text || !/[.!?]/.test(text)) return text ? [{ ...cue, text }] : [];

    const sentenceParts = segmentTextIntoSentences(text);
    if (sentenceParts.length <= 1) return [{ ...cue, text }];

    const duration = Math.max(1, cue.endMs - cue.startMs);
    return sentenceParts.map((part, index) => {
      const nextPart = sentenceParts[index + 1];
      const startRatio = part.index / text.length;
      const endRatio = nextPart ? nextPart.index / text.length : 1;
      return {
        ...cue,
        text: part.text,
        startMs: cue.startMs + duration * startRatio,
        endMs: cue.startMs + duration * endRatio,
        hasEstimatedStart: index > 0,
      };
    });
  }

  function segmentTextIntoSentences(text) {
    if (typeof Intl?.Segmenter === "function") {
      const segmenter = new Intl.Segmenter("en", {
        granularity: "sentence",
      });
      const parts = [...segmenter.segment(text)]
        .map((part) => ({ index: part.index, text: part.segment.trim() }))
        .filter((part) => part.text);
      const mergedParts = mergeAbbreviationFragments(parts);
      if (mergedParts.length > 1) return mergedParts;
    }

    const parts = [];
    const boundaryPattern = /[.!?]["'’”)]*(?=\s+\S)/g;
    let startIndex = 0;
    let match;

    while ((match = boundaryPattern.exec(text))) {
      const endIndex = match.index + match[0].length;
      const sentence = text.slice(startIndex, endIndex).trim();
      if (sentence) parts.push({ index: startIndex, text: sentence });
      startIndex = endIndex;
      while (/\s/.test(text[startIndex] || "")) startIndex += 1;
    }

    const remainder = text.slice(startIndex).trim();
    if (remainder) parts.push({ index: startIndex, text: remainder });
    return mergeAbbreviationFragments(parts);
  }

  function mergeAbbreviationFragments(parts) {
    const abbreviationPattern = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Gen|Rep|Sen|Gov|Lt|Col|Sgt|Capt|Rev|Hon|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K)\.$/i;
    const initialPattern = /(?:^|\s)[A-Z]\.$/;
    const merged = [];
    let pending = null;

    for (const part of parts) {
      pending = pending
        ? { ...pending, text: `${pending.text} ${part.text}` }
        : { ...part };

      if (
        abbreviationPattern.test(pending.text) ||
        initialPattern.test(pending.text)
      ) {
        continue;
      }

      merged.push(pending);
      pending = null;
    }

    if (pending) merged.push(pending);

    return merged;
  }

  function joinCaptionText(previous, next) {
    if (!previous) return next;
    if (!next) return previous;

    const overlap = findCaptionWordOverlap(previous, next);
    if (overlap > 0) {
      const nextWords = getWordsWithOffsets(next);
      if (overlap >= nextWords.length) {
        const trailingPunctuation = next.slice(nextWords.at(-1)?.end || 0).trim();
        if (
          trailingPunctuation &&
          !new RegExp(`${escapeRegExp(trailingPunctuation)}$`).test(previous)
        ) {
          return `${previous.replace(/\s+$/u, "")}${trailingPunctuation}`;
        }
        return previous;
      }

      const remainder = next.slice(nextWords[overlap].start).trimStart();
      return joinCaptionTextWithoutOverlap(previous, remainder);
    }

    return joinCaptionTextWithoutOverlap(previous, next);
  }

  function joinCaptionTextWithoutOverlap(previous, next) {
    if (/[-–—]$/.test(previous) || /^[,.;:!?%)}\]]/.test(next)) {
      return `${previous}${next}`;
    }
    return `${previous} ${next}`;
  }

  function findCaptionWordOverlap(previous, next) {
    const previousWords = getWordsWithOffsets(previous);
    const nextWords = getWordsWithOffsets(next);
    const maxOverlap = Math.min(16, previousWords.length, nextWords.length);

    for (let size = maxOverlap; size >= 1; size -= 1) {
      if (
        size === 1 &&
        !(previousWords.length === 1 && nextWords.length === 1)
      ) {
        continue;
      }

      const previousStart = previousWords.length - size;
      const matches = Array.from(
        { length: size },
        (_, index) =>
          previousWords[previousStart + index].normalized ===
          nextWords[index].normalized,
      ).every(Boolean);
      if (matches) return size;
    }

    return 0;
  }

  function getWordsWithOffsets(text) {
    const words = [];
    const pattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
    let match;
    while ((match = pattern.exec(String(text || "")))) {
      words.push({
        normalized: normalizeAlignmentWord(match[0]),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return words;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function findStartingIndex(segments, currentTimeMs) {
    const activeIndex = segments.findIndex(
      (segment) =>
        currentTimeMs >= segment.startMs && currentTimeMs <= segment.endMs,
    );
    if (activeIndex >= 0) return activeIndex;

    const nextIndex = segments.findIndex(
      (segment) => segment.startMs >= currentTimeMs,
    );
    return nextIndex >= 0 ? nextIndex : 0;
  }

  function getSegmentPlaybackStartMs(segment) {
    const prerollMs = segment.hasEstimatedStart
      ? ESTIMATED_BOUNDARY_PREROLL_MS
      : SOURCE_BOUNDARY_PREROLL_MS;
    return Math.max(0, segment.startMs - prerollMs);
  }

  async function playSegment(index, phase, resetInput) {
    const segment = state.segments[index];
    const video = state.video;
    if (!segment || !video || !state.overlay) return;

    stopScheduledWork();
    const runId = ++state.runId;
    state.index = index;
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
      await video.play();
    } catch (error) {
      console.error("[English Listening Typing] 视频播放失败：", error);
      state.error = "浏览器阻止了自动播放，请点击“播放本句”。";
      render();
      return;
    }

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
      state.video?.pause();
      state.phase = "complete";
      render();
      return;
    }
    void playSegment(nextIndex, "listening", true);
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

    if (isComplete) {
      state.elements.completeSummary.textContent = `完成 ${state.completedIndices.size} 句，累计错误 ${state.totalMistakes} 次`;
      renderSubtitleList();
      return;
    }

    if (!isPractice) return;

    const phaseContent = {
      listening: ["先听一遍", "专心听原声，句末会自动暂停"],
      typing: ["输入你听到的完整句子", "大小写不敏感，标点会自动跳过"],
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
    renderCharacterSlots(model);
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

  function playTypingSound(kind) {
    if (!state.soundEnabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!state.typingAudioContext) {
      state.typingAudioContext = new AudioContextClass();
      state.typingAudioMasterGain = state.typingAudioContext.createGain();
      state.typingAudioMasterGain.gain.value = TYPING_SOUND_MASTER_GAIN;
      state.typingAudioMasterGain.connect(state.typingAudioContext.destination);
    }
    const context = state.typingAudioContext;
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    const now = context.currentTime;
    if (kind === "key") {
      playMechanicalKeySound(context, now, 0.026);
      return;
    }
    if (kind === "delete") {
      playTone(context, now, 310, 0.035, 0.022, "triangle", 250);
      return;
    }
    if (kind === "wrong") {
      playTone(context, now, 190, 0.13, 0.05, "square", 135);
      return;
    }
    if (kind === "word") {
      playTone(context, now, 660, 0.075, 0.025, "sine", 760);
      return;
    }

    playTone(context, now, 523.25, 0.1, 0.035, "sine", 587.33);
    playTone(context, now + 0.085, 659.25, 0.12, 0.032, "sine", 783.99);
  }

  function playMechanicalKeySound(context, startTime, volume) {
    const duration = 0.032;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const envelope = 1 - index / length;
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1350, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    source.buffer = buffer;
    source
      .connect(filter)
      .connect(gain)
      .connect(state.typingAudioMasterGain || context.destination);
    source.start(startTime);
    source.stop(startTime + duration);
  }

  function playTone(
    context,
    startTime,
    frequency,
    duration,
    volume,
    waveform,
    endFrequency,
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequency,
        startTime + duration,
      );
    }
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator
      .connect(gain)
      .connect(state.typingAudioMasterGain || context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
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

  function cleanLookupWord(value) {
    return (
      String(value || "").match(/[\p{L}]+(?:['’][\p{L}]+)*/u)?.[0] || ""
    ).replace(/[’]/g, "'");
  }

  function scheduleDictionaryLookup(word, anchor) {
    if (!state.showAnswer || state.phase !== "typing") return;
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
    if (!dictionary || !state.showAnswer) return;

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
      if (requestId !== state.dictionaryRequestId || !state.showAnswer) return;
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
    const segment = state.segments[state.index];
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
    state.translations = new Map();
    state.translationGeneration += 1;
    void prefetchTranslations(0);
    render();
    focusKeyboardCapture();
  }

  if (globalThis.__ELT_TEST__) {
    globalThis.__ELT_TEST_API__ = {
      joinCaptionText,
      mergeCuesIntoSentences,
      splitSegmentsForPractice,
      segmentTextIntoSentences,
    };
  }

  openLocalPreview();
})();
