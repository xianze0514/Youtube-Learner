// The official IFrame API is bundled locally for Manifest V3. Video code
// stays inside YouTube's cross-origin iframe; no remote scripts run here.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const channel = params.get("channel");
  const videoId = params.get("video");
  if (!channel || !/^[\w-]{11}$/.test(videoId || "")) return;
  let player;
  let ready = false;
  let interval;
  let clip = null;
  let clipEnded = false;
  let activeRequest = 0;
  const send = (type, data = {}) => parent.postMessage({ channel, type, ...data }, location.origin);

  function snapshot() {
    if (!ready) return;
    const time = player.getCurrentTime();
    const playbackState = player.getPlayerState();
    if (clip && playbackState === 1) {
      // Do not finish using stale pre-seek state. First observe the requested
      // playback position before enabling the end-of-sentence boundary.
      if (!clip.started && time >= clip.start - .3 && time < clip.end) clip.started = true;
      if (clip.started && time >= clip.end - .035) {
        player.pauseVideo();
        clipEnded = true;
        clip = null;
      }
    }
    send("state", { request: activeRequest, time, duration: player.getDuration(), rate: player.getPlaybackRate(),
      positionReady: !clip || clip.started, paused: playbackState !== 1, ended: clipEnded || (!clip && playbackState === 0) });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || event.data.type !== "command" || !ready) return;
    const { command, value, request } = event.data;
    if (command === "segment" && Number.isFinite(value?.start) && Number.isFinite(value?.end) && value.end > value.start) {
      activeRequest = request;
      clipEnded = false;
      clip = { start: Math.max(0, value.start), end: value.end, started: false };
      player.seekTo(clip.start, true);
      player.playVideo();
    } else if (command === "pause") {
      player.pauseVideo();
    } else if (command === "play") {
      player.playVideo();
    } else if (command === "rate" && [.75, 1, 1.25, 1.5].includes(value)) {
      player.setPlaybackRate(value);
    }
  });

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player("youtube-player", {
      videoId,
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, controls: 1, rel: 0, start: Math.floor(Number(params.get("start")) || 0) },
      events: {
        onReady: () => { ready = true; send("ready"); interval = setInterval(snapshot, 50); snapshot(); },
        onStateChange: snapshot,
        onPlaybackRateChange: snapshot,
        onAutoplayBlocked: () => send("blocked"),
        onError: (event) => send("error", { code: event.data }),
      },
    });
  };
  window.addEventListener("pagehide", () => { clearInterval(interval); player?.destroy?.(); });
})();
