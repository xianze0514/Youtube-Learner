async function readPlayerData(tabId) {
  try {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const player = document.querySelector("#movie_player");
        const playerResponse =
          player?.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse;
        const tracks =
          playerResponse?.captions?.playerCaptionsTracklistRenderer
            ?.captionTracks;

        const pageUrl = new URL(location.href);
        const videoId =
          pageUrl.searchParams.get("v") ||
          location.pathname.match(/\/shorts\/([^/?]+)/)?.[1] ||
          null;
        const apiKey =
          globalThis.ytcfg?.get?.("INNERTUBE_API_KEY") ||
          globalThis.ytcfg?.data_?.INNERTUBE_API_KEY ||
          null;

        return {
          videoId,
          title: playerResponse?.videoDetails?.title || document.title.replace(/\s*-\s*YouTube\s*$/, ""),
          currentTime: player?.classList.contains("ad-showing") ? 0 : (document.querySelector("video")?.currentTime || 0),
          apiKey,
          captionTracks: Array.isArray(tracks)
            ? tracks.map((track) => ({
                baseUrl: track.baseUrl,
                languageCode: track.languageCode,
                kind: track.kind,
                name: track.name,
              }))
            : [],
        };
      },
    });
    return execution?.result || null;
  } catch {
    return null;
  }
}

async function sendToggleMessage(tabId, playerData) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "ELT_TOGGLE_TRAINER",
      playerData,
    });
    return;
  } catch {
    // 扩展刚安装时，已经打开的 YouTube 标签页还没有内容脚本。
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: [
      "styles/base.css",
      "styles/practice.css",
      "styles/dictionary.css",
      "styles/controls.css",
      "styles/responsive.css",
      "styles/review.css",
    ],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "content/captions.js",
      "content/transcript.js",
      "content/template.js",
      "content/dictionary.js",
      "content/review.js",
      "content/renderer.js",
      "content/audio.js",
      "content/main.js",
    ],
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "ELT_TOGGLE_TRAINER",
    playerData,
  });
}

async function fetchTranscriptInPage(tabId, options) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [options],
    func: async (request) => {
      const apiKey =
        globalThis.ytcfg?.get?.("INNERTUBE_API_KEY") ||
        globalThis.ytcfg?.data_?.INNERTUBE_API_KEY ||
        request.apiKey;
      const failures = [];

      const selectTrack = (tracks) => {
        const requestedBaseLanguage = String(request.languageCode || "")
          .toLowerCase()
          .split("-")[0];
        const hasRequestedKind = (track) =>
          (track.kind === "asr") === request.isAutomatic;
        const hasRequestedBaseLanguage = (track) =>
          track.languageCode?.toLowerCase().split("-")[0] ===
          requestedBaseLanguage;
        const exact = tracks.find(
          (track) =>
            track.languageCode === request.languageCode &&
            hasRequestedKind(track),
        );
        const sameBaseLanguageAndKind = tracks.find(
          (track) =>
            hasRequestedBaseLanguage(track) && hasRequestedKind(track),
        );
        const sameLanguage = tracks.find(
          (track) => track.languageCode === request.languageCode,
        );
        const sameBaseLanguage = tracks.find(hasRequestedBaseLanguage);
        const englishWithRequestedKind = tracks.find(
          (track) =>
            track.languageCode?.toLowerCase().startsWith("en") &&
            hasRequestedKind(track),
        );
        const english = tracks.find(
          (track) => track.languageCode?.toLowerCase().startsWith("en"),
        );
        return (
          exact ||
          sameBaseLanguageAndKind ||
          sameLanguage ||
          sameBaseLanguage ||
          englishWithRequestedKind ||
          english ||
          tracks[0]
        );
      };

      const fetchTrackText = async (track, credentials) => {
        const attempts = ["json3", "original"];
        const attemptFailures = [];

        for (const format of attempts) {
          try {
            const captionUrl = new URL(
              track.baseUrl,
              "https://www.youtube.com",
            );
            if (format === "json3") {
              captionUrl.searchParams.set("fmt", "json3");
            } else {
              captionUrl.searchParams.delete("fmt");
            }

            const response = await fetch(captionUrl.toString(), {
              credentials,
            });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            if (!text.trim()) throw new Error("空内容");
            return text;
          } catch (error) {
            attemptFailures.push(
              `${format}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        throw new Error(attemptFailures.join(" | "));
      };

      // 优先使用当前播放器刚生成的字幕 URL。它比再次请求 player API
      // 得到的 URL 更新，也能够带上当前页面会话所需的信息。
      try {
        const currentPlayer = document.querySelector("#movie_player");
        const currentPlayerResponse =
          currentPlayer?.getPlayerResponse?.() ||
          globalThis.ytInitialPlayerResponse;
        const currentTracks =
          currentPlayerResponse?.captions?.playerCaptionsTracklistRenderer
            ?.captionTracks || [];
        if (currentTracks.length > 0) {
          const selectedTrack = selectTrack(currentTracks);
          const text = await fetchTrackText(selectedTrack, "include");
          return {
            text,
            clientName: "WEB",
            track: {
              languageCode: selectedTrack.languageCode,
              kind: selectedTrack.kind,
              name: selectedTrack.name,
            },
          };
        }
        failures.push("WEB: 当前播放器没有返回字幕轨");
      } catch (error) {
        failures.push(
          `WEB: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!apiKey) {
        return { error: [...failures, "没有找到 InnerTube API Key"].join(" | ") };
      }

      const visitorData =
        globalThis.ytcfg?.get?.("VISITOR_DATA") ||
        globalThis.ytcfg?.data_?.VISITOR_DATA;
      const clients = [
        {
          name: "ANDROID",
          version: "20.10.38",
          extra: { androidSdkVersion: 30 },
        },
        { name: "IOS", version: "20.10.4", extra: {} },
        { name: "MWEB", version: "2.20250312.04.00", extra: {} },
      ];

      for (const client of clients) {
        try {
          const playerResponse = await fetch(
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
                    ...(visitorData ? { visitorData } : {}),
                    ...client.extra,
                  },
                },
                videoId: request.videoId,
                contentCheckOk: true,
                racyCheckOk: true,
              }),
            },
          );
          if (!playerResponse.ok) {
            throw new Error(`player HTTP ${playerResponse.status}`);
          }

          const playerData = await playerResponse.json();
          const tracks =
            playerData?.captions?.playerCaptionsTracklistRenderer
              ?.captionTracks || [];
          if (tracks.length === 0) throw new Error("没有返回字幕轨");

          const selectedTrack = selectTrack(tracks);
          const text = await fetchTrackText(selectedTrack, "omit");

          return {
            text,
            clientName: client.name,
            track: {
              languageCode: selectedTrack.languageCode,
              kind: selectedTrack.kind,
              name: selectedTrack.name,
            },
          };
        } catch (error) {
          failures.push(
            `${client.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return { error: failures.join(" | ") || "字幕获取失败" };
    },
  });

  return execution?.result || { error: "页面没有返回字幕数据" };
}


export { fetchTranscriptInPage, readPlayerData, sendToggleMessage };
