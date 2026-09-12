(() => {
  const errors = {
    2: "视频地址无效，请返回 YouTube 重新打开。",
    5: "当前浏览器暂时无法播放此视频，请刷新学习页重试。",
    100: "视频已不可用或设为私密，请返回 YouTube 确认。",
    101: "作者不允许此视频嵌入播放，请返回 YouTube 换一个视频。",
    150: "作者不允许此视频嵌入播放，请返回 YouTube 换一个视频。",
    153: "YouTube 未能验证播放器来源，请重新加载扩展后再打开学习页。",
    network: "无法连接 YouTube 播放器，请检查网络并刷新学习页。",
  };

  function createYouTubeVideo(container, videoId, startTime) {
    const channel = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.title = "YouTube 原声视频";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.className = "elt-youtube-frame";
    const hash = new URLSearchParams({ channel, video: videoId, start: String(startTime) });
    frame.src = `player.html#${hash}`;
    let resolveReady, rejectReady;
    let request = 0;
    let time = startTime;
    let destroyed = false;
    let ready = false;
    let failure = null;
    let clipEnd = null;
    let rate = 1;
    const send = (command, value) => frame.contentWindow?.postMessage({ channel, type: "command", command, value, request }, location.origin);
    const video = {
      paused: true, ended: false, duration: NaN,
      get currentTime() { return time; },
      set currentTime(value) { time = value; },
      get playbackRate() { return rate; },
      set playbackRate(value) { rate = value; send("rate", value); },
      ready: new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }),
      playSegment(start, end) {
        if (failure) return Promise.reject(new Error(failure));
        if (!ready || destroyed) return Promise.reject(new Error("播放器尚未就绪"));
        request += 1;
        time = start;
        clipEnd = end;
        video.ended = false;
        send("segment", { start, end });
        return Promise.resolve();
      },
      play() { send("play"); return Promise.resolve(); },
      pause() { send("pause"); video.paused = true; },
      destroy() {
        destroyed = true;
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        frame.remove();
      },
      onError: null, onBlocked: null,
    };
    const timeout = setTimeout(() => rejectReady(new Error("播放器加载超时，请检查 YouTube 网络连接后刷新。")), 25000);
    function receive(event) {
      if (destroyed || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== channel) return;
      const data = event.data;
      if (data.type === "ready") { ready = true; clearTimeout(timeout); resolveReady(); }
      if (data.type === "state" && data.request === request) {
        // Hold the requested position until the asynchronous seek is observed;
        // stale positions must never end a newly selected exercise immediately.
        if (data.positionReady && Number.isFinite(data.time) && (clipEnd === null || data.time < clipEnd || data.ended)) time = data.time;
        video.duration = data.duration;
        video.paused = data.paused;
        video.ended = data.ended;
        rate = data.rate || rate;
      }
      if (data.type === "blocked") video.onBlocked?.();
      if (data.type === "error") {
        clearTimeout(timeout);
        const message = errors[data.code] || `视频无法嵌入播放（${data.code}），请返回 YouTube 查看。`;
        failure = message;
        if (!ready) rejectReady(new Error(message));
        else video.onError?.(message);
      }
    }
    window.addEventListener("message", receive);
    container.appendChild(frame);
    return video;
  }
  (globalThis.EnglishListeningTyping ||= {}).createYouTubeVideo = createYouTubeVideo;
})();
