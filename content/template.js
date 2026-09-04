(() => {
  const namespace = (globalThis.EnglishListeningTyping ||= {});
  namespace.overlayMarkup = `
      <header class="elt-header">
        <div class="elt-brand">
          <div>
            <strong>专注模式</strong>
            <span id="elt-track-label">YouTube 原声字幕</span>
          </div>
        </div>
        <div class="elt-header-center" id="elt-video-title">听写打字训练</div>
        <button id="elt-close" class="elt-exit-button" type="button">
          退出
        </button>
      </header>

      <main class="elt-workbench">
        <div class="elt-content">
          <section class="elt-video-stage">
            <div id="elt-video-shell" class="elt-video-shell"></div>

            <div id="elt-loading" class="elt-center-state">
              <div class="elt-spinner"></div>
              <h2>正在准备训练</h2>
              <p id="elt-loading-message">正在读取视频信息……</p>
            </div>

            <div id="elt-error" class="elt-center-state elt-hidden">
              <div class="elt-state-mark">!</div>
              <h2>暂时无法开始</h2>
              <p id="elt-error-message"></p>
              <button id="elt-error-close" class="elt-button elt-button-secondary" type="button">返回视频</button>
            </div>

            <div id="elt-complete" class="elt-center-state elt-hidden">
              <div class="elt-complete-mark">完成</div>
              <h2>本次训练完成</h2>
              <p id="elt-complete-summary"></p>
              <button id="elt-restart" class="elt-button elt-button-primary" type="button">从头再练一次</button>
            </div>

            <div id="elt-practice" class="elt-practice elt-hidden" tabindex="-1">
              <input
                id="elt-keyboard-capture"
                class="elt-keyboard-capture"
                type="text"
                tabindex="-1"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                aria-hidden="true"
              />
              <div class="elt-dictation-card" aria-live="polite">
                <div class="elt-phase-row">
                  <span id="elt-phase-title" class="elt-phase-title"></span>
                  <span id="elt-typing-feedback" class="elt-typing-feedback elt-hidden"></span>
                  <span id="elt-counter" class="elt-counter"></span>
                </div>
                <p id="elt-phase-detail" class="elt-phase-detail"></p>
                <div id="elt-character-slots" class="elt-character-slots" aria-label="听写输入区域"></div>
                <div id="elt-translation" class="elt-translation elt-hidden" aria-live="polite"></div>
                <p id="elt-play-error" class="elt-play-error"></p>
                <div class="elt-dictation-meta">
                  <span id="elt-character-count"></span>
                  <span id="elt-mistake-count"></span>
                  <button id="elt-show-answer" class="elt-hold-answer" type="button">Tab 查看答案并查词</button>
                </div>
              </div>
            </div>

            <aside id="elt-dictionary" class="elt-dictionary elt-hidden" aria-live="polite"></aside>
          </section>

          <div id="elt-divider" class="elt-divider" role="separator" aria-label="调整字幕列表宽度"></div>

          <aside id="elt-panel" class="elt-panel">
            <div class="elt-panel-header">
              <div>
                <h2>字幕列表</h2>
                <p id="elt-panel-summary">训练进度</p>
              </div>
              <span id="elt-panel-count" class="elt-panel-count"></span>
            </div>
            <div id="elt-subtitle-list" class="elt-subtitle-list"></div>
            <div class="elt-panel-footer">已完成字幕会自动显示，当前句与后续句保持隐藏</div>
          </aside>
        </div>

        <footer class="elt-controls">
          <div class="elt-control-group">
            <button id="elt-previous" class="elt-control-button" type="button">上一句</button>
            <button id="elt-replay" class="elt-control-button elt-control-main" type="button">重播本句</button>
            <button id="elt-skip" class="elt-control-button" type="button">下一句</button>
          </div>
          <div class="elt-timeline">
            <div class="elt-progress-track"><div id="elt-progress-bar" class="elt-progress-bar"></div></div>
            <div class="elt-timeline-copy">
              <span id="elt-segment-time">00:00</span>
              <span id="elt-shortcut-hint">直接打字 · Ctrl J 重播 · Esc 退出</span>
            </div>
          </div>
          <div class="elt-control-group elt-control-group-right">
            <button id="elt-settings" class="elt-control-button elt-settings-button" type="button" title="训练设置" aria-label="打开训练设置">设置</button>
            <button id="elt-sound" class="elt-control-button elt-sound-toggle" type="button" aria-pressed="true">音效 开</button>
            <button id="elt-speed" class="elt-control-button" type="button">1×</button>
            <span id="elt-total-mistakes" class="elt-total-mistakes">错误 0</span>
          </div>
        </footer>
      </main>
    `;
})();
