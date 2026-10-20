# ReadBook 英文阅读站

以「英文阅读器」为核心的个人网站：注册 / 登录后导入英文文章 → 点词查中文释义并发音 → 生词自动进生词本。所有数据（文章、生词本、译文缓存）按账号隔离保存在服务器，换设备登录同一账号即可继续。技术栈为 Astro + 轻量 Node 后端，单进程跑在一台小服务器上即可。

> 以下命令均在 **PowerShell**（Windows 10 开始菜单搜 "PowerShell"）中、于项目根目录执行。
> 需要 Node.js **22.13 或更高版本**（内置 `node:sqlite`；本次验证使用 Node 24.20.0）。

---

## 一、安装

```powershell
cd E:\Desktop\DeepSeekHarness\ReadBook
npm install
```

安装完成后直接运行 `npm run dev` 即可，其余初始化会自动完成（生成约 3 万词的本地词库 `data/dict.db`、生成 `.env`），无需手工准备数据。

第一次打开网站会跳到登录页：点「创建第一个账号（站长）」注册，第一个账号会接管本机已有的示例文章；之后每个新注册的账号都会自动获得一篇欢迎示例文章。

## 二、开发预览

```powershell
npm run dev
```

浏览器打开 **http://127.0.0.1:4321** ，注册或登录后进入。改代码会自动热更新，`Ctrl + C` 停止。

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖（一次即可） |
| `npm run dev` | 开发模式，带热更新，监听 `http://127.0.0.1:4321` |
| `npm run build` | 构建生产产物到 `dist/` |
| `npm run start` | 以生产模式启动（先自动 `prepare`，再跑 `dist/server/entry.mjs`），同样监听 `http://127.0.0.1:4321` |
| `npm run preview` | 与 `npm run start` 相同（方便记忆） |
| `npm run check` | Astro / TypeScript 类型检查 |
| `npm test` | 单元测试 + 端到端测试（会自动启动临时服务，不影响本地 `data/`） |
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
  data/dict.db                          公共词库（约 3 万词，所有用户共用）
  ```
- 换设备：在新设备打开站点、用同一用户名密码登录即可，文章与生词本自动同步，无需导入导出。

---

## 说明（不在三段之内，供参考）

- **账号体系**：用户名 + 密码登录，密码用 scrypt 加盐哈希存储；会话是 HMAC 签名的 HttpOnly Cookie（默认 30 天）。改密码后其他设备的旧会话立即失效。顶栏右侧头像菜单可「修改密码 / 退出登录」。自助注册开关与账号数量上限在 `src/config/site.ts` 的 `auth` 里。
- **管理员**：凭据由 `.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 控制（默认 `admin` / `admin`）。用管理员账号登录后，顶栏出现「账号管理」（或直接访问 `/admin`），可以：
  - 查看全部账号（角色、文章数、生词数、注册时间、最近登录）与全站统计
  - 新建账号（密码留空自动生成，创建后弹窗显示一次）
  - 重置普通用户密码（自动生成新密码并显示，对方旧会话失效）
  - 删除账号（连同该用户的文章、生词本、翻译缓存一起删除）
  - 修改 `.env` 中的管理员密码后**无需重启**，下一次请求即生效，旧密码立即失效；管理员密码不能在页面里改（页面会提示去改 `.env`）。
  - 兜底：若 `.env` 还没有管理员账号，系统会在第一次登录 / 访问时按 `.env` 自动创建。
- **数据隔离**：每个用户的文章、生词本、翻译缓存都存放在 `data/users/<用户id>/` 下，接口一律以当前登录用户为准，无法通过 URL 读取别人的文章。
- **首次使用**：第一个注册的账号会自动接管本机原有数据；每个新账号会得到一篇欢迎示例文章。浏览器里旧版（localStorage）生词本会在首次登录后自动合并进账号，然后从浏览器删除。管理员账号 `admin` 会在首次登录时自动按 `.env` 创建。
- **改内容只需改一个文件**：`src/config/site.ts`（站点名、导航、社交链接、关于我、容量限制、是否点词自动进生词本、账号规则、全文翻译服务商等）；配色主题在 `src/config/themes.ts`。
- **生词本按分组隔离**：每篇文章的生词只属于该文章；顶栏「生词本」可按分组标签切换。阅读页点词浮层里可以「加入本篇生词」，也可以新建自建分组（下拉/标签点击加入）；生词本页支持分组改名 / 删除 / 移动词条。导出 JSON 含分组结构，导入时可选合并或替换。
- **本地词库约 3 万词**：`data/dict.db` 由 ECDICT 按词频截取前 30000 个常用词生成（含音标与中文释义，约 5.8MB），运行时只做索引点查、不整体载入内存。需要调整词数：
  ```powershell
  npm run dict:fetch                            # 下载 ECDICT（约 63MB，缓存到 data/ecdict.csv）并生成 30000 词
  node scripts\fetch-ecdict.mjs --limit=60000   # 换成 6 万词
  npm run dict:rebuild                          # 已有 data/ecdict.csv 时只重新生成，不再下载
  ```
  完全离线时也可以用内置的约 460 词词表兜底（删除 `data/dict.db` 后启动会自动重建基础词库）。
- **背景配色**：顶栏色块可切换 **白天 / 黑夜 / 护眼（豆沙绿）/ 暖黄（纸张）/ 高对比** 五种主题，首帧生效、刷新不闪白；选择保存在本机浏览器（这是唯一保存在本地的偏好，不影响数据）。
- **长文分页**：阅读页按内容自动分页（默认每页约 3000 字符，整本书不会再挤在一页）。页码用 `?page=N` 表示，可收藏、可分享、浏览器前进后退都正常；顶部有页码列表，右侧「跳至 __ / 总页数」输入页码后回车（或点「跳转」）直接跳到该页，是原生表单、没有 JS 也能用；底部有上一页 / 下一页；电脑上支持键盘 `←` `→` 翻页（光标在页码输入框里时不会误翻页）。超长段落会在句子边界拆开，不会把一段劈成两半，也不会丢内容。每页字符数在 `src/config/site.ts` 的 `pagination.charsPerPage` 里调整。全文翻译按页请求与缓存，「本文生词」侧栏优先显示本页出现的词。
- **全文翻译**：阅读页右上角「全文翻译」。默认使用 **腾讯交互翻译**（免密钥、国内直连、支持批量、质量好）；可切换 MyMemory（免费但有每日额度，长文易触发 429）或自定义接口。
  - **四种显示方式**（选择会记住，翻页不重置）：**两栏对照**（默认，左英文右中文）／上下对照／只看译文／只看原文。两栏模式下每段是一个「行带」：同一段的英文与中文**首行在同一条水平线上、末行也齐平**，中文不会挤在一起；两列字号、行高与字体一致（行高 1.75em），逐行基线对齐。手机宽度（≤760px）下每段改为英文在上、中文在下的段内成组排布。
  - **批量预翻译**：点一次「全文翻译」会翻译 **当前页 + 后续 4 页**（共 5 页）；往后读到第 3 页时**自动续翻后面一批**，基本做到"翻到哪、译到哪"且不用等待。
  - **自动重试**：翻译服务偶发的 `busy` / 429 / 网络错误会自动重试（最多 4 次、指数退避），对用户透明；重试后仍失败的段落不会被缓存，下次会补齐。
  - 译文按「段」增量保存在账号里（`data/users/<用户id>/translations/`），**翻页、刷新、重新进入都不会丢**，服务端直接把已缓存的译文渲染进页面。纯数字、页码等无需翻译的段落自动跳过。
  - 相关配置（`site.ts` 的 `translation`）：`prefetchPages`（一次翻译几页，默认 5）、`prefetchTriggerPage`（读到第几页触发续批，默认 3）、`concurrency`（并发批次数，默认 2）、`retry`（重试策略）。
  - 换服务：`.env` 设置 `ONLINE_TRANSLATE_URL`（含 `{q}`、`{to}` 占位），再把 `site.ts` 的 `translation.provider` 改为 `'custom'`。
- **安全**：口令式共享访问已移除；所有写请求做同源校验（CSRF），未登录访问页面跳登录页、访问接口返回 401。反向代理上 HTTPS 时把 `.env` 的 `COOKIE_SECURE` 改为 `1`，并把 `SESSION_SECRET` 换成随机长字符串。

---

## 四、Docker 部署

Dockerfile 是多阶段构建：`deps`（生产依赖）→ `build`（生成 `dist/`）→ `dict`（生成约 3 万词的 `data/dict.db`）→ `runtime`（Node 22 slim + 非 root 用户 + 健康检查）。

### 方式一：docker compose（推荐）

```powershell
cd E:\Desktop\DeepSeekHarness\ReadBook

# 设置关键变量（不设置则用默认值：admin/admin，强烈建议改掉）
$env:SESSION_SECRET = "请换成随机长字符串"
$env:ADMIN_PASSWORD = "你的管理员密码"

docker compose up -d --build
docker compose ps
```

浏览器打开 **http://localhost:4321**，用上面的管理员账号登录。停止 / 更新：

```powershell
docker compose logs -f                  # 看日志
docker compose restart                  # 重启（数据保留）
docker compose up -d --build            # 更新到最新代码（重新构建）
docker compose down                     # 停止（保留数据卷）
docker compose down -v                  # 停止并删除数据卷（会清空所有账号与文章！）
```

数据保存在命名卷 `readbook-data` 中（容器内 `/app/data`），**重建容器不会丢数据**。

> **环境变量只在创建容器时生效**：改了 `ADMIN_PASSWORD` / `SESSION_SECRET` 后，
> `docker compose up -d` 会重建容器并应用新值；已经是运行中的容器 `restart` 不会更新环境变量。

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

- **环境变量优先于镜像内的 `.env`**：用 `-e` / compose `environment` 设置的 `ADMIN_PASSWORD`、`SESSION_SECRET` 会覆盖配置文件。
- 容器以非 root 用户 `app` 运行，实测常驻内存约 35MB，compose 里限制了 `mem_limit: 1g`，适合 2 核 2G 小服务器。
- 镜像内自带健康检查（`/api/health`），`docker ps` 里状态应显示 `healthy`。
- 换机器迁移：把 `docker volume` 里的数据复制过去，或用 `docker run --rm -v readbook-data:/data -v ${PWD}:/backup alpine tar czf /backup/readbook-data.tgz -C /data .` 备份。

### 代码结构（本轮已拆分）

```
src/lib/                服务端
  auth.ts               账号、scrypt 密码哈希、注册/登录/改密、管理员操作
  auth-guard.ts         当前用户、会话 Cookie 读写、API 401/403
  admin-stats.ts        管理员账号总览与全站统计
  session.ts            签名会话 token（带用户 id 与版本）
  articles.ts           按用户存储文章、配额、旧数据认领
  vocab-server.ts       按用户存储生词本（分组模型、导入去重）
  translate.ts          分段翻译 + 按用户缓存
  paginate.ts           长文分页（按块切页、超长段落按句拆分）
  seed.ts               新用户欢迎文章
  paths.ts / env.ts / text.ts / dict.ts / reader-html.ts
src/scripts/client/     浏览器端
  reader.ts             阅读页入口（只负责事件与流程）
  reader/popover.ts     释义浮层
  reader/panel.ts       生词高亮与本文生词侧栏
  reader/lookup.ts      查词请求缓存
  reader/pager.ts       键盘翻页
  reader/html.ts        转义等小工具
  vocabulary-page.ts    生词本页逻辑
  admin-page.ts         管理员页逻辑
  vocab-store.ts        生词本数据层（服务端同步 + 旧数据迁移）
  dialog.ts             应用内弹窗（askText 支持自定义空值提示）
  theme / translate / speech / account-menu
src/pages/              login / register / admin / index / import / read/[id] / vocabulary / about
src/pages/api/          auth/*, admin/accounts, articles, vocabulary(+import), translate, lookup, health
```

### 后续 TODO

1. 在线词典兜底：在 `.env` 配置 `ONLINE_DICT_URL`（含 `{word}` 占位），未收录词自动走在线接口。
2. 发音音源兜底：目前只用浏览器 Web Speech API（Windows 自带语音可用）。
3. 文章分页 / 搜索：文章数量变大后给首页加搜索与分页。
4. 阅读进度与「已掌握」的复习提醒（需求明确本轮不做遗忘曲线）。
5. 备份策略：`data/` 目录定时打包（含 `users.json` 与各用户目录）。
6. 图片：`public/` 下放图即可；缺失时自动回退到 `/placeholder.svg`，头像缺失回退为首字母。
7. 翻译质量增强：MyMemory 为免费众包记忆库，长文可出现机翻腔；可接入 DeepL / 百度 / 腾讯正式 API。
8. 账号管理增强：目前没有邀请码、管理员账号不能被删除、也没有「停用账号」状态，可按需补。
9. 词库扩充：前 3 万词已覆盖日常阅读，专业术语可按需提高 `--limit`。

### 变更记录

| 日期 | 改了什么 | 为什么 |
|---|---|---|
| 2026-10-20 | 阅读页：①两栏对照改为「每段一个行带」的网格结构，英文与中文段落首行同线、末行齐平，两列统一字号/行高/字体，手机端改为段内英文在上中文在下；②顶部页码区新增「跳至 __ / 总页数」输入框（原生 GET 表单）；③删除底部「🔊 朗读标题」按钮及其点击监听（单词发音、侧栏发音不受影响） | 需求变更：对照阅读时中英文段落首尾不在同一水平线、中文显得挤；页数多时只能逐页点；朗读标题按钮无响应 |
