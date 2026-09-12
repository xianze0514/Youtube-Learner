import { readPlayerData, fetchTranscriptInPage } from "./youtube.js";
import { isTrustedExtensionPage } from "./settings.js";

const PREFIX = "elt_learning_";
const launches = new Map();
const videoIdFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("v");
    return parsed.origin === "https://www.youtube.com" && parsed.pathname === "/watch" && /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
};

export function openLearningTab(tab) {
  if (!tab?.id || !videoIdFromUrl(tab.url)) return Promise.reject(new Error("请先打开一个 YouTube 视频页面"));
  if (launches.has(tab.id)) return launches.get(tab.id);
  const promise = launch(tab).finally(() => launches.delete(tab.id));
  launches.set(tab.id, promise);
  return promise;
}

async function launch(tab) {
  const playerData = await readPlayerData(tab.id);
  const videoId = videoIdFromUrl(tab.url);
  if (!playerData || playerData.videoId !== videoId) throw new Error("视频正在切换，请稍后重试");
  const sessionId = crypto.randomUUID();
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const session = { sessionId, sourceTabId: tab.id, sourceUrl, videoId, playerData,
    title: playerData.title || tab.title || "听写训练", startTime: playerData.currentTime || 0 };
  // Create the tab before adding its narrowly scoped player identity rule.
  const learningTab = await chrome.tabs.create({ url: "about:blank", active: false });
  session.learningTabId = learningTab.id;
  try {
    await chrome.storage.session.set({ [PREFIX + sessionId]: session });
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [learningTab.id],
      addRules: [{ id: learningTab.id, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "Referer", operation: "set",
          value: `https://english-listening-typing.${chrome.runtime.id}/` }] },
        condition: { tabIds: [learningTab.id], urlFilter: "|https://www.youtube.com/embed/", resourceTypes: ["sub_frame"] } }],
    });
    await chrome.tabs.update(learningTab.id, { url: chrome.runtime.getURL(`learning.html?session=${sessionId}`), active: true });
    // Stop the source only after the destination has successfully opened.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [videoId], func: (expectedId) => {
      if (new URL(location.href).searchParams.get("v") === expectedId) document.querySelector("video")?.pause();
    } }).catch(() => {});
    return { ok: true };
  } catch (error) {
    await chrome.tabs.remove(learningTab.id).catch(() => {});
    await chrome.storage.session.remove(PREFIX + sessionId);
    throw error;
  }
}

async function getSession(sender) {
  if (!isTrustedExtensionPage(sender)) throw new Error("无权访问学习会话");
  const url = new URL(sender.url);
  if (url.pathname !== "/learning.html") throw new Error("无效的学习页面");
  const id = url.searchParams.get("session");
  const session = (await chrome.storage.session.get(PREFIX + id))[PREFIX + id];
  if (!session || session.learningTabId !== sender.tab?.id) throw new Error("学习会话已失效，请从 YouTube 视频重新打开");
  return session;
}

export async function handleLearningMessage(message, sender) {
  if (message.type === "ELT_OPEN_LEARNING") {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0) throw new Error("无效的学习入口");
    const tab = await chrome.tabs.get(sender.tab.id);
    return openLearningTab(tab);
  }
  const session = await getSession(sender);
  if (message.type === "ELT_GET_LEARNING") return { session };
  if (message.type === "ELT_LEARNING_TRANSCRIPT") {
    const source = await chrome.tabs.get(session.sourceTabId).catch(() => null);
    if (videoIdFromUrl(source?.url) !== session.videoId) throw new Error("请保持原 YouTube 视频页打开，等待字幕读取完成");
    return fetchTranscriptInPage(session.sourceTabId, { ...message.options, videoId: session.videoId });
  }
  if (message.type === "ELT_CACHE_LEARNING") {
    const prepared = message.prepared;
    if (!Array.isArray(prepared?.segments) || prepared.segments.length > 20000 || JSON.stringify(prepared).length > 3000000) throw new Error("字幕数据无效或过大");
    await chrome.storage.session.set({ [PREFIX + session.sessionId]: { ...session, prepared } });
    return { ok: true };
  }
  if (message.type === "ELT_RETURN_SOURCE") {
    const source = await chrome.tabs.get(session.sourceTabId).catch(() => null);
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
