import { readPlayerData, fetchTranscriptInPage } from "./youtube.js";
import { isTrustedExtensionPage } from "./settings.js";
import { readHistory, listHistory, cacheHistory, saveProgress } from "./history.js";

const PREFIX = "elt_learning_";
const launches = new Map();
const videoIdFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("v");
    return parsed.origin === "https://www.youtube.com" && parsed.pathname === "/watch" && /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
};

async function focusExisting(videoId) {
  const stored = await chrome.storage.session.get(null);
  for (const [key, session] of Object.entries(stored)) {
    if (!key.startsWith(PREFIX) || session.videoId !== videoId) continue;
    const tab = await chrome.tabs.get(session.learningTabId).catch(() => null);
    if (!tab) continue;
    const expectedUrl = chrome.runtime.getURL(`learning.html?session=${session.sessionId}&video=${videoId}`);
    // tabs.get may omit extension-page URLs without the broad "tabs" permission.
    // Verify our own live page through runtime contexts instead of requesting it.
    const matches = typeof chrome.runtime.getContexts === "function"
      ? (await chrome.runtime.getContexts({ contextTypes: ["TAB"], tabIds: [tab.id], documentUrls: [expectedUrl] })).length > 0
      : tab.url === expectedUrl;
    if (matches) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    }
  }
  return false;
}

function oncePerVideo(videoId, task) {
  if (launches.has(videoId)) return launches.get(videoId);
  const promise = task().finally(() => launches.delete(videoId));
  launches.set(videoId, promise);
  return promise;
}

export function openLearningTab(tab) {
  const videoId = videoIdFromUrl(tab?.url);
  if (!tab?.id || !videoId) return Promise.reject(new Error("请先打开一个 YouTube 视频页面"));
  return oncePerVideo(videoId, async () => {
    if (await focusExisting(videoId)) { await pauseSource(tab.id, videoId); return { ok: true }; }
    const saved = await readHistory(videoId);
    const playerData = saved ? null : await readPlayerData(tab.id);
    if (!saved && (!playerData || playerData.videoId !== videoId)) throw new Error("视频正在切换，请稍后重试");
    const session = makeSession(videoId, saved);
    Object.assign(session, { sourceTabId: tab.id, playerData,
      title: saved?.title || playerData?.title || tab.title || "听写训练",
      startTime: saved ? session.startTime : playerData.currentTime || 0 });
    await launch(session);
    await pauseSource(tab.id, videoId);
    return { ok: true };
  });
}

function makeSession(videoId, saved) {
  return { sessionId: crypto.randomUUID(), sourceTabId: null,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`, videoId,
    title: saved?.title || "听写训练", prepared: saved?.prepared, progress: saved?.progress,
    startTime: (saved?.prepared?.segments[saved.progress?.index || 0]?.startMs || 0) / 1000 };
}

async function pauseSource(tabId, videoId) {
  await chrome.scripting.executeScript({ target: { tabId }, args: [videoId], func: (expectedId) => {
    if (new URL(location.href).searchParams.get("v") === expectedId) document.querySelector("video")?.pause();
  } }).catch(() => {});
}

async function installPlayerRule(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [{ id: tabId, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "Referer", operation: "set",
        value: `https://english-listening-typing.${chrome.runtime.id}/` }] },
      condition: { tabIds: [tabId], urlFilter: "|https://www.youtube.com/embed/", resourceTypes: ["sub_frame"] } }],
  });
}

async function launch(session) {
  // Create the tab before adding its narrowly scoped player identity rule.
  const learningTab = await chrome.tabs.create({ url: "about:blank", active: false });
  session.learningTabId = learningTab.id;
  try {
    await chrome.storage.session.set({ [PREFIX + session.sessionId]: session });
    await installPlayerRule(learningTab.id);
    await chrome.tabs.update(learningTab.id, { url: chrome.runtime.getURL(`learning.html?session=${session.sessionId}&video=${session.videoId}`), active: true });
    return { ok: true };
  } catch (error) {
    await chrome.tabs.remove(learningTab.id).catch(() => {});
    await chrome.storage.session.remove(PREFIX + session.sessionId);
    throw error;
  }
}

async function getSession(sender) {
  if (!isTrustedExtensionPage(sender)) throw new Error("无权访问学习会话");
  const url = new URL(sender.url);
  if (url.pathname !== "/learning.html") throw new Error("无效的学习页面");
  const id = url.searchParams.get("session");
  let session = (await chrome.storage.session.get(PREFIX + id))[PREFIX + id];
  // Browser restarts clear session storage; recover restored learning tabs from local history.
  if (!session && id && sender.tab?.id) {
    const videoId = url.searchParams.get("video");
    const saved = /^[\w-]{11}$/.test(videoId || "") ? await readHistory(videoId) : null;
    if (saved) {
      session = { ...makeSession(videoId, saved), sessionId: id, learningTabId: sender.tab.id };
      await installPlayerRule(sender.tab.id);
      await chrome.storage.session.set({ [PREFIX + id]: session });
    }
  }
  if (!session || session.learningTabId !== sender.tab?.id) throw new Error("学习会话已失效，请从 YouTube 视频重新打开");
  return session;
}

export async function handleLearningMessage(message, sender) {
  if (message.type === "ELT_OPEN_LEARNING") {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0) throw new Error("无效的学习入口");
    const tab = await chrome.tabs.get(sender.tab.id);
    return openLearningTab(tab);
  }
  if (["ELT_LIST_HISTORY", "ELT_RESUME_LEARNING", "ELT_OPEN_CURRENT"].includes(message.type)) {
    if (!isTrustedExtensionPage(sender)) throw new Error("无权访问学习记录");
    if (message.type === "ELT_LIST_HISTORY") return { records: await listHistory() };
    if (message.type === "ELT_OPEN_CURRENT") return openLearningTab(await chrome.tabs.get(message.tabId));
    const videoId = message.videoId;
    if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("无效的视频记录");
    return oncePerVideo(videoId, async () => {
      if (await focusExisting(videoId)) return { ok: true };
      const saved = await readHistory(videoId);
      if (!saved) throw new Error("未找到学习记录，请从 YouTube 视频重新开始");
      return launch(makeSession(videoId, saved));
    });
  }
  const session = await getSession(sender);
  if (message.type === "ELT_SAVE_PROGRESS") return saveProgress(session, message.progress);
  if (message.type === "ELT_GET_LEARNING") {
    const saved = await readHistory(session.videoId);
    return { session: saved ? { ...session, prepared: saved.prepared, progress: saved.progress,
      startTime: (saved.prepared.segments[saved.progress?.index || 0]?.startMs || 0) / 1000 } : session };
  }
  if (message.type === "ELT_LEARNING_TRANSCRIPT") {
    const source = (session.sourceTabId ? await chrome.tabs.get(session.sourceTabId).catch(() => null) : null);
    if (videoIdFromUrl(source?.url) !== session.videoId) throw new Error("请保持原 YouTube 视频页打开，等待字幕读取完成");
    return fetchTranscriptInPage(session.sourceTabId, { ...message.options, videoId: session.videoId });
  }
  if (message.type === "ELT_CACHE_LEARNING") {
    const prepared = message.prepared;
    if (!Array.isArray(prepared?.segments) || !prepared.segments.length || prepared.segments.length > 20000 || JSON.stringify(prepared).length > 3000000) throw new Error("字幕数据无效或过大");
    await cacheHistory(session, prepared);
    await chrome.storage.session.set({ [PREFIX + session.sessionId]: { ...session, prepared } });
    return { ok: true };
  }
  if (message.type === "ELT_RETURN_SOURCE") {
    const source = (session.sourceTabId ? await chrome.tabs.get(session.sourceTabId).catch(() => null) : null);
    if (videoIdFromUrl(source?.url) === session.videoId) {
      await chrome.tabs.update(source.id, { active: true });
      await chrome.windows.update(source.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: session.sourceUrl, active: true });
    }
    return { ok: true };
  }
  throw new Error("未知学习操作");
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter(key => key.startsWith(PREFIX) && stored[key]?.learningTabId === tabId);
  if (keys.length) await chrome.storage.session.remove(keys);
});
