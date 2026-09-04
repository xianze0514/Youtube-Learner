import { DEEPSEEK_MODEL, loadSettings } from "./settings.js";

const TRANSLATION_CACHE_KEY = "elt_translation_cache_v1";
const TRANSLATION_CACHE_VERSION = 1;
const TRANSLATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEEPSEEK_TRANSLATE_URL = "https://api.deepseek.com/chat/completions";

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


export { requestDeepSeekTranslations, translateSegments };
