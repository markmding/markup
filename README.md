# Markup

本地优先、文件夹库（Vault）模式的 Markdown 知识库编辑器。产品需求见 [prd.md](./prd.md)。

> **当前阶段：M0 工程初始化 / 技术验证**
> 本文档描述的是已经落地的脚手架，不代表 v1 功能已全部完成。功能完成度见 [TASKS.md](./TASKS.md)。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Tauri v2（Rust 接管文件 IO / 监听 / 搜索） |
| 前端 | Svelte 5 + Vite 7 + TypeScript |
| 编辑器 | Milkdown Crepe（ProseMirror，AST 为唯一真值） |
| 源码视图 | CodeMirror 6 |
| 公式 / 图表 | KaTeX、Mermaid（懒加载） |
| 导出 | remark / rehype + 浏览器打印 API |

## 已实现（脚手架级）

- **Vault**：打开本地文件夹、递归文件树、新建/重命名/删除/拖拽移动、外部变更监听与刷新
- **编辑器**：WYSIWYG（Crepe）+ 源码视图切换，多标签页，Ctrl+S / Ctrl+N / Ctrl+\\ 快捷键
- **纯文本文件**：文件树可直接打开 css / js / ts / json / html / txt 等常见纯文本，始终使用 CodeMirror 源码编辑器并按扩展名高亮；编码、换行符、自动保存与冲突处理与 Markdown 共用，导出/分栏对纯文本禁用
- **自动保存**：定时 + 失焦两个独立开关，默认 30s / 开启
- **路径安全**：所有 Rust 命令限制在 Vault 内（拒绝绝对路径与 `..` 越界）
- **保存冲突**：写入前比对 mtime，外部修改返回 `CONFLICT`；编辑器上方显示非阻塞提示条，可选择「重新加载」或「覆盖保存」
- **文本编码 / 换行符**：状态栏显示并可切换 UTF-8（含 BOM）、GBK、ANSI 与 LF / CRLF；读取时自动识别，保存时安全转换（无法表示的字符会阻止写入，避免乱码）；新文件换行符跟随操作系统
- **忽略规则**：文件树与全文搜索统一遵循 `.gitignore`、`.ignore`、`.markupignore`（无需 Vault 是 Git 仓库），并内置跳过 `node_modules`、`target` 等目录
- **附件粘贴 / 拖拽**：图片自动存入 `attachments/`，Markdown 只记录相对路径；编辑器显示时经 Rust 读取并转为 data URL，无需开放文件系统 asset 协议
- **长文档优化（F2.7 阶段二）**：视口外的顶层块（段落 / 标题 / 引用 / 列表）把已渲染的 DOM 移入 DocumentFragment，只保留等高外壳；滚动到附近时按原节点恢复。选中块与视口内 ±2500px 的块始终保留，设置中可整体关闭分块渲染
- **Mermaid 渲染开关**：设置中可强制关闭 Mermaid 图表渲染，编辑器、导出预览与 HTML 中保留源码块
- **Mermaid 编辑器预览**：代码块内实时渲染（复用 Crepe 预览面板），支持编辑源码即时更新，Mermaid 仍按需懒加载
- **斜杠菜单**：Advanced 分组新增「Mermaid 图表」，插入带 `flowchart` 示例的 mermaid 代码块并立即预览
- **导出**：HTML（独立文件夹 / base64 单文件）、PDF（自建 A4 分页、整篇/页码范围、自定义页码起始值）、复制规范化 Markdown；导出前收集附件并告警
- **主题**：浅色/深色 + Vault `themes/*.css` 自定义主题；设置内切换、刷新，文件变更由监听自动重载；导出自动附带
- **模板**：读取 `templates/*.md`，新建笔记时可选择模板
- **搜索**：文件树全文搜索（tantivy 内存索引、中文 2–3 gram、按 mtime 增量同步），显示标题/路径/摘要并可跳转
- **设置**：持久化到 localStorage（自动保存、字号、外观/文档主题、Mermaid/分块开关、导出默认值）
- **Callout**：`> [!TIP]` 等标记在编辑器内渲染为提示块，Markdown 原文保持标准语法
- **分栏**：视图菜单「分栏」左右并排 WYSIWYG 与只读源码；两侧各自独立滚动，并按标题锚点双向同步（块级定位，不是字符级映射），源码随编辑自动更新
- **菜单与窗口**：文件 / 编辑 / 格式 / 视图 / 选项 / 关于 菜单，标签栏全宽置于菜单下方；应用窗口无系统标题栏，使用自绘的最小化 / 最大化 / 关闭按钮，菜单栏空白区域可拖动窗口
- **回收站**：删除文件移入 Vault 内 `.markup-trash/`，不再直接永久删除
- **浏览器演示库**：未安装 Rust 时可用 `npm run dev` 直接体验 UI

## 尚未实现 / 下一步（P0 优先）

| 需求 | 状态 |
| --- | --- |
| 长文档分块渲染（F2.7，核心门槛） | ✅ 阶段二：视口外顶层块 DOM 卸载 + 滚动按需恢复；万行文档（5001 块）打开 3.1s，4954 块处于卸载态 |
| Mermaid / KaTeX 编辑器内渲染 | ✅ Mermaid 复用代码块预览面板实时渲染（懒加载）；设置可关闭；KaTeX 由 Crepe 自带 |
| 附件粘贴 / 拖拽插入编辑器 | ✅ 存入 `attachments/`，Markdown 存相对路径，编辑器内 data URL 预览 |
| 斜杠命令中的 Mermaid 块 | ✅ 「Advanced → Mermaid 图表」插入带示例的 mermaid 代码块 |
| 文件冲突 UI（非阻塞提示条） | ✅ 编辑器上方提示条，可重新加载或覆盖保存 |
| 主题 / 模板管理面板、主题热重载 | ✅ 设置内主题选择与刷新、watcher 热重载；模板在新建对话框选择 |
| tantivy 全文索引 | ✅ 内存索引 + mtime 增量同步 + 中文 ngram，失败回退线性扫描 |
| PDF 页码范围 / 自定义起始页码 | ⚠️ UI 与参数已就绪，WebView 打印能力待 M0 验证（PRD R2） |
| 安装包 ≤12MB、签名 | ⚠️ NSIS 安装包 3.78MB 已验证；代码签名 / 自动更新未做 |

## 环境要求

- Node.js ≥ 20（当前使用 26）
- Rust stable ≥ 1.77.2（当前 1.100，MSVC target）
- Windows：**Visual Studio Build Tools（VCTools 工作负载 + Windows SDK）** + WebView2 Runtime
- macOS：Xcode Command Line Tools

> 本机已具备完整构建环境：Rust 1.100 + VS Build Tools 2022（MSVC 14.44 / Windows SDK 10.0.26100），可完成 release 编译与 NSIS 打包。

### 构建验证记录（2026-11-21）

| 项目 | 结果 |
| --- | --- |
| `cargo -V` / `rustc -V` | 1.100.0 / MSVC target ✅ |
| 依赖解析与下载 | 444 个包，经 rsproxy 镜像完成 ✅（`Cargo.lock` 已生成） |
| `cargo check` | ✅ 0 error / 0 warning（2m48s） |
| `npm run tauri build` | ✅ release 编译 + NSIS 打包成功 |
| 可执行文件 | `src-tauri/target/release/markup.exe` — **5.9MB** |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/Markup_0.1.0_x64-setup.exe` — **3.78MB**（目标 ≤12MB ✅） |
| 启动冒烟测试 | ✅ 窗口标题 `Markup`，进程正常运行 |
| 冷启动（窗口出现） | ✅ 0.20s（编辑器完全就绪未单独计时） |
| 前端验证 | `svelte-check` 0 错误、`vite build` 通过 ✅ |

> 首次构建曾因直连 GitHub 下载 NSIS 超时失败。若复现，可走镜像：
>
> ```powershell
> $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR="https://gh-proxy.com/https://github.com"
> npm run tauri -- build --bundles nsis
> ```
>
> `src-tauri/.cargo/config.toml` 已配置 rsproxy 稀疏镜像；如需恢复官方源，删除该文件即可。

## 快速开始

```bash
npm install

# 纯浏览器模式（使用内置示例库，不需要 Rust）
npm run dev            # http://localhost:1420

# 桌面模式（需要 Rust）
npm run tauri dev      # 等价于 npm run desktop
```

其他脚本：

```bash
npm run check          # svelte-check 类型检查
npm run build          # 构建前端到 dist/
npm run tauri build    # 打桌面安装包
npm run icons          # 重新生成占位图标（替换品牌图标后可用 npx tauri icon）
```

## 开发工作流（何时需要编译 Rust）

| 改动范围 | 推荐方式 | 是否重编译 Rust |
| --- | --- | --- |
| Svelte / CSS / 导出逻辑等纯前端 | `npm run dev` → 浏览器预览（内置示例库） | 否，Vite 热更新 |
| 前端 + 真实文件系统行为 | `npm run tauri dev` | 仅首次或改了 Rust 时；debug 增量编译 |
| `src-tauri` 下的 Rust 代码 | `cargo check`（快速）→ `npm run tauri dev` | 是，增量 |
| 需要交付安装包 / 发布 | `npm run tauri -- build --bundles nsis` | 是，release 编译 + 打包 |

> 日常开发优先用浏览器预览：`npm run dev` 启动后修改前端代码会即时热更新，不需要重新编译 Rust、也不需要重新打包。
> 只有需要验证真实 Vault 读写、文件监听、编码转换等 Rust 行为时，才启动 `npm run tauri dev`。

## 目录结构

```
markup/
├─ prd.md                     # 产品需求（唯一需求源）
├─ TASKS.md                   # 按 PRD 拆解的任务与完成度
├─ docs/
│  └─ ipc.md                  # 前端 ↔ Rust 命令契约
├─ src/
│  ├─ App.svelte              # 应用外壳：布局、快捷键、自动保存、监听
│  ├─ app.css                 # 设计变量 + 布局 + 对话框样式
│  └─ lib/
│     ├─ api/                 # Tauri invoke 封装 + 浏览器演示库
│     ├─ components/          # 侧边栏、标签页、编辑器、设置、导出
│     ├─ export/              # Markdown → HTML/PDF、主题 CSS、附件收集
│     ├─ stores/              # vault / tabs / settings（Svelte 5 runes）
│     ├─ filetree.ts          # 文件树展开与过滤
│     ├─ paths.ts             # Vault 相对路径工具
│     └─ types.ts             # 与 Rust 对齐的数据结构
├─ src-tauri/
│  ├─ src/commands/           # vault / export / search / watcher 命令
│  ├─ src/paths.rs            # 路径规范化与越界校验
│  ├─ capabilities/           # Tauri 权限
│  └─ tauri.conf.json
└─ tools/gen-icons.mjs        # 无依赖生成 PNG/ICO/ICNS 占位图标
```

## 仓库与本地文件

### 提交到私有 Git

- 源码：`src/`、`src-tauri/src/`、`tools/`
- 配置：`package.json`、`package-lock.json`、`Cargo.toml`、`Cargo.lock`、`tauri.conf.json`、`capabilities/`、`vite.config.ts`、`tsconfig.json`、`svelte.config.js`
- 文档：`prd.md`、`README.md`、`TASKS.md`、`docs/`
- 资源：`src-tauri/icons/`

### 本地开发文件（不提交）

| 路径 | 说明 | 当前状态 |
| --- | --- | --- |
| `node_modules/` | npm 依赖（约 310MB） | 保留，供本地预览；可用 `npm ci` 重建 |
| `dist/` | 前端构建输出 | 已清理，构建时自动生成 |
| `src-tauri/target/` | Rust 编译缓存（清理前约 3.8GB） | 已清理，首次构建会重建 |
| `src-tauri/gen/schemas/` | Tauri 生成的权限 schema | 已清理，构建时自动生成 |
| `*.log` | 本地日志 | 已加入 `.gitignore` |
| `src-tauri/.cargo/config.toml` | rsproxy 镜像配置（国内构建加速） | 已提交；不需要时可删除以恢复官方源 |

### 构建产物（仓库外）

安装包与便携版已从 `src-tauri/target` 移出，避免再次进入源码目录：

- `D:\AIDEV\markup-artifacts\Markup_0.1.0_x64-setup.exe`
- `D:\AIDEV\markup-artifacts\Markup_0.1.0_portable.exe`

### 源码包

- `D:\AIDEV\markup-source-2026-11-21.zip`（不含 `.git`、`node_modules`、构建产物）

上传私有仓库：

```bash
git add .
git commit -m "chore: initial Markup scaffold"
git remote add origin <your-private-repo-url>
git push -u origin main
```

## 关键设计约定

1. **AST 是唯一真值**：编辑器内存模型是 ProseMirror Doc；Markdown 仅用于持久化与导出。保存走「AST → 规范化 Markdown」，不做原文增量 patch。
2. **Rust 负责一切磁盘操作**：前端不直接使用 fs 插件；附件、导出、搜索、监听都经命令层，并在 Rust 侧做路径越界校验。
3. **Vault 目录固定**：`attachments/`、`themes/`、`templates/` 打开时自动创建；附件路径不可自定义。
4. **导出与预览同源**：导出对话框中的预览与最终导出使用同一套 `buildHtmlExport` 与主题 CSS，避免“预览好看、导出走样”。
5. **重活懒加载**：Mermaid、源码视图（CodeMirror）、导出面板（remark/rehype）均按需动态导入。
6. **文本格式安全**：读取自动识别 UTF-8 / GBK / ANSI，编辑器内存统一 LF；保存时按用户选择的编码与换行写回。GBK / ANSI 无法表示的字符直接拒绝保存，绝不写入替代字符。

## 已知限制

- 浏览器演示模式下，文件夹导出会退化为逐个下载文件，附件相对路径无法保持；真实导出请使用桌面端。
- PDF 使用前端 A4 分页（按块测量），支持整篇 / 页码区间 / 页码起始值。块被视为不可拆分单元，超过一页的单个块会被裁切；最终分页仍会经过系统打印对话框，需在 WebView2 / WKWebView 上做视觉回归。
- 长文档分块渲染会卸载视口外顶层块的 DOM：这些块暂时无法被浏览器「页内查找」命中，滚动回视口后恢复。代码块、表格、图片等专用块仍全部挂载。仅在桌面 WebView2 上做了功能验证，滚动/输入延迟的正式指标需在目标机器上复测。
- 分栏滚动同步是块级（按标题锚点插值），不是字符级映射：标题之间因块高不同可能有几十像素误差；没有标题的文档退化为按滚动比例同步。
- 纯文本编辑覆盖常见文本扩展名与 Dockerfile / LICENSE 等无扩展名文件；其他类型（图片、PDF、压缩包等）会被拒绝打开，避免二进制内容被当作文本写回。
- 无边框窗口不提供 Windows 11 悬停最大化按钮的 Snap Layout 面板；仍可通过拖动窗口到屏幕边缘分屏，或使用自绘最大化按钮。
- Mermaid 在编辑器代码块、导出预览与导出 HTML 中渲染；设置里提供「渲染 Mermaid 图表」总开关，关闭后都保留源码块。Mermaid 渲染采用串行队列 + 内容缓存，避免多图并发导致卡顿。
- 自定义主题 CSS 会注入页面并作用于 `.milkdown .ProseMirror` 与导出的 `.markup-doc`；主题应只针对这两处写选择器，避免影响应用外壳。主题热重载依赖 Rust 文件监听，浏览器演示库需手动「刷新主题」。
- tantivy 索引保存在内存中，重启后首次搜索会重建；索引同步发生在搜索请求时（按 mtime 增量），不是独立后台线程。
