const SETTINGS_KEY = "elt_settings_v1";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
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


export {
  DEEPSEEK_MODEL,
  getPublicSettings,
  isTrustedExtensionPage,
  loadSettings,
  saveSettings,
};
