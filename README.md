# ReadBook 英文阅读站

以「英文阅读器」为核心的个人网站：注册 / 登录后导入英文文章 → 点词查中文释义并发音 → 生词自动进生词本。长文会自动分页、识别章节，记住每篇读到第几页，还能给任意段落记笔记。所有数据（文章、生词本、译文缓存、阅读进度、笔记）按账号隔离保存在服务器，换设备登录同一账号即可继续。技术栈为 Astro + 轻量 Node 后端，单进程跑在一台小服务器上即可。

站内还有一套**独立的中文阅读**：导入中文文章后在 `/zh` 列表里纯阅读（分页、翻页、改标题、删除），不点词、不翻译、不进生词本，与英文阅读的数据和页面互不干扰。

此外还有一个**独立的日记栏目**：`/diary`，按日期倒序记录，纯文本、可编辑可删除，只有本人可见；与阅读、生词本的数据完全分开。

> 以下命令均在 **PowerShell**（Windows 10 开始菜单搜 "PowerShell"）中、于项目根目录执行。
> 需要 Node.js **22.13 或更高版本**（内置 `node:sqlite`；本次验证使用 Node 22.22.2）。版本要求也写在 `.nvmrc` 与 `package.json` 的 `engines` 里，用 nvm / fnm 的人 `nvm use` 即可。

---

## 一、安装

```powershell
cd E:\Desktop\DeepSeekHarness\ReadBook
npm ci
```

`npm ci` 严格按 `package-lock.json` 安装，版本与构建机、Docker 镜像完全一致；`npm install` 会按 `^` 范围升级次版本，适合你要主动升级依赖时用。

安装完成后直接运行 `npm run dev` 即可，其余初始化会自动完成（生成约 3 万词的本地词库 `data/dict.db`、生成 `.env`），无需手工准备数据。

> **依赖管理就是 npm + `package-lock.json`，不引入 uv。**
> 本项目没有 Python 依赖：`scripts/` 下三个脚本都是 Node ESM（`prepare.mjs` / `build-dict.mjs` / `fetch-ecdict.mjs`），测试也是 `node --test` 跑的 `.mjs`。
> `uv` 是 Python 的包管理器，接进来没有可管理的东西，只会多一层没人用的壳。Docker 构建同样用 `npm ci`（见 `Dockerfile` 的 deps / build 阶段），两端一致。

第一次打开网站会跳到登录页：点「创建第一个账号（站长）」注册，第一个账号会接管本机已有的示例文章；之后每个新注册的账号都会自动获得两篇欢迎示例文章（一篇英文、一篇中文），用来验证两套阅读都正常。

## 二、开发预览

```powershell
npm run dev
```

浏览器打开 **http://127.0.0.1:4321** ，注册或登录后进入。改代码会自动热更新，`Ctrl + C` 停止。

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm ci` | 按 `package-lock.json` 精确安装依赖（一次即可；只有要主动升级依赖时才用 `npm install`） |
| `npm run dev` | 开发模式，带热更新，监听 `http://127.0.0.1:4321` |
| `npm run build` | 构建生产产物到 `dist/` |
| `npm run start` | 以生产模式启动（先自动 `prepare`，再跑 `dist/server/entry.mjs`），同样监听 `http://127.0.0.1:4321` |
| `npm run preview` | 与 `npm run start` 相同（方便记忆） |
| `npm run check` | Astro / TypeScript 类型检查 |
| `npm test` | 单元测试 + 端到端测试（会自动启动临时服务，不影响本地 `data/`；结果应为 100 条全通过） |
| `npm run dict:rebuild` | 重建本地词库 `data/dict.db`（已有 ECDICT 数据源时不再下载） |
| `npm run dict:fetch` | 下载 ECDICT 并生成 30000 词词库（约 63MB 下载） |

端口被占用时，用环境变量临时换端口：

```powershell
$env:PORT = "4322"; npm run dev
```

## 三、构建产物在哪、怎么本地打开

```powershell
npm run build
npm run start
```

- 构建产物目录：**`dist/`**
  - `dist/client/` —— 静态资源（CSS、前端 JS、图标）
  - `dist/server/entry.mjs` —— Node 服务入口，由 `npm run start` 执行
- 本地打开方式：`npm run start` 后浏览器访问 **http://127.0.0.1:4321**，注册或登录后使用。
  这是一个 Node 常驻服务端 + 服务端渲染的站点，**不能直接双击 `dist/index.html` 打开**，必须通过 `npm run start`（或 `npm run dev`）启动。
- 运行时数据都在 **`data/`**，按账号分开存放，备份或迁移时复制整个 `data/` 目录即可：
  ```
  data/users.json                       账号表（密码为 scrypt 加盐哈希）
  data/users/<用户id>/articles/*.json   该用户的文章
  data/users/<用户id>/index.json        该用户的文章索引
  data/users/<用户id>/vocabulary.json   该用户的生词本（含分组）
  data/users/<用户id>/translations/     该用户的全文翻译缓存
  data/users/<用户id>/settings.json     该用户的翻译设置（仅自己改过才存在）
  data/users/<用户id>/progress.json     该用户的阅读进度（没读过任何文章则不存在）
  data/users/<用户id>/notes.json        该用户的笔记（没记过笔记则不存在）
  data/users/<用户id>/diary.json        该用户的日记（没写过日记则不存在）
  data/dict.db                          公共词库（约 3 万词，所有用户共用）
  ```
- 换设备：在新设备打开站点、用同一用户名密码登录即可，文章与生词本自动同步，无需导入导出。

---

## 说明（不在三段之内，供参考）

- **账号体系**：用户名 + 密码登录，密码用 scrypt 加盐哈希存储；会话是 HMAC 签名的 HttpOnly Cookie（默认 30 天）。改密码后其他设备的旧会话立即失效。顶栏右侧头像菜单可「修改密码 / 退出登录」。自助注册开关与账号数量上限在 `src/config/site.ts` 的 `auth` 里。
- **管理员**：凭据由 `.env`（本机运行）或环境变量（Docker）里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 控制（默认 `admin` / `admin`）。用管理员账号登录后，顶栏出现「账号管理」（或直接访问 `/admin`），可以：
  - 查看全部账号（角色、文章数、生词数、注册时间、最近登录）与全站统计
  - 新建账号（密码留空自动生成，创建后弹窗显示一次）
  - 重置普通用户密码（自动生成新密码并显示，对方旧会话失效）
  - 删除账号（连同该用户的文章、生词本、翻译缓存一起删除）
  - 修改管理员密码后**无需重启进程**，下一次请求即生效，旧密码立即失效。本机改项目根 `.env`；Docker 部署改 `.env` 或设环境变量后执行 `docker compose up -d`（compose 会读 `.env` 做变量替换，但值只在创建容器时注入，`restart` 不生效）。管理员密码不能在页面里改（页面会提示改配置）。
  - 若 `ADMIN_PASSWORD` 仍是默认的 `admin`，`/admin` 页顶部会显示红色告警提醒你修改。
  - 兜底：若用户表里还没有管理员账号，系统会在第一次登录 / 访问时按配置自动创建；启动时若发现历史遗留的重名管理员记录，会自动改名为 `<用户名>_dupN` 并降为普通用户。
  - 若把 `ADMIN_USERNAME` 设为空，站点不启用配置的管理员，此时**第一个注册的人自动成为站长**，避免出现「永远进不了 /admin」的死局。
- **数据隔离**：每个用户的文章、生词本、翻译缓存都存放在 `data/users/<用户id>/` 下，接口一律以当前登录用户为准，无法通过 URL 读取别人的文章。
- **首次使用**：第一个注册的账号会自动接管本机原有数据；每个新账号会得到一篇欢迎示例文章。浏览器里旧版（localStorage）生词本会在首次登录后自动合并进账号，然后从浏览器删除。管理员账号会在首次登录时按配置自动创建。
- **并发安全**：用户表的「读 → 改 → 写回」全部串行执行，多个请求同时首次登录或同名并发注册不会再产生重复记录。
- **改内容只需改一个文件**：`src/config/site.ts`（站点名、导航、社交链接、关于我、容量限制、是否点词自动进生词本、账号规则、全文翻译服务商等）；配色主题在 `src/config/themes.ts`。
- **生词本按分组隔离**：每篇文章的生词只属于该文章；顶栏「生词本」可按分组标签切换。阅读页点词浮层里可以「加入本篇生词」，也可以新建自建分组（下拉/标签点击加入）；生词本页支持分组改名 / 删除 / 移动词条。导出 JSON 含分组结构，导入时可选合并或替换。
- **中文阅读（与英文阅读分开）**：顶栏「中文阅读」→ `/zh`，只列中文文章；英文文章在首页 `/`，两边列表互不混入。导入时在「语言」里选「中文阅读」，文章会记下 `lang: "zh"`（存在同一份 `data/users/<用户id>/articles/*.json` 里，不新增目录，老文章没有该字段一律按英文处理，无需迁移）。
  - 中文阅读页是**纯阅读**：正文不渲染可点击单词，没有「全文翻译」工具栏，没有「本文生词」侧栏，也不会写入生词本；保留分页、翻页 / 跳页、键盘左右键、改标题、删除。
  - 字数统计按**字**（汉字数）而不是词；分页按 `siteConfig.zhReader.charsPerPage`（默认 1200 字/页，英文是 3000 字符/页）。
  - 中文段落合并行时不插空格，避免粘贴的换行变成段内空格。
  - 中文文章同样计入账号容量（单篇 1MB、账号 2GB），删除时一并清理它的翻译缓存目录（虽然不会产生）。
- **本地词库约 3 万词**：`data/dict.db` 由 ECDICT 按词频截取前 30000 个常用词生成（含音标与中文释义，约 5.8MB），运行时只做索引点查、不整体载入内存。需要调整词数：
  ```powershell
  npm run dict:fetch                            # 下载 ECDICT（约 63MB，缓存到 data/ecdict.csv）并生成 30000 词
  node scripts\fetch-ecdict.mjs --limit=60000   # 换成 6 万词
  npm run dict:rebuild                          # 已有 data/ecdict.csv 时只重新生成，不再下载
  ```
  完全离线时也可以用内置的约 460 词词表兜底（删除 `data/dict.db` 后启动会自动重建基础词库）。
- **背景配色**：顶栏色块可切换 **白天 / 黑夜 / 护眼（豆沙绿）/ 暖黄（纸张）/ 高对比** 五种主题，首帧生效、刷新不闪白；选择保存在本机浏览器（这是唯一保存在本地的偏好，不影响数据）。
- **章节目录与续读**：阅读页会自动识别章节——markdown 标题（`# 标题`），以及正文里的 `Chapter 1` / `CHAPTER IV` / `Part II` / `Book 3` / `Prologue` / `第1章` / `第十二回` / `楔子` 这类**显式标记**。识别结果只做渲染层展示：顶部「目录」折叠面板（带当前章节与每章页码）、章节标题加粗。它**不参与分页**，所以页码、旧书签和翻译缓存都不受影响，老文章也不用迁移（直接在已保存的 blocks 上识别）。刻意不把「全大写短行」当章节，否则书籍扉页的 `THE OLD MAN` / `THE SEA` 会被拆成一堆假章节。
  - 阅读进度按账号存在 `data/users/<用户id>/progress.json`，每翻一页记录一次（同一页重复打开不重复写）。地址里没带 `?page` 时自动跳到上次读到的页；`?page=1`（或页面左上角「从头开始」按钮）表示从头重读。
  - 两个列表页的卡片会显示「读到 N/M 页」和进度条，点卡片直接回到上次那页；删除文章时一并清理它的进度记录。
  - 开关在 `src/config/site.ts` 的 `reader`：`chapters`（目录）、`rememberProgress`（记录进度）、`autoResume`（自动跳转，关掉后只在列表显示进度）、`chapterTitleMaxLen`（章节标题长度上限，默认 80，超过视为正文）、`notes`（段落笔记，见下条）。
- **段落笔记（中英文阅读都支持）**：正文每段右侧悬停出现一个 ✎（触屏设备常驻半透明），点它给这一段写笔记；记过的段落左侧有强调色竖线，阅读页顶部「本文笔记」面板按正文顺序列出全部笔记，点「第 N 页」跳到对应段落（`?page=N#block-K`）。两个列表页的卡片会在进度徽章后面显示「✎ N 条笔记」，没有笔记的文章不显示。
  - 笔记锚定的是**分页的全局块序号**，不是页码，所以翻页、改 `pagination.charsPerPage` 都不会让笔记错位；每条笔记另存一段原文片段，原文对不上时面板显示「原文已变动」且不跳转，不会静默定位到错误的段落。
  - 存储：`data/users/<用户id>/notes.json`，按账号隔离、换设备登录即生效；文件不存在视为没有笔记，老账号无需迁移。删文章时一并清空该篇笔记。
  - 限额在 `site.ts` 的 `limits`：`maxNotesPerArticle`（单篇最多 500 条）、`maxNoteChars`（单条最多 2000 字，超出截断）。
- **日记（独立栏目）**：顶栏「日记」→ `/diary`。顶部写作区选日期、填标题（可留空）与正文，保存后按日期倒序排；每条可编辑（内容回填到顶部表单，按钮变「保存修改」，可取消）或删除（走应用内确认框）。
  - 日期由**浏览器本地时间**生成，服务端只校验 `YYYY-MM-DD` 格式与日期是否真实存在。这样容器跑在 UTC 时，晚上 8 点后写的日记不会记成前一天。
  - 纯文本：正文按输入时的换行原样显示，不渲染 Markdown，不支持图片或附件。
  - 存储：`data/users/<用户id>/diary.json`，按账号隔离、只有本人可见；文件不存在视为没有日记，老账号无需迁移。
  - 限额在 `site.ts` 的 `diary`：`maxEntries`（最多 1000 篇）、`maxEntryChars`（单篇 20000 字）、`maxTitleChars`（标题 80 字）。
- **长文分页**：阅读页按内容自动分页（默认每页约 3000 字符，整本书不会再挤在一页）。页码用 `?page=N` 表示，可收藏、可分享、浏览器前进后退都正常；顶部有页码列表，右侧「跳至 __ / 总页数」输入页码后回车（或点「跳转」）直接跳到该页，是原生表单、没有 JS 也能用；底部有上一页 / 下一页；电脑上支持键盘 `←` `→` 翻页（光标在页码输入框里时不会误翻页）。超长段落会在句子边界拆开，不会把一段劈成两半，也不会丢内容。每页字符数在 `src/config/site.ts` 的 `pagination.charsPerPage` 里调整。全文翻译按页请求与缓存，「本文生词」侧栏优先显示本页出现的词。
- **全文翻译**：阅读页右上角「全文翻译」。默认使用 **腾讯交互翻译**（免密钥、国内直连、支持批量、质量好）；可切换 MyMemory（免费但有每日额度，长文易触发 429）或自定义接口。
  - **四种显示方式**（选择会记住，翻页不重置）：**两栏对照**（默认，左英文右中文）／上下对照／只看译文／只看原文。两栏模式下每段是一个「行带」：同一段的英文与中文**首行严格落在同一条水平线上**，段与段之间的分界线也对齐；两列字号、字体一致（0.92em / 行高 1.75），中文不会挤在一起。手机宽度（≤760px）下每段改为英文在上、中文在下的段内成组排布。若某段英文行数多于中文，该段中文下方会自然留白——这是「按段对齐」的必然结果。
  - **遮挡译文**（先读原文再看中文）：工具栏「遮挡译文」把中文模糊掉，点某一段才显示该段，再点「取消遮挡」全部显示。开关按浏览器记住，**翻页、刷新都保持**（刷新时首帧就已是遮挡状态，不会先闪一下译文）。遮挡只做模糊、不改变段落高度，所以两栏对照的行带对齐不受影响；「只看原文」模式下按钮无视觉变化（译文本来就隐藏）。刷新后已点开的段落会重新遮住，这是刻意的。
  - **批量预翻译**：点一次「全文翻译」会翻译 **当前页 + 后续 4 页**（共 5 页）；往后读到第 3 页时**自动续翻后面一批**，基本做到"翻到哪、译到哪"且不用等待。
  - **自动重试**：翻译服务偶发的 `busy` / 429 / 网络错误会自动重试（最多 4 次、指数退避），对用户透明；重试后仍失败的段落不会被缓存，下次会补齐。
  - 译文按「段」增量保存在账号里（`data/users/<用户id>/translations/`），**翻页、刷新、重新进入都不会丢**，服务端直接把已缓存的译文渲染进页面。纯数字、页码等无需翻译的段落自动跳过。
  - 相关配置（`site.ts` 的 `translation`）：`prefetchPages`（一次翻译几页，默认 5）、`prefetchTriggerPage`（读到第几页触发续批，默认 3）、`concurrency`（并发批次数，默认 2）、`retry`（重试策略）。
  - 换服务（全站默认）：`.env` 设置 `ONLINE_TRANSLATE_URL`（含 `{q}`、`{to}` 占位），再把 `site.ts` 的 `translation.provider` 改为 `'custom'`。
  - **每个账号可以自己换引擎**：顶栏头像菜单 →「翻译设置」（或直接访问 `/settings`）。默认「站点默认（免费腾讯翻译）」，可改成「个人接口」并填自己的接口地址与 API Key。设置只对当前账号生效，存在 `data/users/<用户id>/settings.json`，换设备登录即生效；密钥只以掩码（如 `••••3456`）回传，不会明文显示。切换引擎后，旧引擎翻译过的段落会重新翻译一遍（译文缓存按服务商区分）。站长可在 `site.ts` 把 `translation.userConfigurable` 设为 `false`，关掉这个入口并让所有人跟随站点默认。
  - 个人接口的地址用 `{q}` 表示原文、`{to}` 表示目标语言、`{key}` 表示密钥；地址里没写 `{key}` 时，密钥会放在 `Authorization: Bearer` 请求头里。返回体含 `translation` / `translatedText` / `data.translation` 任一字段即可。
- **安全**：口令式共享访问已移除；所有写请求做同源校验（CSRF），未登录访问页面跳登录页、访问接口返回 401，普通用户访问管理接口返回 403，文章 id 经过路径安全校验。反向代理上 HTTPS 时把 `.env` 的 `COOKIE_SECURE` 改为 `1`（Docker 用环境变量），并把 `SESSION_SECRET` 换成随机长字符串。容器以非 root 用户 `app` 运行。
- **文档索引**：完整部署、备份、HTTPS、故障排查见 **[部署手册.md](部署手册.md)**；最近一轮全面测试的结论与数据见 **[测试报告.md](测试报告.md)**。

---

## 四、Docker 部署

Dockerfile 是多阶段构建：`deps`（生产依赖）→ `build`（生成 `dist/`）→ `dict`（生成约 3 万词的 `data/dict.db`）→ `runtime`（Node 22 slim + 非 root 用户 + 健康检查）。两个装依赖的阶段都用 `npm ci`，与本地安装方式一致，版本由 `package-lock.json` 锁定；`.dockerignore` 已排除 `node_modules`、`dist`、`.env`、`data/users` 等，构建上下文不会带上本机数据与密钥。

### 前置条件（先确认这三件事）

```powershell
docker version          # 要能看到 Server 段；只有 Client 段说明引擎没起来
docker compose version  # 需要 v2（命令是 docker compose，不是老的 docker-compose）
```

1. **Docker Desktop 的引擎必须在运行**（Windows 走 WSL2 后端）。只装了 CLI、引擎没起来时，`docker compose up` 会报
   `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`。
   先手动打开 Docker Desktop，等状态变成 "Engine running" 再执行下面的命令。
2. **本机最好有 `data/ecdict.csv`（约 63MB）**：构建时优先用它生成词库，避免在构建阶段联网下载；没有则 `Dockerfile` 会尝试联网拉 ECDICT，仍失败才退回内置 460 词小词表。
3. **宿主机的 4321 端口要空着**：容器映射的就是 4321，先停掉本机的 `npm run start` / `npm run dev`。

### 方式一：docker compose（推荐）

```powershell
cd E:\Desktop\DeepSeekHarness\ReadBook

# 设置关键变量（不设置则用默认值：admin/admin，强烈建议改掉）
$env:SESSION_SECRET = "请换成随机长字符串"
$env:ADMIN_PASSWORD = "你的管理员密码"

docker compose up -d --build
docker compose ps
```

`docker compose ps` 的 STATUS 应为 **`Up ... (healthy)`**。首次启动有 15s 的 `start_period`，这期间显示 `health: starting` 属正常。探针打的是免登录的 `/api/health`，也可以手动验：

```powershell
curl http://127.0.0.1:4321/api/health
# {"ok":true,"time":"...","node":"v22.x","dict":{"ready":true,"words":30001,"source":"ecdict"}}
```

浏览器打开 **http://localhost:4321**，用上面的管理员账号登录。停止 / 更新：

```powershell
docker compose logs -f                  # 看日志
docker compose restart                  # 重启（数据保留）
docker compose up -d --build            # 更新到最新代码（重新构建）
docker compose down                     # 停止（保留数据卷）
docker compose down -v                  # 停止并删除数据卷（会清空所有账号与文章！）
```

数据保存在命名卷 **`readbook_readbook-data`** 中（容器内 `/app/data`），**重建容器不会丢数据**。

> **环境变量只在创建容器时生效**：改了 `ADMIN_PASSWORD` / `SESSION_SECRET` 后，
> `docker compose up -d` 会重建容器并应用新值；已经在运行的容器执行 `restart` **不会**更新环境变量。
> 另外，compose v2 **会自动读取项目根的 `.env`** 做 `${VAR}` 替换，所以本机 `.env` 里的 `ADMIN_PASSWORD` 对容器同样生效；`.env` 本身不会进镜像（`.dockerignore` 已排除），容器内靠 `environment:` 注入。优先级：**shell 环境变量 > `.env` > compose 里的默认值**。
> 部署后请打开 `/admin`：如果看到红色「管理员密码仍为默认的 admin」告警，说明还没设强密码。

完整部署、备份、HTTPS、故障排查与上线检查清单见 **[部署手册.md](部署手册.md)**。

### 方式二：docker run

```powershell
docker build -t readbook .
docker run -d --name readbook -p 4321:4321 `
  -e SESSION_SECRET="请换成随机长字符串" `
  -e ADMIN_PASSWORD="你的管理员密码" `
  -v readbook-data:/app/data `
  readbook
docker ps
```

### 构建时可调参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--build-arg DICT_LIMIT=60000` | `30000` | 镜像内词库词数（越大镜像越大） |
| 本地是否存在 `data/ecdict.csv` | 无 | 存在则直接用它生成词库（推荐，离线可构建）；不存在则尝试联网下载 ECDICT；都失败时退回内置 460 词 |

### 部署注意

- **环境变量优先于 `.env`**：用 `-e` / compose `environment` 设置的 `ADMIN_PASSWORD`、`SESSION_SECRET` 会覆盖配置文件；镜像内不包含 `.env`。
- 容器以非 root 用户 `app` 运行，实测常驻内存 **33–59MB**（`docker stats`，取决于是否刚读过长文），compose 里限制了 `mem_limit: 1g`，适合 2 核 2G 小服务器。镜像体积约 **799MB**（`readbook:latest`，2026-11-05 实测）。
- 镜像内自带健康检查（`/api/health`），`docker ps` 里状态应显示 `healthy`。
- 换机器迁移：把 `docker volume` 里的数据复制过去，或用 `docker run --rm -v readbook_readbook-data:/data -v ${PWD}:/backup alpine tar czf /backup/readbook-data.tgz -C /data .` 备份。

### 代码结构（本轮已拆分）

```
src/lib/                服务端
  auth.ts               账号、scrypt 密码哈希、注册/登录/改密、管理员操作、用户表并发锁与重复管理员清理
  auth-guard.ts         当前用户、会话 Cookie 读写、API 401/403
  admin-stats.ts        管理员账号总览与全站统计
  session.ts            签名会话 token（带用户 id 与版本）
  articles.ts           按用户存储文章、配额、旧数据认领
  vocab-server.ts       按用户存储生词本（分组模型、导入去重）
  translate.ts          分段翻译 + 按用户缓存（站点默认 / 账号自选两种来源）
  translate-settings.ts 账号级翻译设置读写（data/users/<id>/settings.json）
  chapters.ts           章节自动识别（从分页块里认章节、映射到页码、定位当前章节）
  progress.ts           按账号记录阅读进度（data/users/<id>/progress.json）
  notes.ts              按账号存储段落笔记（data/users/<id>/notes.json）
  diary.ts              按账号存储日记（data/users/<id>/diary.json，按日期倒序）
  paginate.ts           长文分页（按块切页、超长段落按句拆分）
  seed.ts               新用户欢迎文章
  load-env.ts           读取项目根 .env（测试可用 DSH_TEST_NO_ENV=1 跳过）
  paths.ts / env.ts / text.ts / dict.ts / reader-html.ts
src/scripts/client/     浏览器端
  reader.ts             阅读页入口（只负责事件与流程）
  reader/popover.ts     释义浮层
  reader/panel.ts       生词高亮与本文生词侧栏
  reader/lookup.ts      查词请求缓存
  reader/pager.ts       键盘翻页
  reader/notes.ts       段落笔记的新建 / 编辑 / 删除
  reader/html.ts        转义等小工具
  vocabulary-page.ts    生词本页逻辑
  diary-page.ts         日记页的新增 / 编辑 / 删除
  admin-page.ts         管理员页逻辑
  vocab-store.ts        生词本数据层（服务端同步 + 旧数据迁移）
  dialog.ts             应用内弹窗（askText 支持自定义空值提示）
  theme / translate / speech / account-menu
src/pages/              login / register / admin / index（英文列表）/ zh（中文列表）/ diary（日记）/ import / read/[id] / vocabulary / settings / about
src/pages/api/          auth/*, admin/accounts, articles, vocabulary(+import), translate, settings, notes, diary, lookup, health
```

### 后续 TODO

1. 在线词典兜底：在 `.env` 配置 `ONLINE_DICT_URL`（含 `{word}` 占位），未收录词自动走在线接口。
2. 发音音源兜底：目前只用浏览器 Web Speech API（Windows 自带语音可用）。
3. 文章分页 / 搜索：文章数量变大后给首页加搜索与分页。
4. 阅读进度与「已掌握」的复习提醒（需求明确本轮不做遗忘曲线）。
5. 备份策略：`data/` 目录定时打包（含 `users.json` 与各用户目录），Docker 用命名卷备份，步骤见部署手册。
6. 图片：`public/` 下放图即可；缺失时自动回退到 `/placeholder.svg`，头像缺失回退为首字母。
7. 翻译质量增强：MyMemory 为免费众包记忆库，长文可出现机翻腔；可接入 DeepL / 百度 / 腾讯正式 API。
8. 账号管理增强：目前没有邀请码、管理员账号不能被删除、也没有「停用账号」状态，可按需补。
9. 词库扩充：前 3 万词已覆盖日常阅读，专业术语可按需提高 `--limit`。
10. 两栏对照的「逐行对齐」：当前保证每段首行与段边界对齐，若英文段行数多于中文会自然留白；如需要逐行严格对应，要改译文行数策略。

### 变更记录

| 日期 | 改了什么 | 为什么 |
|---|---|---|
| 2026-11-05 | 把「日记」版本重新构建并部署到容器：`docker compose up -d --build` 34s 通过、镜像 `readbook:latest` 799MB、容器 `Up (healthy)`、`/api/health` 返回 `dict.words=30001`；命名卷 `readbook_readbook-data` 旧数据完好（1 个账号，零迁移）；容器内实测注册临时账号 → 新增日记 → `/diary` 200（「共 1 篇」「周四」「容器内验证」均正确）→ `diary.json` 以 `app` 用户落盘 → 删账号后目录清理干净；空闲内存 57MB | 日记功能需要上线到容器环境，并确认非 root 用户 + 命名卷下新增的 `diary.json` 能正常读写、删账号能连带清理 |
| 2026-11-05 | 新增「日记」独立栏目：`/diary` 顶部写作区（日期 + 可选标题 + 正文）按日期倒序列出，每条可编辑 / 删除；存储 `data/users/<id>/diary.json`（按账号隔离、老账号零迁移），新增 `/api/diary` 接口（GET/POST/PATCH/DELETE）、`site.ts` 的 `nav` 与 `diary` 配置块；日期由浏览器本地生成、服务端只做格式与真实性校验。顶栏加到 6 项后在 375px 会挤出右边缘（实测溢出 9px），补一条 ≤560px 的导航媒体查询（收字号 / 内边距、允许换行）。无新增依赖，测试 88 → 100 | 需求变更：想加日记功能，单开一个栏目 |
| 2026-11-05 | 两个列表页（`/` 与 `/zh`）的卡片在进度徽章后加「✎ N 条笔记」：`notes.ts` 新增 `readNoteCounts()` 一次读 `notes.json` 汇总，无笔记的文章不显示徽章，`reader.notes` 关掉时不查询；重建镜像并 `docker compose up -d --build` 部署，容器 `Up (healthy)`，容器内实测中英文列表徽章数量正确、无笔记文章不出徽章（验证文章已删）；测试 87 → 88 | 补上一轮评估时留下的「列表页看不到哪本书有笔记」的缺口 |
| 2026-11-05 | 把「段落笔记」版本重新构建并部署到容器：`docker compose up -d --build` 通过、镜像 `readbook:latest` 799MB、容器 `Up (healthy)`、`/api/health` 返回 `dict.words=30001`；命名卷旧数据完好（2 篇文章，含「活着」83745 词）；容器内实测导入中英文各一篇 → 记笔记 / 改笔记 → 阅读页面板与段落竖线正常、中文页仍无点词 → `notes.json` 以 `app` 用户落盘 → 删文章后 `{"version":1,"notes":{}}`（验证文章已删）；空闲内存 59MB | 笔记改动需要上线到容器环境，并确认非 root 用户 + 命名卷下 `notes.json` 可正常读写、删文章能连带清理 |
| 2026-11-05 | 新增「段落笔记」：正文每段右侧悬停出现 ✎，点它给这一段写笔记；记过的段落左侧加强调色竖线，阅读页顶部「本文笔记」面板按正文顺序列出，点「第 N 页」跳到对应段落（`?page=N#block-K`）。锚点用分页的全局块序号而不是页码，每条另存一段原文片段做校验，对不上时显示「原文已变动」且不跳转。存储 `data/users/<id>/notes.json`（按账号隔离、老账号零迁移、删文章一并清理），新增 `/api/notes` 接口（GET/POST/PATCH/DELETE）、`site.ts` 的 `reader.notes` 开关与 `limits.maxNotesPerArticle` / `maxNoteChars` 限额；中英文阅读都支持，中文仍是纯阅读（不点词、不翻译）。无新增依赖，测试 75 → 87 | 需求变更：想给书本加笔记功能 |
| 2026-11-05 | 把「章节 + 阅读进度」版本重新构建并部署到容器：`docker compose up -d --build` 通过、镜像 `readbook:latest` 799MB、容器 `Up (healthy)`、`/api/health` 返回 `dict.words=30001`；命名卷旧数据完好（admin + 老人与海 26866 词）；容器内实测导入 3 章 6 页文章 → 目录「共 3 章」、第 5 页「当前：Chapter 3 The End」、无参数 302 到 `?page=5`、`progress.json` 落盘、DELETE 后进度键清理（测试文章已删）；空闲内存 33MB | 章节与进度改动需要上线到容器环境，并确认非 root 用户 + 命名卷下进度文件可正常读写 |
| 2026-11-05 | 新增「章节目录 + 阅读进度」：`src/lib/chapters.ts` 自动识别章节（markdown 标题与 `Chapter 1` / `第1章` 等显式标记，只做渲染层，不改分页与翻译缓存）；阅读页加折叠目录、当前章节、「从头开始」，地址没带 `?page` 时按进度自动续读；`src/lib/progress.ts` 按账号存 `data/users/<id>/progress.json`，两个列表页显示「读到 N/M 页」与进度条，删除文章时清理；`site.ts` 新增 `reader` 四个开关；页码链接统一带 `?page=`（否则回第 1 页会被自动续读弹回）；测试 62 → 75 | 需求变更：要自动识别章节，并记住每篇读到哪一页 |
| 2026-11-05 | 把「中文阅读」版本重新构建并部署到容器：`docker compose up -d --build` 通过、镜像 `readbook:latest` 799MB、容器 `Up (healthy)`、`/api/health` 返回 `dict.words=30001`；命名卷旧数据完好（admin + 老人与海，老文章无 `lang` 字段按英文显示）；容器内实测 `/zh` 返回 200、导入中文文章 → 阅读页无点词/生词侧栏 → 删除，全链路正常（测试文章已清理）；空闲内存 38MB | 中文阅读改动需要上线到容器环境，并确认老数据零迁移、非 root 用户 + 命名卷下中文文章可正常读写 |
| 2026-11-05 | 新增「中文阅读」：`ArticleRecord` 加可选 `lang`（`'en' \| 'zh'`，老数据缺省按英文，无迁移），导入页加语言单选（`/import?lang=zh` 可预选），新增中文列表页 `/zh`，首页只列英文；阅读页按语言分支——中文不渲染可点单词、不显示全文翻译与本文生词侧栏、不加载点词脚本，字数按汉字计、分页 1200 字/页（`siteConfig.zhReader`）；新账号欢迎文章改为英文 + 中文各一篇；测试 61 → 62 条 | 需求变更：想加中文阅读，不需要翻译，和英文阅读分开 |
| 2026-11-05 | 用新代码重建镜像并重新部署：`docker compose up -d --build` 1m11s 通过（词库 30001 条，用本地 `data/ecdict.csv` 离线生成）、容器 `Up (healthy)`、`/api/health` 正常；容器内实测 `/settings` 页面与 `/api/settings` 读写可用，设置落到命名卷 `/app/data/users/<id>/settings.json`；命名卷旧数据（admin + 老人与海）完好；镜像 799MB、空闲内存 33MB | 翻译设置改动需要上线到容器环境，并确认新接口在非 root 用户 + 命名卷下读写正常 |
| 2026-11-05 | 全文翻译服务商改为「页面可设置」：新增 `/settings` 页与 `/api/settings` 接口，每个账号可在「站点默认（免费腾讯）」与「个人接口 + 自己的 API Key」之间切换，设置存 `data/users/<id>/settings.json`（文件不存在即跟随站点默认，老账号无需迁移）；`getProvider()` 支持传入账号设置，`translate.ts` / `api/translate.ts` / 阅读页 / 前端状态栏同步；顶栏头像菜单加「翻译设置」入口；`site.ts` 新增 `translation.userConfigurable` 开关；密钥只以掩码回传。无新增依赖，测试仍 61 条全通过 | 需求变更：翻译 API 想做成页面可配置，默认用免费的，也能填个人 Key，不必改代码或重启 |
| 2026-10-24 | 完成 Docker 镜像构建与容器部署验证：`docker compose build` 2m46s 通过（词库 30001 条，用本地 `data/ecdict.csv` 生成）、容器 `Up (healthy)`、`/api/health` 返回 `dict.words=30001`、数据卷沿用旧数据（admin + 老人与海）；文档补镜像体积 799MB、空闲内存 35MB 与 `prepare` 在容器内跳过 TS 检查的说明 | 要求「整个项目部署到 Docker」，需留下可复现的实测结果，并把容器与宿主机行为差异写清 |
| 2026-10-24 | 依赖安装统一为 `npm ci`（新增 `.nvmrc`=22），并在安装段写清「不引入 uv」的原因；Docker 章节补前置条件（引擎必须运行、`data/ecdict.csv`、4321 端口）、健康检查验证方式与 `npm ci` 说明；纠正两处「compose 不会自动读取 `.env`」的错误表述 | 要求「依赖管理改成 uv」经核实不成立：本项目零 Python 依赖，uv 无处可用；真正需要的是把 Node 侧安装做成可复现，并把 Docker 部署的前置条件写进文档。`.env` 那条是实测发现文档与 compose v2 实际行为相反 |
| 2026-10-24 | 阅读页译文区新增「遮挡译文」开关：中文默认模糊、点某一段才显示该段、可一键取消；开关存 `localStorage`（键 `readbook.reader.translateMask.v1`），翻页与刷新都保持，首帧由页面内联脚本给 `<html>` 打 `data-zh-mask` 以免闪现；两栏模式重建 DOM 后按段落索引重挂遮挡状态；测试 60 → 61 条 | 需求变更：希望先读原文、需要时再看译文，避免一进页面就被中文带着走 |
| 2026-10-20 | 阅读页：①两栏对照改为「每段一个行带」的网格结构，英文与中文段落首行严格同线、段边界对齐，两列统一字号/行高/字体，手机端改为段内英文在上中文在下；②顶部页码区新增「跳至 __ / 总页数」输入框（原生 GET 表单，无 JS 也能用）；③删除底部「🔊 朗读标题」按钮及其点击监听（单词发音、侧栏发音不受影响） | 需求变更：对照阅读时中英文段落首尾不在同一水平线、中文显得挤；页数多时只能逐页点；朗读标题按钮无响应 |
| 2026-10-20 | 修复 4 个缺陷：并发首次登录写出多条管理员记录（加用户表并发锁 + 启动自动清理重复项）；`/admin` 的「默认密码」安全告警从不显示（`env.ts` 新增 `adminPasswordConfigured`）；配置空 `ADMIN_USERNAME` 会创建空用户名管理员（同时改为「没有管理员时首个注册者成为站长」）；`scripts/prepare.mjs` 在 Windows 上无法加载模块（改用 `pathToFileURL`） | 全面测试中发现，其中重复管理员与缺失的安全告警会直接影响线上数据与安全性 |
| 2026-10-20 | 测试从 50 条增加到 60 条：补充分页跳页、朗读按钮移除、管理接口越权、路径穿越、跨站写、导入边界、并发注册、管理员启动清理等回归用例；新增 `测试报告.md` 与 `部署手册.md` | 让本次改动与修复有回归保护，并把部署要点固化下来 |
