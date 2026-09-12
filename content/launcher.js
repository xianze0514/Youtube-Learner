(() => {
  if (globalThis.__eltLauncherLoaded) return;
  globalThis.__eltLauncherLoaded = true;
  const id = "elt-launch-learning";
  let pending = false;
  let scheduled = false;

  function install() {
    scheduled = false;
    const isWatch = location.pathname === "/watch" && /^[\w-]{11}$/.test(new URL(location.href).searchParams.get("v") || "");
    const controls = document.querySelector("#movie_player .ytp-right-controls");
    const existing = document.getElementById(id);
    if (!isWatch || !controls) {
      existing?.remove();
      return;
    }
    if (existing?.parentElement === controls) return;
    existing?.remove();
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "ytp-button elt-launch-button";
    button.title = "开始听写 · 在新标签页打开";
    button.setAttribute("aria-label", button.title);
    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("assets/headphones.svg");
    icon.alt = "";
    button.appendChild(icon);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (pending) return;
      pending = true;
      button.disabled = true;
      button.title = "正在打开学习页……";
      try {
        const response = await chrome.runtime.sendMessage({ type: "ELT_OPEN_LEARNING" });
        if (response?.error) throw new Error(response.error);
        button.title = "开始听写 · 在新标签页打开";
      } catch (error) {
        button.title = `打开失败，请刷新视频页后重试：${error.message}`;
      } finally {
        button.setAttribute("aria-label", button.title);
        button.disabled = false;
        pending = false;
      }
    });
    controls.insertBefore(button, controls.querySelector(".ytp-subtitles-button, .ytp-settings-button") || controls.firstChild);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(install);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-finish", schedule);
  install();
})();
