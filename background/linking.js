import { lookupDictionaryWord } from "./dictionary.js";
import { tokenize, parsePronunciations, resolvePronunciations, findLinkingCandidates } from "./linking-rules.js";

const CACHE_KEY = "elt_linking_ipa_v1";
const TTL = 7 * 24 * 60 * 60 * 1000;
const cache = new Map(), pending = new Map();
let loading, writing = Promise.resolve(), active = 0;
const queue = [];

async function loadCache() {
  loading ||= chrome.storage.local.get(CACHE_KEY).then(data => {
    for (const item of (Array.isArray(data[CACHE_KEY]) ? data[CACHE_KEY] : []).slice(-2000)) {
      if (typeof item?.word === "string" && Number.isFinite(item.at) && Date.now() - item.at < TTL &&
          Array.isArray(item.ipa) && item.ipa.every(s => typeof s === "string")) cache.set(item.word, item);
    }
  }).catch(() => {});
  await loading;
}

function limited(task) {
  return new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); drain(); });
}
function drain() {
  while (active < 3 && queue.length) {
    const { task, resolve, reject } = queue.shift();
    active++;
    Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; drain(); });
  }
}

async function lookup(word) {
  await loadCache();
  const cached = cache.get(word);
  if (cached && Date.now() - cached.at < TTL) return cached.ipa;
  if (!pending.has(word)) {
    const task = limited(async () => {
      const entry = await lookupDictionaryWord(word, { phoneticsOnly: true });
      const ipa = parsePronunciations(entry, word);
      cache.delete(word);
      cache.set(word, { word, ipa, at: Date.now() });
      while (cache.size > 2000) cache.delete(cache.keys().next().value);
      return ipa;
    });
    pending.set(word, task);
    task.finally(() => pending.delete(word)).catch(() => {});
  }
  return pending.get(word);
}

export async function getLinkingHints(message) {
  const text = message.targetSentence;
  if (typeof text !== "string" || !text.trim() || text.length > 2000 || tokenize(text).length > 150) {
    throw new Error("连读句子格式不正确");
  }
  await loadCache();
  const words = [...new Set(tokenize(text).map(t => t.word))];
  const pronunciations = new Map();
  let incomplete = false;
  await Promise.all(words.map(async word => {
    try { pronunciations.set(word, await resolvePronunciations(word, lookup)); }
    catch { incomplete = true; } // One unavailable word cannot hide other hints.
  }));
  writing = writing.catch(() => {}).then(() => chrome.storage.local.set({ [CACHE_KEY]: [...cache.values()] }));
  await writing.catch(() => {});
  return { links: findLinkingCandidates(text, pronunciations), incomplete };
}
