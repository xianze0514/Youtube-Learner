<a id="readme-top"></a>

<div align="center">
  <img src="assets/headphones.svg" alt="耳机图标" width="64" height="64">
  <h1>English Listening Typing</h1>
  <p>用喜欢的 YouTube 视频，练习英语精听、听写与跟读。</p>
  <p>
    <a href="#getting-started"><strong>开始使用</strong></a> ·
    <a href="#usage">使用指南</a> ·
    <a href="docs/DEVELOPMENT.md">开发文档</a> ·
    <a href="https://github.com/xianze0514/Youtube-Learner/issues">反馈问题</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
    <img src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black" alt="原生 JavaScript">
    <img src="https://img.shields.io/badge/构建-无需构建-7C3AED" alt="无需构建">
  </p>
</div>

<details>
  <summary>目录</summary>
  <ol>
    <li><a href="#about">项目介绍</a></li>
    <li><a href="#getting-started">快速开始</a></li>
    <li><a href="#usage">使用指南</a></li>
    <li><a href="#ai-features">翻译与单句详解</a></li>
    <li><a href="#privacy">数据与权限</a></li>
    <li><a href="#faq">常见问题与限制</a></li>
    <li><a href="#development">开发与贡献</a></li>
    <li><a href="#acknowledgments">许可与致谢</a></li>
  </ol>
</details>

<a id="about"></a>

## 项目介绍

English Listening Typing 是一个基于 YouTube 原声与英文字幕的浏览器扩展。点击播放器中的紫色耳机按钮，即可在独立学习页完成「听原声 → 键盘听写 → 答对复播 → 精读跟读」的练习。

使用原生 JavaScript、HTML 和 CSS，基于 Chrome Extension Manifest V3。安装和运行无需构建、安装 npm 依赖或部署后端；中文翻译和单句详解可按需配置自己的 DeepSeek API Key。

![独立学习页布局示意：左侧视频、右侧字幕、底部听写区](docs/images/learning.png)

*上图为演示字幕下的学习页布局示意。当前交互可通过[本地预览](docs/DEVELOPMENT.md#preview)查看。*

| 功能 | 你可以做什么 |
| --- | --- |
| 原声逐句听写 | 自动读取英文字幕，隐藏当前及后续答案，直接输入听到的内容 |
| 即时输入反馈 | 大小写不敏感、自动跳过标点；输错时只清空当前单词 |
| 复播与跟读 | 答对后自动复播，可停留练习、调整速度，或自动进入下一句 |
| 上下文连听 | 完成同组片段后，把它们连起来听 |
| 查词与连读提示 | 悬停查词、查看英美音标与发音，参考辅音接元音的连读弧线 |
| 翻译与句法拆解 | 答对后查看中文翻译、嵌套句法结构、语法表达和重点词汇，需要 API Key |
| 学习记录 | 自动保存字幕与进度，从工具栏弹窗继续上次的练习 |

<a id="getting-started"></a>

## 快速开始

准备 Chrome 或兼容 Manifest V3 的 Edge 浏览器，以及一个可访问、带英文字幕的 YouTube 视频。

### 安装扩展

1. [下载项目 ZIP](https://github.com/xianze0514/Youtube-Learner/archive/refs/heads/master.zip) 并解压，或克隆仓库：

   ```bash
   git clone https://github.com/xianze0514/Youtube-Learner.git
   cd Youtube-Learner
   ```

2. 在 Chrome 地址栏打开 `chrome://extensions/`；Edge 使用 `edge://extensions/`。
3. 打开右上角的「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择包含 `manifest.json` 的项目目录。
5. 刷新 YouTube 视频页，点击播放器设置按钮旁的紫色耳机按钮。

可以在浏览器扩展菜单中固定图标，方便随时打开学习记录。更新代码后，重新加载扩展、刷新 YouTube 页面，并关闭旧学习页后重新打开。

<a id="usage"></a>

## 使用指南

1. **选择起点**：在 YouTube 视频中跳到想练习的位置，再点击耳机按钮。首次学习从当前位置开始，已有记录时自动续学；字幕加载完成前请保持原视频页打开。
2. **听完再输入**：原句播放结束后，直接用键盘听写。标点自动跳过，单词之间的空格需要输入。
3. **答对后跟读**：扩展显示原句并自动复播。默认停留当前句，按 `Enter` 或 `→` 继续；也可在设置中开启自动下一句。
4. **理解原句**：悬停单词查词，或切换右侧「单句详解」。完成同组全部片段后，可使用「连起来听」。
5. **随时离开**：点击「返回 YouTube」或按 `Esc` 暂停训练并返回原视频，学习页保留。下次点击工具栏图标中的「继续学习」即可恢复。

### 快捷键

| 按键 | 作用 |
| --- | --- |
| 直接输入 | 填写当前听写内容 |
| `Backspace` | 删除上一个已接受字符 |
| `Tab` | 显示或隐藏答案；显示后可悬停查词 |
| `Ctrl + J` / `Command + J` | 重播本句 |
| `Enter` / `→` | 答对并停留时进入下一句 |
| `Space` | 非输入阶段播放或暂停；答对并停留时重播 |
| `Esc` | 暂停训练并返回原视频 |

### 保存与续学

字幕、当前句、已输入内容、完成情况、错误次数、播放速度和音效设置会自动保存在本机。刷新学习页、关闭标签页或重启浏览器后，可继续练习；学习页左上角显示保存状态，失败时可以重试。

记录仅属于当前浏览器配置，不跨设备同步。卸载扩展或清除扩展数据会移除记录；强制结束浏览器时，最后一次尚未写入的操作可能丢失。

<a id="ai-features"></a>

## 翻译与单句详解

在学习页点击「设置」，填写自己的 **DeepSeek API Key**，点击「测试连接」后保存。当前代码使用 `deepseek-v4-flash`；不配置 Key 也可以听写、查词和播放。

| 设置或功能 | 行为 |
| --- | --- |
| 显示中文翻译 | 控制答对后原句下方的简体中文翻译 |
| 单句详解 | 共用 API Key，独立于翻译开关；提前加载，答对后解锁 |
| 句法结构 | 原句与右侧详解用同色分组，默认展开内部成分；点击查看作用与关联，可收起或用键盘操作 |
| 语法与词汇 | 查看固定表达、跨成分关系，以及可展开的重点词、原形和词形说明 |

翻译和详解会预取当前及后续共最多 10 个片段，分别最多并发 3 个请求，并缓存结果 7 天。详解会附带前后各一条字幕作为上下文，只解释当前片段。**关闭「显示中文翻译」不会停止单句详解请求**；配置 Key 后，预加载会使用你的 API 额度。

模型解释可能存在错误。结构不完整时可点击「重试完整结构」；字幕残片或歧义会单独提示。原句中的短竖线仅用于区分内部成分，不表示朗读停顿，也不会影响复制原文。

连读弧线无需 API Key，依据词典美式音标预测辅音接元音的位置；不代表已确认原声发生连读。缺少音标时跳过；省音、同化和元音滑音暂不标记。逐词播放高亮仅在字幕提供可靠词级时间时显示。

<a id="privacy"></a>

## 数据与权限

项目没有账号系统、分析埋点或自建后端。听写输入与错误统计不上传，API Key 保存在 `chrome.storage.local`，不会同步到其他设备或提供给 YouTube 页面。

| 权限或服务 | 用途 |
| --- | --- |
| `activeTab`、`scripting` | 在用户操作后读取 YouTube 页面和播放器字幕信息 |
| `storage`、`unlimitedStorage` | 本机保存设置、Key、字幕、学习进度与缓存 |
| `declarativeNetRequestWithHostAccess` | 为当前学习标签页的 YouTube 嵌入请求设置来源标识；关闭后删除会话规则 |
| YouTube | 读取视频与字幕，播放原声 |
| DeepSeek | 启用翻译后发送待翻译字幕；配置 Key 后发送预加载的详解字幕及相邻上下文 |
| 夸克词典 | 悬停查词，以及自动查询当前片段中未缓存单词及必要原形的音标 |
| 有道 | 用户点击发音时请求单词音频 |

连读提示不上传视频或音频。Key 仍属于浏览器配置中的本地敏感数据，请妥善保管所在设备与浏览器配置。

<a id="faq"></a>

## 常见问题与限制

<details>
  <summary>找不到耳机按钮，或点击后没有反应</summary>

重新加载扩展并刷新 YouTube 视频页。耳机入口只在视频页出现；工具栏扩展图标打开的是学习记录弹窗，可在任意网页使用。

</details>

<details>
  <summary>提示找不到英文字幕</summary>

先在 YouTube 播放器中确认可以开启英文字幕。扩展依赖视频已有字幕，优先读取人工英文字幕；地区、登录状态或内容限制可能导致字幕无法读取。

</details>

<details>
  <summary>视频没有自动播放，或无法嵌入</summary>

尝试点击视频播放按钮或「重播本句」。作者禁止嵌入、视频私密或内容受限时，学习页无法正常播放。这里使用正常的 YouTube 嵌入播放器，广告仍由 YouTube 决定。

</details>

<details>
  <summary>没有中文翻译或单句详解</summary>

检查 API Key 并使用「测试连接」验证。中文翻译还需要开启对应开关；单句详解要答对后才解锁。失败时可以重试，不影响继续听写。

</details>

当前支持 YouTube 网页版，尚不支持账号同步、学习记录导出或跨设备续学。字幕质量会影响练习片段和时间对齐；YouTube 页面、字幕接口及第三方服务变化也可能影响功能。字幕处理规则见[开发文档](docs/DEVELOPMENT.md#captions)。

<a id="development"></a>

## 开发与贡献

修改 HTML、CSS 或 JavaScript 后重新加载扩展即可。开发环境、全部测试命令、预览场景和目录说明见[开发文档](docs/DEVELOPMENT.md)。

欢迎通过 [Issues](https://github.com/xianze0514/Youtube-Learner/issues) 报告问题或提出建议。复现问题时请附浏览器版本、操作步骤、预期与实际表现；字幕问题可附可公开访问的视频链接与时间点。提交 Pull Request 前，请运行相关回归测试；界面变更可附截图，避免提交 API Key、浏览器数据或临时调研产物。

<a id="acknowledgments"></a>

## 许可与致谢

仓库目前未声明项目整体许可证。第三方素材和代码遵循各自许可与条款：

- 耳机图标来自 Tabler Icons，许可见 [assets/TABLER-LICENSE](assets/TABLER-LICENSE)。
- 本地打包的 YouTube IFrame Player API 来源、条款与更新说明见 [vendor/README.md](vendor/README.md)。
- README 结构参考 [Best-README-Template](https://github.com/othneildrew/Best-README-Template)。
- 字幕设计参考 [asbplayer](https://github.com/asbplayer/asbplayer) 与 [SaT / wtpsplit](https://github.com/segment-any-text/wtpsplit)，未引入其依赖或复制代码。

<p align="right"><a href="#readme-top">返回顶部 ↑</a></p>
