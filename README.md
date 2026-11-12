<p align="center">
  <img src="assets/icon-512.png" width="120" height="120" alt="dsh-pdf-math-reader icon">
</p>

<h1 align="center">dsh-pdf-math-reader</h1>

<p align="center"><a href="README.en.md">English</a> · 简体中文</p>

> PDF Math Reader — 在 DeepSeek Harness 中阅读、翻译、记笔记与 AI 问答一体化的学术 PDF 工作台。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PDF.js](https://img.shields.io/badge/PDF.js-4.10.38-orange)](assets/PDFJS-LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![GitHub](https://img.shields.io/badge/GitHub-xiayifan1024%2Fdsh--pdf--math--reader-181717?logo=github)](https://github.com/xiayifan1024/dsh-pdf-math-reader)

**dsh-pdf-math-reader**（界面名称：PDF Math Reader）是一个运行在
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 中的 PDF
阅读与学术翻译插件。设计参考
[PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate)
“保持公式、引用与版式语义”的学术文档阅读思路，但以 **本地阅读 + 段落级双语对照**
的方式落地，不修改原 PDF。

它适合读论文、技术报告、教材和带文本层的 PDF：PDF 在浏览器内渲染，翻译、术语表、
阅读笔记、AI 文献问答都在同一个面板中完成。

<p align="center">
  <img src="docs/screenshot.jpg" alt="PDF Math Reader 界面：左侧目录、中间 PDF 页面、右侧译文与笔记" width="100%">
</p>

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [快捷键](#快捷键)
- [配置](#配置)
- [隐私与安全](#隐私与安全)
- [架构](#架构)
- [开发](#开发)
- [限制与路线图](#限制与路线图)
- [常见问题](#常见问题)
- [致谢](#致谢)
- [贡献](#贡献)
- [License](#license)

## 功能

### 阅读

- 侧边栏「PDF 阅读」入口，目录与真实页面缩略图导航。
- 本地渲染 PDF，支持翻页、缩放、适合宽度、双栏文本重建。
- 左右侧栏可拖动分隔条调整宽度，宽度自动保存。
- 文本层使用 PDF.js 原生 `TextLayer`，选中范围与页面文字对齐。
- 首屏按论文结构重排：跨行标题合并为一个标题块，作者、单位与邮箱采用紧凑的作者列表，
  摘要与关键词单独标识；长摘要按完整句子分组，不会在一句话中间切断。
- 正文字号可用译文面板右上角的 `A−` / `A+` 调整，字号与显示模式自动保存。
- 右栏原文、译文和作者信息可直接选中复制；段落、标题、摘要悬停时提供复制按钮，工具栏还可
  一键复制整页原文或整页译文。AI 回答和阅读笔记同样带复制按钮。
- 左栏在有参考文献时显示「参考论文」页签：自动识别 References / Bibliography 章节，按编号
  拆分条目，支持双栏、悬挂缩进等常见排版；列表不跳转，可直接选中或一键复制全部参考文献。
- 左栏「搜索」页签支持全文关键词搜索：多个关键词用空格分隔且需同时出现，结果按页分组并显示
  命中片段；点击结果跳到对应页，页面上以蓝色标出本页全部命中、当前命中用黄色强调。
  工具栏的搜索按钮与 `Ctrl` / `Cmd` + `F` 都能直接打开搜索；窗口较窄、左栏隐藏时，搜索会以
  浮层显示，不依赖左栏。
- 阅读位置按文档指纹记录：重新打开同一份 PDF（包括刷新页面后）会自动回到上次阅读的页面，
  并在设置中提供「清除阅读位置记录」。
- `←` / `→` 翻页，`↑` / `↓` 滚动当前页；`A` / `D` 也可以翻页。
- 鼠标滚轮在页面内滚动，到达顶部/底部后自动翻到上一页/下一页（1 秒冷却）。

### 翻译

- 段落级 **双语 / 仅译文 / 仅原文** 三种视图，切换按钮位于译文面板顶部并记住上次选择。
- 双语模式按段对照，原文与对应译文紧邻；仅译文模式使用连续文章排版，不显示逐段卡片边框。
- 译文面板和 AI 阅读面板各自提供**模型 / 推理等级**选择，翻译与问答可以使用不同模型；
  选择保存在浏览器本地，未选择时跟随 DSH 当前默认模型。
- 单页翻译、选中文本翻译、全文批量翻译，带进度与停止。
- 翻译提示词要求原样保留公式、LaTeX、引用、DOI、编号、代码与 URL。
- 术语表：每行 `source=target` 或 `source：target`，命中术语强制使用指定译名。
- 译文按段缓存，切换页面不重复请求；可在设置中清除缓存。
- 目标语言与术语表保存在浏览器 `localStorage`。

### 公式

- 独立公式按**区域**识别：结合公式编号、右侧对齐、数学字体、运算符、上下标与垂直留白，
  不把标题、页码、列表编号或表格单元当成公式。
- 每条公式以一个完整块显示：独立渲染的 PDF 高清裁剪图 + 编号，不再把上下限、分子分母
  拆成多张碎片卡片。
- 公式区域内的文本项从正文段落中剔除；双语模式下公式只显示一次，公式前后段落各自保留
  原文与译文。
- 点击公式块可定位并高亮 PDF 原区域；长公式支持横向滚动，支持放大查看。
- 自动识别有误时可点工具栏「框选公式」手动框出完整区域，或在公式卡片上选「不是公式」
  撤销误判。修正按**文档指纹 + 页码**持久化，重新打开文档后仍生效，也可以一键恢复自动识别。
- 正文中的行内公式在翻译请求里替换为 `⟦MATH_001⟧` 形式的唯一占位符；译后必须验证占位符
  完整、未重复、无未知标记。校验失败会把该段标记为失败并提供重试，不会保存错误译文。
- 公式块预留 `latex` 字段。第二阶段接入公式识别服务后使用 KaTeX 渲染，并保留原图对照；
  识别或渲染失败时自动回退到原图。

<p align="center">
  <img src="docs/equations-preview.png" alt="Attention 论文公式 (1)、(2) 与 MultiHead 公式的独立高清裁剪，分式、上下标和编号均完整" width="82%">
</p>

上图为 `tests/fixtures/attention.pdf` 的真实裁剪结果：公式 (1) 的求和式分式、上标 `T` 与下标
`d_k` 均未被裁切，公式 (2) 的上下标完整；编号在卡片标题中单独显示。

### 图表

- 图表与表格分开识别。图表取**页面绘图区域**（位图与矢量路径）；表格另外结合
  「Table N」表题、横线/网格、列对齐与行距连续性判断，因此 booktabs 风格（只有横线）、
  带表题的彩色表头（只有填充块）和**纯文字表格**都能成为「表 N」卡片，而不只是截到表头。
- 表格区域会向下扩展到连续的数据行，表头、行标题和数据区作为一个整体裁剪；表题与表注
  仍是正文段落，照常翻译。
- 图内文字按**视觉行**归属到所在图表：坐标落在绘图区域内（或紧贴其上下的图题行）的文字
  变成该图的「图内文字」。图注（`Figure 1:` / `Fig. 1` / `Table 2:`）不会变成图内文字。
- 图内文字不再进入正文段落，也不再把 `Input → Output` 这类带箭头的标注行识别成独立公式。
- 每个图表以一个卡片显示：高清裁剪图 + 图号/表号（来自最近的图注）+ 可展开的图内文字列表，
  默认折叠，避免逐条堆在译文里。
- 点击卡片或图内文字所在区域可定位并高亮原图；长图可横向滚动。
- 「放大查看」已升级为占据大部分窗口的查看器：高清重新裁剪、向左/向右旋转 90°、缩放、
  拖动平移、「完整显示 / 适合宽度」与恢复初始视图。查看器旋转独立于页面方向，关闭后回到
  原来的阅读位置。
- 工具栏「框选图表」可直接框出完整图表或表格（拖动到窗口边缘会自动滚动，边界吸附到文字行）；
  卡片上的「调整范围」提供八向手柄，保存后同步更新卡片、放大查看与导出图片。
- 误判时可在卡片上选「不是图表」，图内文字回到正文段落；手动框选与范围修正按文档指纹 +
  页码持久化，可单项「恢复自动识别」，也可整页恢复。

<p align="center">
  <img src="docs/figures-preview.png" alt="Attention 论文 Figure 3 被识别为一个图表块，图内文字收进可展开列表，图注仍是可翻译段落" width="46%">
</p>

上图为 `tests/fixtures/attention.pdf` 第 13 页的真实侧栏：热力图连同沿线文字被收进一个「图 3」
卡片，图内文字默认折叠；图注仍是普通段落，参与翻译。

### 笔记

- 点击 PDF 段落，切到右侧「笔记」标签即可写笔记。
- 笔记以标签卡片展示：页码、原文摘录、笔记内容。
- 点击笔记卡片跳转到对应页并定位段落；再次点击段落可取消高亮。
- 有笔记的段落在页面上以黄色高亮显示，当前选中段落以橙色高亮显示。
- 笔记保存在本地 `localStorage`，按文档指纹区分，支持编辑与删除。

### AI 文献阅读

- 右侧「AI 阅读」标签，支持多轮问答。
- 上下文范围可选：**本页及相邻页** 或 **全文**。
- 回答只基于传入的文档文本，不要求模型“记住”整篇 PDF。
- 可导入 **DSH Skill**，或从本地 `.md` / `.txt` 文件导入自定义阅读方法。
- 适合问：核心贡献、公式含义、实验结论、方法与 baseline 的差异等。

### 导出

- 导出双语 Markdown；独立公式以编号 + 公式文本块保留，图表以图号 + 图内文字列表保留。
- 导出 **Markdown + 公式/图表图片 ZIP**：压缩包内包含 `.md`、`equations/*.png` 与
  `figures/*.png`，离线打开时公式与图表仍然可见。
- 导出可打印的对照 HTML；公式与图表图片以 data URI 内嵌，不依赖外部文件。可直接用浏览器
  “打印为 PDF”。

## 快速开始

### 环境要求

- DeepSeek Harness Desktop / Web UI，且 profile 中已配置可用的模型路由。
- 构建客户端需要 Node.js 22+ 与 npm。
- 运行时不需要 Python、BabelDOC 或额外 PDF 工具。

### 安装到 DSH

`--profile` 填**你平时启动的那个 profile**。profile 名就是 `~/.dsh/profiles/` 下的目录名
（Windows 上是 `%USERPROFILE%\.dsh\profiles\`）：

| 启动方式 | `--profile` 填什么 |
|---|---|
| DSH Desktop 桌面应用 | `desktop` |
| 命令行 `dsh web` 打开 Web UI | `web` |
| 想和日常环境隔离 | 自定义名字，如 `reader`，之后用 `dsh --profile reader web` 启动 |

插件只对安装它的 profile 生效：装进 `web` 不会出现在桌面应用里，反之亦然；命令里的名字也要和
启动时用的名字一致。不确定有哪些 profile，看一眼上面的目录即可。

推荐直接从 GitHub 安装：

```bash
dsh plugin --profile desktop add github:xiayifan1024/dsh-pdf-math-reader
```

也可以克隆仓库后使用本地 bundle（界面里的 Plugin Manager 作用于当前运行的 profile，不需要再写
profile 名）：

```text
plugin_manager install_bundle target=<本仓库绝对路径>
```

例如：

```text
plugin_manager install_bundle target=D:\plugins\dsh-pdf-math-reader
```

安装成功后，侧边栏会出现「PDF 阅读」图标。若安装前 Web UI 已经打开，请刷新页面
（`Ctrl+Shift+R`）以加载新的客户端 bundle。

首次打开面板时，插件会请求：

```text
GET /pdf-reader/api/health
```

确认模型服务、provider、model 与请求限制。

### 更新

更新方式与当初的安装方式对应：`github:` 来源会在锁文件里钉住一个具体 commit，普通的
`pnpm install` 不会重新解析；`link:` 来源直接指向本地目录，没有版本可解。

**从 GitHub 安装的**，在同一个 profile 下重新解析这个依赖：

```bash
dsh plugin --profile desktop update dsh-pdf-math-reader
```

也可以重装一次并顺手锁到某个 tag（回滚同样是换 tag）：

```bash
dsh plugin --profile desktop add github:xiayifan1024/dsh-pdf-math-reader#v1.5.0
```

不要只跑 `dsh plugin --profile desktop install`：spec 没变时 pnpm 会认为
`Lockfile is up to date`，锁文件里的 commit 不动，加载的还是旧代码。

**用本地目录（`link:`）安装的**，改完源码重新构建即可，不必重装：

```bash
npm run build
```

**在界面里用 Plugin Manager 安装的**，按它自己的提示「卸载后重装」：先 `remove_bundle`，再用同一个
target 执行 `install_bundle`（Plugin Manager 只对 Official 条目提供就地 Update）。`list_bundles`
可以确认当前装的是哪个版本。

更新后确认生效：

- Host 侧改动（`index.js`、`lib/`）需要**重启 DSH**；只改了 `client.js` 的，强制刷新页面
  （`Ctrl+Shift+R`）即可。
- 打开面板时 `GET /pdf-reader/api/health` 返回的 `version` 是当前加载的 Host 版本。
- 想确认 GitHub 来源真的换了 commit，看 `~/.dsh/profiles/<profile>/pnpm-lock.yaml` 里
  `codeload.github.com/…/tar.gz/<commit>` 的 commit 是否已更新。

卸载用 `dsh plugin --profile desktop remove dsh-pdf-math-reader`，依赖和 `dsh.profile.bundles`
里的条目会一起删掉；也可以走 Plugin Manager 的 `remove_bundle`。

### 使用流程

1. 点击侧边栏「PDF 阅读」。
2. 点击「打开 PDF」或把 PDF 拖进面板。
3. 检查译文面板中的公式块；自动识别不准时点「框选公式」手动修正，或点公式卡片上的
   「不是公式」撤销误判。
4. 在右侧「译文」中翻译当前页、选中文本或全文。
5. 点击段落 → 切到「笔记」记录要点。
6. 切到「AI 阅读」，选择上下文范围后提问；需要时导入 Skill。
7. 从右上角导出双语 Markdown、Markdown + 公式图片 ZIP 或对照 HTML。

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 上一页 / 下一页 | `←` / `→`，或 `A` / `D` |
| 当前页向上 / 向下滚动 | `↑` / `↓` |
| 打开文档搜索 | `Ctrl` / `Cmd` + `F` |
| 滚轮翻页 | 页面滚到顶部/底部后继续滚动，1 秒冷却 |
| 取消段落高亮、选区与公式框选 | `Esc` |
| 输入框中输入 | 不会触发上述快捷键 |

## 配置

配置位于 `cordis.patch.yml`，也可以在 profile 的 patch 层覆盖：

```yaml
config:
  provider: deepseek-account   # 留空则使用 profile 默认模型
  model: deepseek-flash
  maxSegmentsPerRequest: 5
  maxCharsPerRequest: 3800
  maxTextChars: 8000
  timeoutMs: 180000
  cacheEntries: 600
  chatMaxChars: 24000
  chatTimeoutMs: 150000
  chatMaxTokens: 8192
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `provider` | profile 默认 | 覆盖模型 provider |
| `model` | profile 默认 | 覆盖模型 id |
| `maxSegmentsPerRequest` | `5` | 单次翻译请求的最大段数 |
| `maxCharsPerRequest` | `3800` | 单次翻译请求的最大字符数 |
| `maxTextChars` | `8000` | 单个段落的最大字符数 |
| `timeoutMs` | `180000` | 翻译请求超时 |
| `cacheEntries` | `600` | 翻译结果内存缓存条数 |
| `chatMaxChars` | `24000` | AI 阅读上下文最大字符数 |
| `chatTimeoutMs` | `150000` | AI 阅读最短等待时间；输出额度越大自动放宽（上限 15 分钟） |
| `chatMaxTokens` | `8192` | AI 阅读请求未提供有效回答长度档位时使用的默认输出 token 数；读者可在设置中选择 2048–65536，所选档位可高于此配置值 |

## 隐私与安全

- **PDF 不上传**：PDF 文件在浏览器内读取和渲染，只有你主动翻译或提问的文本会发送到模型。
- **使用现有模型**：插件不保存 API Key；翻译与问答走当前 DSH profile 的模型路由。
- **资源隔离**：PDF.js、CMaps、字体全部由本插件 Host 提供，资源路径经过包含性校验，拒绝盘符路径、绝对路径和目录穿越。
- **提示词约束**：文档段落作为数据传入，并要求模型保留公式与引用；AI 回答被限定在提供的文档片段内。
- **本地数据**：术语表、笔记、面板宽度、阅读位置与公式框选修正保存在浏览器 `localStorage`；翻译缓存只存在当前页面会话内。

## 架构

```text
┌──────────────────────────────┐
│ Web UI（React，client.js）    │
│  PDF.js · TextLayer · 笔记    │
└──────────────┬───────────────┘
               │ 同源 HTTP
┌──────────────▼───────────────┐
│ DSH Host（index.js）          │
│  静态资源 · 翻译 · 问答 · Skill │
└──────────────┬───────────────┘
               │ ctx.llm
┌──────────────▼───────────────┐
│ 当前 profile 的模型路由        │
└──────────────────────────────┘
```

Host 路由：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/pdf-reader/api/health` | 模型与限制信息 |
| `POST` | `/pdf-reader/api/translate` | 批量段落翻译 |
| `POST` | `/pdf-reader/api/chat` | AI 文献问答 |
| `GET` | `/pdf-reader/api/skills` | 列出可用 DSH Skill |
| `POST` | `/pdf-reader/api/skill` | 读取 Skill 内容 |
| `GET` | `/pdf-reader/assets/*` | PDF.js 运行时资源 |

实现要点：

- PDF 页面先渲染 canvas，再单独提取文本，文本层失败不阻塞阅读。
- 文本重建保留 PDF 内容流顺序，并处理双栏换栏、纵向回跳、段落缩进与行间距。
- 先识别公式区域并合并上下标、上下限、分式与编号，再把剩余文本重建为段落；页面模型按
  阅读顺序输出 `blocks`（`paragraph` / `equation` / `figure`），正文段落从 `blocks` 派生，
  旧调用方（翻译、笔记、AI 上下文）继续可用。
- 图表区域来自页面操作符：位图按 CTM 换算到页面坐标，矢量路径先按邻近关系聚类，再按面积、
  二维路径数、实心度与表格细线比例筛选。聚类使用按 y 排序的扫描线，只比较可能相交的行带，
  上千个热力图单元也能在几十毫秒内完成。
- 图内文字归属在公式识别之前完成：按视觉行统计落在图内的比例，整行归属到图表；图注行
  除外（仍留在正文）。归属后的文字既不进入公式候选，也不进入段落。
- 图表 `bbox` 与公式一样存 scale-1 页面坐标；裁剪图范围单独存放，图号取自最近的图注。
  图表识别结果按文档 + 页码缓存，缩放、改宽不会重复解析操作符；命中页面模型时干脆不再调用图检。
- 公式 `bbox` 统一存放 scale-1 的 PDF 页面坐标；高亮和裁剪时通过 viewport 换算，缩放、
  侧栏改宽与重新打开文档后仍然一致。
- 公式图由独立 canvas 按显示尺寸 × DPR 渲染，并受最大像素预算约束；缓存键包含文档、
  页码、裁剪范围与渲染分辨率，手动修正后对应缓存失效。
- 行内公式使用 `⟦MATH_xxx⟧` 占位符隔离，Host 侧对返回译文做完整、重复与未知标记校验。
- PDF.js 可能把一个整句正文和尾部运算符放在同一个文本项里；提取时会按项内数学 token
  范围拆成子项，只把公式片段替换为占位符，不隐藏整句正文。扩展公式范围时会排除
  `of / is / a / the` 等停用词，只有变量形状的短 token（单字母、Greek、含数字/下划线、
  大写缩写或已知函数名）才会并入公式。
- 修改公式区域会递增翻译 epoch、取消正在执行的翻译并清理 loading 状态，避免旧请求按
  重建前的段落编号回填译文。
- 每个文档拥有独立的页面缓存（`src/cache.js`）：页面模型、文本项、图表区域和页面位图各有一份上限，
  阅读器、翻译、问答与导出读写同一份模型，缩放和侧栏改宽只重画不重解析。模型按 scale-1 规范坐标构建，
  行框、公式框与图框统一在显示时乘当前缩放。模型上限 12 页、文本 12 页、位图 3 页且另有 48 MB 字节预算，
  超出时按最近最少使用淘汰，位图淘汰时调用 `ImageBitmap.close()`；单张就超出预算的位图只在屏显示、
  不写入缓存，也不会清掉已经缓存的其它页。公式或图修正只失效该页模型与裁剪结果，
  原始文本、图检结果与页面位图仍然复用。切换文档后的旧异步任务不会写入新文档缓存。
- 回到已看过的页面不再重新光栅化：渲染任务在同一画布队列里**发起**快照，但不等快照完成就让页面就绪、
  让下一页开始绘制，快照随后异步写入缓存；再次进入该页直接 `drawImage`。缩放与像素比变化时先用旧快照当预览，
  再离屏渲染并一次贴回，避免白闪。命中模型时正文立即切换，但画布只在目标页像素真正上屏后才离开 loading 状态，
  高亮也随之出现，快速翻页不会把新页高亮叠在旧页画面上。
- 阅读时向后预取一页：当前页模型就绪、浏览器空闲后，用离屏画布把下一页渲染成快照并建立其模型，
  再下一页只预建模型。目标像素超出位图预算或浏览器不支持快照时，只做模型预取，不白画一遍。
  位图预算不足时**优先保证下一页**，更早的页会被淘汰（因此回退较远的页可能重绘）；若快照复制完成时
  用户已翻到别处，该快照会被丢弃，以免挤掉眼前要读的页。翻页、切文档、整篇翻译都会取消预取，
  预取失败只记日志，不影响当前页；预取结果同样受上述上限与最近最少使用淘汰约束。
- 打开文件带任务编号；连续打开时过期任务会被销毁，避免旧文件覆盖新文件。
- 翻译与问答请求绑定客户端断开信号，停止后会取消 Host 侧模型生成。
- 切换目标语言会中止旧请求并递增 epoch，旧结果不会回填到新语言状态。

页面模型的公式块：

```js
{
  id: 'page6-equation1',
  type: 'equation',
  pageIndex: 5,
  bbox: [x0, y0, x1, y1],        // scale-1 PDF 页面坐标，含编号与留白
  imageBbox: [x0, y0, x1, y1],   // 裁剪图范围，去掉右侧编号留白
  equationNumber: '(1)',
  sourceItemIds: [],             // PDF.js 文本项索引，便于追溯
  latex: null,                   // 第二阶段填入
  detectionSource: 'automatic'   // 或 'manual'
}
```

`blocks` 按阅读顺序混合 `paragraph` 与 `equation`；`paragraphs` 由 `blocks` 派生，
翻译、笔记和导出仍然可以只处理正文段落。

图表块：

```js
{
  id: 'page13-figure1',
  type: 'figure',
  pageIndex: 12,
  bbox: [x0, y0, x1, y1],        // 绘图区域 + 图内文字
  imageBbox: [x0, y0, x1, y1],   // 裁剪图范围（绘图区域）
  figureNumber: '3',             // 最近的图注编号，没有则为 null
  caption: 'Figure 3: ...',      // 图注文本，同时仍作为段落保留
  labels: [{ text, bbox }],      // 图内文字，按视觉行分组
  labelCount: 13,
  text: '...',                   // 图内文字拼接，供 AI 上下文与导出
  detectionSource: 'automatic'
}
```

图内文字不参与翻译；`text` 与 `labels` 只用于展示、定位和导出。

## 开发

```bash
npm install
npm run build
npm test
```

`client.js` 由 `src/` 打包生成，不要直接编辑。构建使用 esbuild，React 与 JSX runtime
由 DSH 浏览器模块表提供。

```text
index.js                 Host 插件入口：路由、模型调用、Skill、安全校验
lib/                     可独立测试的 Host 纯函数（翻译/问答/占位符校验）
src/plugin.jsx           主面板、阅读器、公式块、笔记、AI 阅读交互
src/pdf.js               PDF.js 加载、文本重建、公式裁剪、缩略图、目录
src/equations.js         公式区域识别、bbox/裁剪尺寸、手动修正合并
src/figures.js           图表区域识别（位图/矢量路径）、图内文字归属与图注
src/references.js        References 章节定位、编号条目拆分与续行合并
src/search.js            全文关键词匹配、片段生成与命中区域映射
src/reading-position.js  按文档指纹记录与恢复上次阅读页
src/zip.js               无依赖 ZIP（store）写入器
src/api.js               同源 HTTP API 客户端
src/locales.js           中英文界面文案
src/styles.js            使用 --dsw-alias-* 主题 token 的样式
assets/                  PDF.js 4.10.38、CMaps、标准字体（Apache-2.0）
tests/                   node:test 单测与固定 PDF 回归样本
tests/fixtures/          attention.pdf（Attention Is All You Need）
scripts/                 构建与 Node 侧冒烟测试
client.js                构建产物
```

测试覆盖：

- `node:test` 纯函数单测：翻译 JSON 严格解析、术语表、批次切分、问答历史与提示词。
- 占位符校验：完整、重复、未知标记、空输出回退与失败标记。
- 文章结构：Attention 首页的标题、8 位作者与单位/邮箱、摘要边界；跨行同字号标题合并；
  长摘要按完整句子分组且不切断小数点。
- 公式识别：真实 Attention PDF 的公式 (1)/(2)、分式/上下标合并、表格误判、缩放坐标一致性。
- 图表/表格识别：位图与矢量图区域、网格表格、booktabs 横线表格、彩色表头扩展、纯文字
  表格发现、图内文字按行归属、图注保留、箭头标注不进入公式列表、手动「不是图表」恢复正文。
- 手动修正：删除自动公式、重新框选并恢复原文条目、手动框选图表、调整范围并替换自动区域。
- 公式裁剪尺寸：DPR、最大像素预算与超长边裁限。
- Markdown + 图片 ZIP 的中央目录与本地区块。
- Host 路由、翻译 JSON 严格解析、Skill 读取、资源路径越界、客户端断开取消。
- 模型目录与选择：`/api/models` 返回模型和推理等级；翻译/问答请求可指定模型与推理等级，
  非法模型或等级返回明确的 400 错误。
- 参考文献：真实 Attention PDF 的 References 章节定位、40 条编号条目拆分、跨段续行合并、
  双栏左右列顺序、重复页眉、作者-年份格式，以及仅在有参考文献时显示左栏页签。
- 关键词搜索：多关键词同时命中、短语优先、大小写不敏感、行末断词与复合词连字符搜索、
  全部命中高亮、RTL 片段间距；阅读位置：文档指纹隔离、越界页忽略、旧记录按时间淘汰。
- 客户端模块加载器包装与 Slot 注册。
- 相邻文本片段拼接、双栏段落边界。

### 公式回归样本

固定样本为 `tests/fixtures/attention.pdf`（*Attention Is All You Need*，15 页）。当前启发式
在整篇样本上的自动识别结果：

| 页 | 页面内容 | 识别结果 |
|---:|---|---|
| 4 | 公式 (1) `Attention(Q,K,V)` | 1 个完整公式块，含编号 |
| 5 | `MultiHead`、`where head_i`、公式 (2) `FFN` | 3 个公式块（前两条无编号） |
| 6 | Positional Encoding 两条公式 | 2 个公式块；表 1 未被误判 |
| 7 | 学习率公式 (3) | 1 个完整公式块 |
| 8 | 表 2/3 的数值与 `·` 乘号 | 0 个公式块（表格未被误判） |
| 其余页 | 标题、正文、参考文献 | 0 个公式块 |

回归测试覆盖公式 (1)/(2) 的完整 bbox、碎片不出现在正文段落、编号正确、缩放后 bbox 不变、
表格不误判，以及手动框选/撤销/恢复。该结果只代表这一篇样本；扩展论文时仍需重新评估覆盖率。
样本来自 Vaswani et al., *Attention Is All You Need*（[arXiv:1706.03762](https://arxiv.org/abs/1706.03762)），
仅用于文本提取与公式区域回归测试。

### 图表回归样本

同一篇样本的图表识别结果：

| 页 | 页面内容 | 识别结果 |
|---:|---|---|
| 3 | Transformer 架构图（整页位图） | 1 个图表，图号 1，图内文字 0 条（文字在图中是位图） |
| 4 | Scaled Dot-Product / Multi-Head Attention 两幅结构图 | 2 个图表，均取到图号 2；两个小标题作为图内文字 |
| 6 | 表 1（纯文字表格，无绘图） | 1 个「表 1」卡片，表头与数据行整体进入裁剪，表题仍是可翻译段落 |
| 8 | 表 2（纯文字表格，跨双栏） | 1 个「表 2」卡片，13 行表格文字；表题仍是可翻译段落 |
| 13 | Attention 可视化热力图（矢量 + 沿线文字） | 1 个图表，图号 3，13 行图内文字；图注仍是可翻译段落 |
| 14 / 15 | 两个注意力头可视化 | 各 1 个图表，图号 4 / 5，图内文字各 21 行 |

回归测试覆盖图表 bbox、图号/表号、图注保留、图内文字不进入正文段落、箭头标注不进入公式列表、
表格扩展、手动框选与替换，以及「不是图表」后文字回到正文。识别阈值只在这一篇样本与合成用例上
校准，遇到少见排版仍需人工修正。

## 限制与路线图

- 当前是**阅读器内的段落对照**，不生成重排后的单语/双语 PDF；对照 HTML 可通过浏览器打印为 PDF。
- 公式第一阶段采用“区域识别 + 高清裁剪 + 占位符保护”，`latex` 字段为第二阶段预留；
  尚未接入公式识别服务，也尚未用 KaTeX 渲染。
- 行内公式与正文的边界、基线及换行仍是下一项任务；当前优先保证独立公式与占位符校验。
- 自动识别是启发式规则，需用更多论文评估覆盖率；已提供“框选公式/框选图表/调整范围/
  不是公式/不是图表/恢复自动识别”的人工修正入口。
- 表格识别会处理彩色表头、横线表格、网格表格与纯文字表格；跨页续表暂不合并，按页分别裁剪。
- 图内文字与表格单元格按参考文本保留，不逐条翻译；图注与表注仍作为正文段落翻译。
- 扫描版 PDF 没有文本层时不会自动 OCR；页面会提示无文本，表格只能用「框选图表」手动框出。
- 页面级旋转尚未实现；本轮只提供查看器内的独立旋转。双栏/多栏布局使用启发式重建，
  极端排版可能需要人工调整段落边界。
- AI 对话保存在当前文档会话内，切换文档会重置；笔记、术语表与公式修正持久化在浏览器本地。
- 路线图：接入公式识别服务 + KaTeX、BabelDOC 双语 PDF、OCR、跨会话笔记同步、多文档书架。

## 常见问题

**安装后看不到「PDF 阅读」图标？**  
刷新 Web UI，或重新打开面板。确认 `plugin_manager install_bundle` 返回 `application: applied`，
并确认插件装在当前启动的那个 profile 里（见[安装到 DSH](#安装到-dsh)）。

**翻页时显示「正在渲染页面…」？**  
这是正常的页面渲染提示，不是模型请求。模型只在翻译、AI 问答和打开面板时的 health check 中调用。

**模型不可用 / 翻译失败？**  
检查 `/pdf-reader/api/health` 返回的 `llm`、`provider`、`model`；确认当前 profile 已登录可用模型，或在配置中覆盖 `provider` / `model`。

**AI 阅读的回答为空或被截断？**

输出额度是「思考 + 正文」的总和：推理等级较高时思考会先吃掉额度，2048 / 4096 档很容易一个字都出不来。把设置里的「回答长度上限」调到 16384 以上，或降低推理等级；65,536 档适合整篇精读，等待时间会随额度自动放宽。

**扫描版 PDF 没有文本？**  
当前版本不做 OCR；页面会提示无文本。可在路线图中跟踪 OCR 支持。

**选中范围和文字对不齐？**  
插件使用 PDF.js 原生 TextLayer；极少数 PDF 的字体度量不完整时仍可能有偏差。请附上页面截图与 PDF 版本反馈。

## 致谢

- [PDFMathTranslate / PDF2ZH](https://github.com/PDFMathTranslate/PDFMathTranslate)：学术 PDF 布局与翻译理念参考。
- [PDF.js](https://github.com/mozilla/pdf.js)：PDF 渲染与文本层。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：插件运行时与 Web UI。

本项目与上述项目无隶属关系；PDFMathTranslate 的 BabelDOC 排版管线未包含在本仓库中。

## 贡献

欢迎提交 issue 和 pull request。提交前请：

1. 运行 `npm test`。
2. 如果修改了 `src/`，重新运行 `npm run build` 并提交生成的 `client.js`。
3. 在 PR 中说明测试环境、复现步骤和截图（涉及 UI 时）。
4. 不要提交个人 PDF、API Key、profile 配置或包含个人路径的日志。

## License

本插件代码采用 [MIT License](LICENSE)。PDF.js 以 Apache-2.0 分发，
许可证见 [assets/PDFJS-LICENSE](assets/PDFJS-LICENSE)。
