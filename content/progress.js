(() => {
  function createProgressController(state, onStatus) {
    let enabled = false;
    let timer = 0;
    let lastSaved = "";
    let latest = "";
    let inFlight = 0;

    function snapshot() {
      return { index: state.index, typedText: state.typedText,
        completedIndices: [...state.completedIndices], sentenceMistakes: state.sentenceMistakes,
        totalMistakes: state.totalMistakes, phase: state.phase === "complete" ? "complete" :
          state.completedIndices.has(state.index) ? "reviewing" : "listening",
        playbackRate: state.video?.playbackRate || 1, soundEnabled: state.soundEnabled };
    }

    async function flush() {
      clearTimeout(timer);
      timer = 0;
      if (!enabled || !state.segments.length || ["loading", "error"].includes(state.phase)) return;
      const progress = snapshot();
      const serialized = JSON.stringify(progress);
      if ((!inFlight && serialized === lastSaved) || (inFlight && serialized === latest)) return;
      latest = serialized;
      inFlight += 1;
      try {
        const response = await chrome.runtime.sendMessage({ type: "ELT_SAVE_PROGRESS", progress });
        if (!response?.ok) throw new Error(response?.error || "扩展未响应");
        if (latest === serialized) {
          lastSaved = serialized;
          onStatus("进度已保存到本机", false);
        }
      } catch (error) {
        if (latest === serialized) onStatus(`进度未保存：${error.message}。点击重试`, true);
      } finally { inFlight -= 1; }
    }

    function schedule() {
      if (!enabled || timer) return;
      timer = setTimeout(() => { void flush(); }, 200);
    }

    function restore(progress) {
      if (!progress || !Number.isInteger(progress.index) || !state.segments[progress.index]) return false;
      state.index = progress.index;
      state.completedIndices = new Set((progress.completedIndices || [])
        .filter(index => Number.isInteger(index) && state.segments[index]));
      state.completed = state.completedIndices.size;
      // Retain only a valid accepted prefix; answers and transient playback state stay hidden.
      const requiredText = Array.from(state.segments[state.index].text)
        .filter(character => /[\p{L}\p{N}'’\s]/u.test(character)).join("");
      state.typedText = typeof progress.typedText === "string" && requiredText.startsWith(progress.typedText)
        ? progress.typedText : "";
      state.sentenceMistakes = progress.sentenceMistakes || 0;
      state.totalMistakes = progress.totalMistakes || 0;
      state.soundEnabled = progress.soundEnabled !== false;
      state.video.playbackRate = [0.75, 1, 1.25, 1.5].includes(progress.playbackRate) ? progress.playbackRate : 1;
      state.phase = progress.phase === "complete" ? "complete" :
        state.completedIndices.has(state.index) ? "reviewing" : "listening";
      return true;
    }

    return { schedule, flush, restore, enable() { enabled = true; } };
  }
  (globalThis.EnglishListeningTyping ||= {}).createProgressController = createProgressController;
})();
