# Design QA

## Comparison target

- Source visual truth: `/tmp/qwerty-learner-review.baPMEP/docs/dictation.png` for the character-slot dictation interaction.
- Source product structure: `/Users/mengxianze/Documents/LangFlow/apps/extension/src/features/video-overlay/components/FocusMode.tsx` and `CustomVideoPlayer.tsx` for the focused-mode layout, subtitle placement, right transcript panel, and bottom controls.
- Rendered implementation: `/Users/mengxianze/Documents/ChatGPT/学英语/implementation-preview.png`.
- Combined comparison: `/Users/mengxianze/Documents/ChatGPT/学英语/design-comparison.png`.
- Interaction-state capture: `/Users/mengxianze/Documents/ChatGPT/学英语/implementation-success.png`.

## Normalization

- Implementation viewport: 1280 × 720 CSS pixels.
- Browser device pixel ratio: 2; the captured file is normalized to 1280 × 720 output pixels.
- Qwerty source: 1414 × 770 pixels, proportionally resized to 1322 × 720 for the combined comparison.
- Combined comparison: 2602 × 720 pixels.
- Compared state: dark focused mode, first subtitle paused for typing, all target letters hidden as slots.

## Full-view comparison evidence

- The implementation preserves the three major LangFlow focused-mode regions: large video stage, 28% right transcript panel, and full-width bottom control bar.
- The dictation surface occupies the original current-subtitle position over the lower part of the video rather than becoming a separate answer panel.
- Qwerty's central monospaced underscore pattern is preserved, expanded into word groups that wrap safely for sentence-length content.
- The right transcript masks the current and future answers while retaining timestamps and navigation.
- The 1280 × 720 capture has no horizontal or vertical overflow. The training card remains fully inside the video stage and above the persistent controls.

## Focused-region comparison evidence

- Character slots: untyped characters use monospaced underscores; correct characters reveal in green; punctuation is present but visually subdued; spaces are separate required slots.
- Training feedback: the active sentence has a short status line, character count, mistake count, and hold-to-reveal answer control without introducing a textarea.
- Completed state: the full correct sentence is revealed over the video and simultaneously revealed in the active transcript row.

## Required fidelity surfaces

- Fonts and typography: passed. UI uses the system sans stack used by the focused interface; dictation uses a monospaced stack with responsive sizing and word-safe wrapping.
- Spacing and layout rhythm: passed. Header is 64px, controls are 72px, transcript defaults to 28%, and the subtitle card follows the lower-video placement of the source focused mode.
- Colors and visual tokens: passed. Black focused canvas, near-black transcript panel, white active transcript card, violet playback progress, green correct state, and red error state are consistent and legible.
- Image quality and asset fidelity: passed. The extension reuses the active YouTube video itself; no substitute illustrations, placeholder icons, or generated assets are used.
- Copy and content: passed. Labels describe the actual interaction, answer masking, shortcuts, progress, and error behavior.

## Interaction verification

- Wrong key: confirmed that the current word turns red and shakes, mistake counters increase, the current word clears after 320ms, and previously completed words remain intact.
- Correct input: confirmed case-insensitive character acceptance, required spaces, and automatic punctuation skipping.
- Backspace: confirmed removal of the last accepted character.
- Completion: confirmed 49/49 accepted characters, full sentence reveal, replay state, completed-history reveal, and transition to sentence 2.
- Controls: confirmed playback speed cycling from 1× to 1.25×.
- Space-key regression: confirmed that a required word space advances the character slots while the video remains paused and the simulated YouTube shortcut listener receives no event.
- Console: no warnings or errors in the final preview run.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the selected hybrid target.
- Acceptable intentional difference: Qwerty's white vocabulary page and translation hint are not copied because the selected target is LangFlow's dark video-focused mode and the current answer must not leak during listening.

## Comparison history

- Pre-final interaction pass found that the total mistake label was not refreshed during typing; it now updates immediately.
- Pre-final playback pass found that a preview clip ending before a subtitle boundary could stall the monitor; the playback boundary now safely respects the media duration.
- Post-fix evidence: final 1280 × 720 screenshot, complete-sentence interaction capture, successful transition to sentence 2, and an empty browser error log.

## Implementation checklist

- [x] Focused-mode structure retained.
- [x] Textarea removed.
- [x] Global character-slot typing implemented.
- [x] Current and future transcript answers masked.
- [x] Replay and automatic next-sentence flow implemented.
- [x] Visual and interaction verification completed.

## Dictionary card refinement QA — 2026-09-04

### Comparison target

- Source visual truth: `/Users/mengxianze/Documents/LangFlow/apps/website/public/langflow-ai-plugin-interface-showing-word-lookup-a.png`.
- Source pixels: 3838 × 1930.
- Rendered implementation: `/Users/mengxianze/Documents/ChatGPT/学英语/dictionary-card-preview.png`.
- Implementation pixels and CSS viewport: 1280 × 720 at the browser's normalized capture density.
- Focused side-by-side evidence: `/Users/mengxianze/Documents/ChatGPT/学英语/dictionary-card-comparison.png`, 862 × 520. The source and implementation card regions were cropped and proportionally normalized to the same 520px comparison height.
- State: dark focused mode, answer revealed with `Tab`, `remarkable` hovered, complete dictionary result visible.

### Full-view comparison evidence

- The refined card remains visually subordinate to the video and dictation task while preserving strong contrast over moving footage.
- It retains LongFlow's compact dark popover, word-first hierarchy, separate pronunciation area, grouped definitions, examples, close affordance, and bounded scrolling.
- Intentional adaptation: violet accents, softer 18px radius, section counts, and numbered examples match this extension's existing focused-mode tokens instead of copying LongFlow's blue-black card literally.

### Focused-region comparison evidence

- The old crowded title/actions row was replaced with a clear source label, 25px headword, secondary Chinese translation, and isolated close control.
- English and American pronunciation now occupy full-width rows, avoiding the truncation observed in the first two-column implementation pass.
- Definitions use stable part-of-speech pills and aligned copy; examples use number, English, and Chinese as three distinct reading levels.
- The card has a side-aware anchor, restrained entrance motion, visible loading skeletons, a contained error state, and an internal scrollbar.

### Required fidelity surfaces

- Fonts and typography: passed. System sans and monospaced phonetics remain consistent with the focused UI; hierarchy, line height, wrapping, and optical weights are clear at 1280 × 720.
- Spacing and layout rhythm: passed. Header, pronunciation rows, definitions, and examples use consistent 6–18px spacing and remain inside the 348 × 430 maximum frame.
- Colors and visual tokens: passed. Near-black surface, subtle borders, violet interactive accents, muted metadata, and white primary copy match the host interface with sufficient contrast.
- Image quality and asset fidelity: passed. This component has no required raster assets; it reuses the live video background and does not substitute imagery.
- Copy and content: passed. `夸克词典`, `英音`, `美音`, `播放`, `释义`, and `例句` accurately describe working controls and returned content.

### Interaction verification

- `Tab` reveals eight lookup targets in the preview sentence.
- Hovering a word opens the card after the intended delay.
- Moving from the word into the card and waiting longer than the close delay keeps the card open.
- The word hover cursor is no longer the question-mark/help cursor.
- Browser console check returned no warnings or errors.

### Comparison history

- First pass finding (P2): two-column pronunciation cards truncated longer phonetics and looked denser than the LongFlow reference.
- Fix: pronunciation controls were changed to two compact full-width rows with separate label, phonetic, and play affordance.
- Post-fix evidence: `dictionary-card-preview.png` and `dictionary-card-comparison.png` show both phonetics without truncation and a clearer vertical rhythm.

### Findings

- No actionable P0, P1, or P2 findings remain.
- P3 follow-up: the pointer anchor is intentionally subtle and may be strengthened later if users miss the relationship between the hovered word and card.

final result: passed

## 2026-09-06：独立学习页与播放器入口

### 本次视觉目标与证据

- 草图：`/var/folders/m8/8vdq7g712tj1cj3f19wqd7kc0000gn/T/codex-clipboard-26bff7fc-bdc0-405b-974f-933246621dbd.png`（1958 × 1168），左上视频、右上功能区、底部全宽听写区。
- 按钮位置参考：`/var/folders/m8/8vdq7g712tj1cj3f19wqd7kc0000gn/T/codex-clipboard-72f2d2b9-3697-45be-908b-f722f9d9bf2d.png`，YouTube 播放器字幕与设置按钮旁。
- 实现截图：项目根目录 `learning-preview.png`（1280 × 720 输出像素，实际 CSS viewport 1280 × 720），`learning-completed-preview.png`（1280 × 720）。截图按浏览器输出使用，未做像素变形。
- 第一轮同时查看草图与 1019 × 907 初始预览；最终轮同时查看草图与 `learning-preview.png`。草图没有字体、配色或真实内容，按布局意图对齐，不进行像素级复刻。
- 状态：第一句等待输入，后续字幕隐藏；另验收完成态的上下文与“连起来听”。

### 五项视觉检查

- 字体：沿用系统无衬线 UI 与等宽字符槽；底部字符可读，文案没有遮挡视频。
- 布局：视频与右栏共用上排，下排听写区独立于视频。功能设置移到右栏，导航保留在底部。桌面截图无页面横向溢出；字幕列表内部滚动是预期行为。完成态会适当增加底部高度以显示上下文。
- 配色：沿用既有深色底、紫色控件、绿色正确字符与白色当前字幕卡片。
- 图像：真实 YouTube 视频使用原生跨域嵌入播放器；界面预览仅用 TED 缩略图与演示视频，不代表字幕对应音频。入口使用 Tabler headphones 正式资源及其 MIT 许可。
- 内容：新页面正式入口使用“返回 YouTube”；预览中的“退出”仅退出本地演示。布局与草图一致，不把草图的区域名称作为用户界面占位文字。
- 聚焦对比：草图没有更细的控件规范，字符槽和已完成上下文通过完整桌面截图即可辨认，未另造局部目标。

### 交互与实现检查

- `node caption-segmentation.test.js`、`node caption-practice.test.js`、`node learning.test.js` 均通过。
- 新测试覆盖：入口只插入一次、播放器重建、站内导航、连点去重、先打开新页后暂停来源、失败清理、学习会话按标签页隔离、来源关闭后字幕缓存仍可读取、返回来源、跨来源消息拒绝、旧跳转状态不提前结束新片段、片段结束只暂停一次、所有清单资源存在。
- 真实网络联调：`tests/player-preview.html` 使用正式播放适配器与本地官方 IFrame API，TED 视频 30–34 秒片段在 33.98 秒暂停，状态报告 `paused=true, ended=true`。这只验证普通网页环境中的真实嵌入播放，不等同于扩展 E2E。
- 本地完成态点击“连起来听”后，截图显示播放结束并保持当前完成片段。
- 最终布局预览 console 无 warning/error。

### 迭代记录与剩余验收

- 联调发现的 P0：沙箱的 opaque origin 导致 YouTube 访问 Cache Storage 时抛出 SecurityError，播放器无法启动。
- 修复：移除沙箱方案，官方 IFrame API 固定版本随扩展本地打包，视频保留 YouTube 原生跨域 iframe。页面只执行本地脚本。修复后真实视频已就绪并完成指定片段自动暂停。
- 新增只限学习标签页、仅 YouTube embed 子框架请求的 Referer 会话规则；须在加载扩展后验证实际请求来源标识。
- 剩余阻塞：浏览器安全策略拒绝访问扩展管理页，无法自动重新加载；检查 Edge 的现有 YouTube 页未见新入口。因此按钮真实外观、扩展 CSP/Referer、字幕传递至新标签页的完整流程仍待用户重新加载后实机验收。
- 窄窗口测试未计为通过：viewport override 未改变实测 1280 × 720 的窗口尺寸。已恢复 override。
- 桌面学习页视觉布局没有待修复 P0/P1/P2 差异；整体验收因上述扩展实机环节未完成而保留 blocked 状态。

### Checklist

- [x] 独立标签页及三块布局
- [x] 听写和上下文回归
- [x] 真实 YouTube 嵌入播放与句末暂停
- [x] 入口生命周期、会话隔离及失败清理自动测试
- [ ] Edge 重新加载后的实际按钮和完整学习流程

final result: blocked


## 2026-09-06：答对后精读与右侧单句详解

- 答对后移除字符槽、填空横线、字符统计、答题反馈与查看答案按钮；保留完整英文、查词和复播。
- 右侧字幕列表与单句详解通过页签切换；答对不自动切换，未完成句子显示锁定提示。
- 原句按有序解析块显示彩色下划线，右侧同色标题显示原形、词性、翻译和解释。
- 播放高亮独立使用可靠的源词级时间；无时间或估算时间不生成假的逐词进度。
- 解析复用现有 DeepSeek 配置；验证完整原文、有序块和重复词位置，缓存按上下文区分，失败提供重试。
- 浏览器验证：真实键盘完成拼写、自动复播、手动复播、查词、下一句锁定、迟到响应隔离、缺少 Key、失败重试、1440px 桌面和 390px 窄屏无横向溢出。
- 自动检查：字幕分句、练习播放、学习页、翻译、解析测试及 `tests/review-browser.cjs` 通过。
- 浏览器测试使用示例解析和受控播放时间；未使用真实 Key 请求 DeepSeek，未验证真实 YouTube 音画同步。
