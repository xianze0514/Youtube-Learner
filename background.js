const SETTINGS_KEY = "elt_settings_v1";
const TRANSLATION_CACHE_KEY = "elt_translation_cache_v1";
const TRANSLATION_CACHE_VERSION = 1;
const TRANSLATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEEPSEEK_TRANSLATE_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_SETTINGS = Object.freeze({
  translationEnabled: true,
  completionMode: "manual",
  deepseekApiKey: "",
});

if (typeof chrome.storage.local.setAccessLevel === "function") {
  void chrome.storage.local
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => {});
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored?.[SETTINGS_KEY] || {};
  return {
    ...DEFAULT_SETTINGS,
    translationEnabled: settings.translationEnabled !== false,
    completionMode:
      settings.completionMode === "auto" ? "auto" : "manual",
    deepseekApiKey:
      typeof settings.deepseekApiKey === "string"
        ? settings.deepseekApiKey.trim()
        : "",
  };
}

function getPublicSettings(settings) {
  return {
    translationEnabled: settings.translationEnabled,
    completionMode: settings.completionMode,
    apiKeyConfigured: Boolean(settings.deepseekApiKey),
    model: DEEPSEEK_MODEL,
  };
}

function isTrustedExtensionPage(sender) {
  const senderUrl = String(sender?.url || sender?.tab?.url || "");
  return (
    sender?.id === chrome.runtime.id &&
    senderUrl.startsWith(chrome.runtime.getURL(""))
  );
}

async function saveSettings(input) {
  const current = await loadSettings();
  const next = {
    translationEnabled:
      typeof input?.translationEnabled === "boolean"
        ? input.translationEnabled
        : current.translationEnabled,
    completionMode: input?.completionMode === "auto" ? "auto" : "manual",
    deepseekApiKey:
      typeof input?.deepseekApiKey === "string"
        ? input.deepseekApiKey.trim()
        : current.deepseekApiKey,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  await broadcastPublicSettings(getPublicSettings(next));
  return next;
}

async function broadcastPublicSettings(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map((tab) =>
      tab.id
        ? chrome.tabs.sendMessage(tab.id, {
            type: "ELT_SETTINGS_UPDATED",
            settings,
          })
        : Promise.resolve(),
    ),
  );
}

function normalizeTranslationText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function hashText(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getTranslationCacheId(videoId, text) {
  const normalized = normalizeTranslationText(text);
  return `${String(videoId || "unknown")}:${normalized.length}:${hashText(normalized)}`;
}

async function loadTranslationCache() {
  const stored = await chrome.storage.local.get(TRANSLATION_CACHE_KEY);
  const cache = stored?.[TRANSLATION_CACHE_KEY];
  if (!cache || cache.version !== TRANSLATION_CACHE_VERSION) {
    return { version: TRANSLATION_CACHE_VERSION, entries: {} };
  }

  const now = Date.now();
  const entries = Object.fromEntries(
    Object.entries(cache.entries || {}).filter(
      ([, item]) =>
        item &&
        typeof item.translatedText === "string" &&
        now - Number(item.createdAt || 0) < TRANSLATION_CACHE_TTL_MS,
    ),
  );
  return { version: TRANSLATION_CACHE_VERSION, entries };
}

async function saveTranslationCache(cache) {
  const entries = Object.entries(cache.entries || {})
    .sort(
      ([, left], [, right]) =>
        Number(right.createdAt || 0) - Number(left.createdAt || 0),
    )
    .slice(0, 1500);
  await chrome.storage.local.set({
    [TRANSLATION_CACHE_KEY]: {
      version: TRANSLATION_CACHE_VERSION,
      entries: Object.fromEntries(entries),
    },
  });
}

function parseDeepSeekJson(content) {
  const normalized = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const parsed = JSON.parse(normalized);
  const translations = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.translations)
      ? parsed.translations
      : [];
  return translations;
}

async function requestDeepSeekTranslations(segments, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(DEEPSEEK_TRANSLATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content:
              'You translate English video subtitles into natural Simplified Chinese. Use the context of the full batch, preserve names and technical terms, and return only a JSON object shaped as {"translations":[{"id":0,"translatedText":"中文"}]}. Return exactly one item for every input id, in input order.',
          },
          {
            role: "user",
            content: JSON.stringify(
              segments.map((segment) => ({
                id: segment.id,
                text: segment.text,
              })),
            ),
          },
        ],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2500,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      let message = "DeepSeek 请求失败";
      try {
        message = JSON.parse(body)?.error?.message || message;
      } catch {
        // DeepSeek 偶尔返回非 JSON 错误页，保留通用提示。
      }
      throw new Error(`${message}（HTTP ${response.status}）`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 没有返回翻译内容");

    const expectedIds = new Set(segments.map((segment) => String(segment.id)));
    return parseDeepSeekJson(content)
      .filter(
        (item) =>
          expectedIds.has(String(item?.id)) &&
          typeof item?.translatedText === "string" &&
          item.translatedText.trim(),
      )
      .map((item) => ({
        id: item.id,
        translatedText: item.translatedText.trim(),
      }));
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("DeepSeek 翻译超时，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateTranslationSegments(rawSegments) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error("没有需要翻译的字幕");
  }
  if (rawSegments.length > 10) throw new Error("单次最多翻译 10 句字幕");

  const segments = rawSegments.map((segment) => ({
    id: segment?.id,
    text: normalizeTranslationText(segment?.text),
  }));
  if (
    segments.some(
      (segment) =>
        !["string", "number"].includes(typeof segment.id) ||
        !segment.text ||
        segment.text.length > 600,
    )
  ) {
    throw new Error("字幕数据格式不正确");
  }
  return segments;
}

async function translateSegments(message) {
  const settings = await loadSettings();
  if (!settings.translationEnabled) {
    return { translations: [], disabled: true };
  }
  if (!settings.deepseekApiKey) {
    return { translations: [], apiKeyRequired: true };
  }

  const segments = validateTranslationSegments(message?.segments);
  const videoId = String(message?.videoId || "unknown").slice(0, 128);
  const cache = await loadTranslationCache();
  const translations = [];
  const missing = [];

  for (const segment of segments) {
    const cacheId = getTranslationCacheId(videoId, segment.text);
    const cached = cache.entries[cacheId];
    if (cached) {
      translations.push({
        id: segment.id,
        translatedText: cached.translatedText,
      });
    } else {
      missing.push({ ...segment, cacheId });
    }
  }

  if (missing.length > 0) {
    const fresh = await requestDeepSeekTranslations(missing, settings.deepseekApiKey);
    const now = Date.now();
    for (const item of fresh) {
      const source = missing.find(
        (segment) => String(segment.id) === String(item.id),
      );
      if (!source) continue;
      translations.push(item);
      cache.entries[source.cacheId] = {
        translatedText: item.translatedText,
        createdAt: now,
      };
    }
    await saveTranslationCache(cache);
  }

  return { translations };
}

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
    files: ["styles.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
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

async function lookupDictionaryWord(rawWord) {
  const word = String(rawWord || "")
    .trim()
    .toLocaleLowerCase();
  if (!/^[a-z]+(?:'[a-z]+)?$/i.test(word)) {
    throw new Error("这个内容不是可查询的英文单词");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({
      method: "tools.translate",
      query: word,
      ft: "en2zh",
    });
    const response = await fetch(`https://quark.sm.cn/api/rest?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`夸克查词暂时不可用（${response.status}）`);

    const payload = await response.json();
    const entry = payload?.data;
    if (payload?.error !== 0 || !entry?.entity) {
      throw new Error("夸克词典中没有找到这个单词");
    }

    const phonetics = (entry.entity.orig_auto || [])
      .slice(0, 2)
      .map((item, index) => ({
        label: index === 0 ? "英" : "美",
        text: stripQuarkMarkup(item?.orig_text).replace(/^(?:英音|美音)\s*/u, ""),
        audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${index + 1}`,
      }))
      .filter((item) => item.text);
    const meanings = (entry.entity.explains?.explain_list || [])
      .map((meaning) => ({
        partOfSpeech: stripQuarkMarkup(meaning?.label) || "释义",
        definition: stripQuarkMarkup(meaning?.value),
      }))
      .filter((meaning) => meaning.definition)
      .slice(0, 5);
    if (meanings.length === 0) throw new Error("词典没有返回有效释义");

    const examples = (entry.basics?.sentence || [])
      .flatMap((group) => group?.sentences || [])
      .map((example) => ({
        en: stripQuarkMarkup(example?.en).replace(/^\d+\s*[·.]\s*/u, ""),
        zh: stripQuarkMarkup(example?.cn),
      }))
      .filter((example) => example.en || example.zh)
      .slice(0, 2);

    return {
      word: entry.entity.title || word,
      translation: stripQuarkMarkup(entry.head?.word),
      phonetic: phonetics
        .map((item) => `${item.label} ${item.text}`.trim())
        .join("  ·  "),
      phonetics,
      meanings,
      examples,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("查词超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function stripQuarkMarkup(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ELT_GET_SETTINGS") {
    loadSettings()
      .then((settings) => sendResponse({ settings: getPublicSettings(settings) }))
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_GET_PRIVATE_SETTINGS") {
    if (!isTrustedExtensionPage(sender)) {
      sendResponse({ error: "无权读取私密设置" });
      return false;
    }
    loadSettings()
      .then((settings) =>
        sendResponse({
          settings: {
            ...getPublicSettings(settings),
            deepseekApiKey: settings.deepseekApiKey,
          },
        }),
      )
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_SAVE_SETTINGS") {
    if (!isTrustedExtensionPage(sender)) {
      sendResponse({ error: "无权修改设置" });
      return false;
    }
    saveSettings(message.settings)
      .then((settings) => sendResponse({ settings: getPublicSettings(settings) }))
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_OPEN_SETTINGS") {
    chrome.runtime
      .openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_TEST_DEEPSEEK") {
    if (!isTrustedExtensionPage(sender)) {
      sendResponse({ error: "无权测试 API Key" });
      return false;
    }
    const apiKey = String(message.apiKey || "").trim();
    if (!apiKey) {
      sendResponse({ error: "请先输入 DeepSeek API Key" });
      return false;
    }
    requestDeepSeekTranslations(
      [{ id: "test", text: "Practice makes progress." }],
      apiKey,
    )
      .then((translations) =>
        sendResponse({
          ok: translations.length === 1,
          translation: translations[0]?.translatedText || "",
          model: DEEPSEEK_MODEL,
        }),
      )
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_TRANSLATE_SEGMENTS") {
    const senderUrl = String(sender?.url || sender?.tab?.url || "");
    if (!senderUrl.startsWith("https://www.youtube.com/")) {
      sendResponse({ error: "只允许在 YouTube 训练页面请求翻译" });
      return false;
    }
    translateSegments(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_LOOKUP_WORD") {
    lookupDictionaryWord(message.word)
      .then((entry) => sendResponse({ entry }))
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === "ELT_FETCH_TRANSCRIPT") {
    if (!sender.tab?.id) {
      sendResponse({ error: "没有找到当前标签页" });
      return false;
    }

    fetchTranscriptInPage(sender.tab.id, message.options)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://www.youtube.com/")) {
    return;
  }

  try {
    const playerData = await readPlayerData(tab.id);
    await sendToggleMessage(tab.id, playerData);
  } catch (error) {
    console.error("[English Listening Typing] 无法启动训练：", error);
  }
});
