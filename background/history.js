const RECORD_PREFIX = "elt_history_v1_";
const CAPTION_PREFIX = "elt_history_captions_v1_";
const writes = new Map();

function serialize(videoId, task) {
  const next = (writes.get(videoId) || Promise.resolve()).catch(() => {}).then(task);
  writes.set(videoId, next);
  return next.finally(() => { if (writes.get(videoId) === next) writes.delete(videoId); });
}

export async function readHistory(videoId) {
  await writes.get(videoId)?.catch(() => {});
  const keys = [RECORD_PREFIX + videoId, CAPTION_PREFIX + videoId];
  const stored = await chrome.storage.local.get(keys);
  const record = stored[keys[0]];
  const prepared = stored[keys[1]];
  return record && prepared?.segments?.length ? { ...record, prepared } : null;
}

export async function listHistory() {
  const keys = typeof chrome.storage.local.getKeys === "function"
    ? (await chrome.storage.local.getKeys()).filter(key => key.startsWith(RECORD_PREFIX)) : null;
  const stored = await chrome.storage.local.get(keys);
  return Object.entries(stored).filter(([key]) => key.startsWith(RECORD_PREFIX))
    .map(([, record]) => record).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function cacheHistory(session, prepared) {
  return serialize(session.videoId, async () => {
    const key = RECORD_PREFIX + session.videoId;
    const existing = (await chrome.storage.local.get(key))[key];
    // Keep the exact practice segmentation with its progress across extension updates.
    if (existing) return;
    await chrome.storage.local.set({
      [CAPTION_PREFIX + session.videoId]: prepared,
      [key]: { videoId: session.videoId, title: session.title, sourceUrl: session.sourceUrl,
        total: prepared.segments.length, updatedAt: Date.now(), progress: null },
    });
  });
}

export function saveProgress(session, input) {
  return serialize(session.videoId, async () => {
    const key = RECORD_PREFIX + session.videoId;
    const record = (await chrome.storage.local.get(key))[key];
    if (!record) throw new Error("学习记录尚未准备好，请刷新学习页重试");
    if (!Number.isInteger(input?.index) || input.index < 0 || input.index >= record.total ||
        !Array.isArray(input.completedIndices) || input.completedIndices.length > record.total ||
        typeof input.typedText !== "string" || input.typedText.length > 50000) {
      throw new Error("学习进度无效");
    }
    const completedIndices = [...new Set(input.completedIndices)]
      .filter(index => Number.isInteger(index) && index >= 0 && index < record.total);
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const progress = { index: input.index, typedText: input.typedText, completedIndices,
      sentenceMistakes: count(input.sentenceMistakes), totalMistakes: count(input.totalMistakes),
      phase: input.phase === "complete" ? "complete" : completedIndices.includes(input.index) ? "reviewing" : "listening",
      playbackRate: [0.75, 1, 1.25, 1.5].includes(input.playbackRate) ? input.playbackRate : 1,
      soundEnabled: input.soundEnabled !== false };
    await chrome.storage.local.set({ [key]: { ...record, progress, updatedAt: Date.now() } });
    return { ok: true };
  });
}
