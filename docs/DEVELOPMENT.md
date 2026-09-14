# 开发指南

[← 返回 README](../README.md)

项目使用原生 JavaScript、HTML 和 CSS，没有运行时 npm 依赖或构建步骤。浏览器直接从项目根目录加载扩展。

## 环境与日常开发

- Chrome：加载 Manifest V3 扩展；浏览器测试也使用本机 Chrome。
- Node.js：运行根目录的回归测试。
- Python 3：启动本地预览服务。
- Playwright：仅浏览器交互测试需要，可按下方命令安装。

修改代码后，在 `chrome://extensions/` 重新加载扩展并刷新 YouTube 页。修改学习页脚本后，关闭旧学习页再重新打开。调试后台逻辑时，从扩展管理页打开 service worker 的开发者工具。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `manifest.json` | 扩展清单、权限与入口 |
| `background/main.js` | Service worker 消息入口 |
| `background/learning.js`、`background/history.js` | 学习标签页、会话、字幕传递与持久进度 |
| `background/analysis.js`、`background/translation.js` | DeepSeek 句法详解、翻译、校验与缓存 |
| `background/dictionary.js`、`background/linking*.js` | 词典查询、音标和连读规则 |
| `background/settings.js`、`background/youtube.js` | 设置与 YouTube 页面通信 |
| `content/launcher.js` | YouTube 播放器耳机入口，处理站内导航和播放器重建 |
| `content/` | 训练控制、字幕处理、渲染、精读、查词与进度保存 |
| `learning.html`、`learning-player.js` | 学习页及播放器消息适配器 |
| `player.html`、`player.js`、`vendor/` | 本地官方 IFrame API 与跨域 YouTube 播放器 |
| `popup.*`、`options.*` | 学习记录弹窗与设置页 |
| `styles/`、`assets/` | 界面样式与运行时素材 |
| `preview.html` | 无需加载扩展的界面预览 |
| `*.test.js` | Node.js 回归测试 |
| `tests/` | 浏览器测试、演示夹具与播放器联调页 |
| `docs/images/` | README 使用的说明图片 |

## 回归测试

在项目根目录执行，不需要安装 npm 依赖：

```bash
node caption-segmentation.test.js
node caption-practice.test.js
node learning.test.js
node progress.test.js
node translation.test.js
node analysis.test.js
node review-prefetch.test.js
node linking.test.js
node linking-review.test.js
```

这些脚本覆盖字幕边界和练习流程、学习会话和播放适配、进度持久化、翻译与详解校验、缓存和预取、连读规则及显示时机。它们主要使用模拟 API，不证明真实 YouTube 或 DeepSeek 服务可用。

<a id="preview"></a>

## 界面预览

在项目根目录启动服务，预览与浏览器测试统一使用 4178 端口：

```bash
python3 -m http.server 4178 --bind 127.0.0.1
```

| 场景 | 地址 |
| --- | --- |
| 听写界面 | [preview.html](http://127.0.0.1:4178/preview.html) |
| 答对后的精读界面 | [scenario=review](http://127.0.0.1:4178/preview.html?scenario=review) |
| 疑问句与嵌套句法结构 | [scenario=syntax](http://127.0.0.1:4178/preview.html?scenario=syntax) |
| 上下文完成与连听 | [scenario=context](http://127.0.0.1:4178/preview.html?scenario=context) |
| 真实 YouTube 播放器联调 | [player-preview.html](http://127.0.0.1:4178/tests/player-preview.html) |

`preview.html` 使用演示字幕和模拟 API，不读取真实 YouTube 字幕。句法示例来自人工编写的 `tests/fixtures/syntax-analysis.json`，不代表模型实测质量；演示视频只用于检查播放控制，与练习字幕内容无关。

播放器联调页使用与扩展相同的本地官方 API 和播放适配器，检查 30–34 秒片段播放与自动暂停，需要网络；它不覆盖扩展权限、字幕传递及请求来源标识。完整验证仍需在已加载的扩展中操作真实视频。

### 浏览器交互测试

保持上述服务运行，在另一终端进入项目根目录，安装测试工具并执行：

```bash
npm install --no-save --package-lock=false playwright
node tests/review-browser.cjs
node tests/syntax-interaction-browser.cjs
node tests/history-browser.cjs
```

测试脚本通过 `require('playwright')` 加载依赖，并以 `channel: 'chrome'` 启动本机 Chrome。`node_modules/` 已忽略，无需为扩展运行安装这些依赖。

| 脚本 | 覆盖内容 |
| --- | --- |
| `review-browser.cjs` | 真实键盘输入、答对状态、播放高亮、查词、详解锁定、延迟响应、失败重试与窄屏布局 |
| `syntax-interaction-browser.cjs` | 嵌套成分展开、单竖线、成分关系、面板同步、收起、键盘操作、原文复制与换行 |
| `history-browser.cjs` | 输入后刷新、答对恢复、关闭重开、错误与速度保留、保存失败重试、弹窗续学及耳机入口 |

浏览器测试模拟网络或播放器，截图写入 `/tmp/elt-*.png`。这些截图是运行产物；需用于文档的图片应整理到 `docs/images/` 并更新引用。

<a id="captions"></a>

## 字幕边界与播放时间

扩展从当前播放器和 YouTube 播放器接口获取字幕轨，优先人工英文字幕。练习以字幕 cue 为基础，保留原文、时间和来源索引：

1. 清理 HTML、非对白提示和无效空白，仅对自动字幕消除时间重叠的滚动重复词。
2. 根据句末标点、长停顿和时长上限建立上下文组，不因此改变练习边界。
3. 仅合并紧邻的极短残片：一侧不超过 2 词、间隔不超过 350ms、合并后不超过 16 词和 8.5 秒，且不跨句末。
4. 尝试使用逐词时间校准：至少 90% 规范化词匹配、首尾可靠、时间单调且偏移受限；不可靠处保留原时间，上下文连听时间同步更新。
5. 一条 cue 包含多个句子时，仅在每句都达到逐词对齐要求时拆开，否则保留整条。

不按字数均摊时间来新增播放边界。字幕较长或缺少可靠词级时间时，练习片段也可能较长；上下文归属是启发式结果，不保证每组对应完整语法句。

「连起来听」只在当前组全部完成后出现，不改变答题记录，播放结束后停留当前片段。播放高亮独立使用可靠的字幕词级时间，不使用模型句法边界推算。

## 单句详解与连读

单句详解采用递归句法结构，将结构类型、句中作用、关联与解释分开；语法和固定表达标注可跨块或重叠，但必须对应原文。验证检查原文覆盖、父子范围、重复词位置与词内边界，保证位置对齐，不保证模型语法判断正确。

遇到拆开缩写或单词的结果，会在同一超时窗口内纠正一次；仍存在词内拆分时保留有效上层结构、隐藏无效细分，并提供「重试完整结构」。部分结果不写入长期缓存，网络错误和其他结构错误正常报错。

| 数据 | 缓存与请求策略 |
| --- | --- |
| 翻译 | 缓存 7 天；最多 1500 条；每个片段独立请求 |
| 单句详解 | 使用 v2 缓存；按原文、相邻上下文和模型复用，7 天内最多 150 条 |
| 翻译与详解预取 | 各自预取当前及后续共最多 10 句、最多并发 3 句；切句后优先当前句 |
| 连读音标 | 仅预取当前片段；最多并发 3 个查询，同词共享请求，7 天内最多 2000 词 |

连读提示仅预测词尾辅音接下一词元音。保留音标的多种读法，边界类型一致才标记；支持常见规则词形与缩写补全，缺音标则跳过，不跨标点、连字符或练习片段。规则输出不等同于原声连读的实测结果。

## 提交约定

保留可复用的测试、演示夹具、开发文档与第三方来源说明。一次性研究放在已忽略的 `research/` 中；缓存、临时截图和本地环境配置不提交。第三方播放器更新流程见 [vendor/README.md](../vendor/README.md)。
