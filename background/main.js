import { lookupDictionaryWord } from "./dictionary.js";
import {
  DEEPSEEK_MODEL,
  getPublicSettings,
  isTrustedExtensionPage,
  loadSettings,
  saveSettings,
} from "./settings.js";
import { requestDeepSeekTranslations, translateSegments } from "./translation.js";
import { fetchTranscriptInPage, readPlayerData, sendToggleMessage } from "./youtube.js";

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
