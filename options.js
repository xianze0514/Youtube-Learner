const form = document.querySelector("#settings-form");
const translationEnabled = document.querySelector("#translation-enabled");
const apiKey = document.querySelector("#deepseek-api-key");
const toggleKey = document.querySelector("#toggle-key");
const testKey = document.querySelector("#test-key");
const saveButton = document.querySelector("#save");
const status = document.querySelector("#status");

function setStatus(message, type = "") {
  status.textContent = message;
  status.dataset.type = type;
}

function getCompletionMode() {
  return (
    document.querySelector('input[name="completion-mode"]:checked')?.value ||
    "manual"
  );
}

async function loadSettings() {
  setStatus("正在读取设置…");
  const response = await chrome.runtime.sendMessage({
    type: "ELT_GET_PRIVATE_SETTINGS",
  });
  if (response?.error) throw new Error(response.error);

  const settings = response?.settings || {};
  translationEnabled.checked = settings.translationEnabled !== false;
  apiKey.value = settings.deepseekApiKey || "";
  const mode = settings.completionMode === "auto" ? "auto" : "manual";
  document.querySelector(
    `input[name="completion-mode"][value="${mode}"]`,
  ).checked = true;
  setStatus(settings.apiKeyConfigured ? "DeepSeek 密钥已配置" : "尚未配置 DeepSeek 密钥");
}

toggleKey.addEventListener("click", () => {
  const shouldShow = apiKey.type === "password";
  apiKey.type = shouldShow ? "text" : "password";
  toggleKey.textContent = shouldShow ? "隐藏" : "显示";
});

testKey.addEventListener("click", async () => {
  if (!apiKey.value.trim()) {
    setStatus("请先输入 DeepSeek API Key", "error");
    apiKey.focus();
    return;
  }

  testKey.disabled = true;
  setStatus("正在使用 deepseek-v4-flash 测试连接…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ELT_TEST_DEEPSEEK",
      apiKey: apiKey.value.trim(),
    });
    if (response?.error) throw new Error(response.error);
    setStatus(`连接成功：${response.translation}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    testKey.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setStatus("正在保存…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ELT_SAVE_SETTINGS",
      settings: {
        translationEnabled: translationEnabled.checked,
        completionMode: getCompletionMode(),
        deepseekApiKey: apiKey.value.trim(),
      },
    });
    if (response?.error) throw new Error(response.error);
    setStatus("设置已保存，并已应用到训练页面", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    saveButton.disabled = false;
  }
});

if (
  location.protocol === "chrome-extension:" &&
  globalThis.chrome?.runtime?.sendMessage
) {
  void loadSettings().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  });
} else {
  setStatus("请通过 Chrome 扩展的设置入口打开此页面");
}
