(() => {
  function createTranscriptLoader(captions, setLoadingMessage) {
    const {
      applyWordTimingsToSegments,
      collectTimedTokens,
      hasWordTiming,
      mergeCuesIntoSentences,
      parseCaptionBody,
      splitSegmentsForPractice,
    } = captions;

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


    return Object.freeze({ loadSubtitleSegments, getVideoId });
  }

  const namespace = (globalThis.EnglishListeningTyping ||= {});
  namespace.createTranscriptLoader = createTranscriptLoader;
})();
