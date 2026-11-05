# ReadBook 项目长期约定

## 依赖与运行环境
- **依赖管理就是 npm + `package-lock.json`，不引入 uv。** 本项目零 Python 依赖：`scripts/` 下 `prepare.mjs` / `build-dict.mjs` / `fetch-ecdict.mjs` 均为 Node ESM，测试用 `node --test` 跑 `.mjs`。uv 是 Python 包管理器，接入后只能包一层调 npm。
- 本地与 Docker 构建统一用 `npm ci`（不用 `npm install` 安装）。Node 版本要求同时写在 `package.json` 的 `engines`（>=22.13，内置 `node:sqlite`）与 `.nvmrc`（22）。
- 校验 lockfile 是否与 package.json 同步：`npm ci --dry-run`。

## Docker
- `Dockerfile` 四阶段：deps → build → dict → runtime；非 root 用户 `app`；`HEALTHCHECK` 打 `/api/health`；数据在 `/app/data`，compose 用命名卷 `readbook_readbook-data`。
- 构建前置：本机 `data/ecdict.csv`（约 63MB）存在则不再联网；4321 端口需空闲（容器映射宿主机 4321）。
- **compose v2 会自动读取项目根 `.env` 做 `${VAR}` 插值**（已实测：探针变量取到 .env 的值）。但环境变量只在创建容器时注入，`restart` 不生效，必须 `up -d`。优先级：shell 环境变量 > `.env` > compose 默认值。`.dockerignore` 已排除 `.env`，不会进镜像。
- 本机启动 Docker Desktop 会被沙箱安全策略拦 `wsl.exe`，需要用户在 WorkBuddy 外手动启动引擎。

## 文档同步
- **文档布局（2026-11-05 起）**：根目录只留 `README.md`（唯一入口），其余四份在 `docs/`：`需求确认单.md`（需求口径）、`部署手册.md`、`打包教程.md`、`测试报告.md`，索引是 `docs/README.md`。文件名保持中文（正文里有大量 `《打包教程.md》` 式文本引用，改名会失真）。
- 改动代码要同步：`README.md`（功能 + 变更记录表）、`docs/需求确认单.md`（变更记录表）、必要时 `docs/部署手册.md`。变更记录格式：日期 + 改了什么 + 为什么，**只追加不重写历史行**。
- `docs/测试报告.md` 是阶段性快照，不随每次小改更新；但 README 里写的测试条数（当前 110 条）要同步。
- 文档互链用相对路径：同目录直接写文件名，指根目录写 `../README.md`。改完扫一遍本地链接（移动文件后尤其要）。

## 安全与凭据（2026-11-05 收口）
- **`data/users.json`、`data/users/**`、`data/ecdict.csv` 不允许进 git**（已在 `.gitignore`，且已 `git rm --cached`）。新增数据文件先确认 ignore 生效再 add。
- `ADMIN_PASSWORD` 没有默认值：留空 = 不启用配置管理员，首个注册者成为站长。compose 的 `SESSION_SECRET` 用 `${VAR:?}` 必填；`prepare.mjs` 首次生成 `.env` 时写随机密钥。改 env 后必须 `up -d`。
- 在线词典兜底默认走有道 `jsonapi`（`ONLINE_DICT_URL` 可换模板，`off` 关闭）；只缓存命中的词。

## 类型检查
- `npm run check` 曾经因 `tsconfig` 把 `desktop/runtime/app/dist/**` 拉进检查而 V8 abort。`exclude` 必须保留 `desktop`；加新目录时先想清楚是否含打包产物。
- 测试用 `node --test` 直接 import 源码时，import 路径**必须带 `.ts` 后缀**（Node ESM 不补扩展名，Vite 才补）。`src/lib` 下一直是这么写的。

## 打包（Docker / 桌面版）
- `.dockerignore` 已排除 `desktop`（它是独立 npm 包，413MB node_modules 不该进构建上下文）。
- 桌面版重打包：`electron-builder` 直接输出到 `release/` 会因 `release/win-unpacked` 删不掉而失败（沙箱 safe-delete 拦截），用 `--config.directories.output=build-tmp` 再 `cp` 回 `release/`。
- 验证 exe 不必点 GUI：直接 `node desktop/runtime/app/dist/server/server.mjs`（配 `DATA_DIR` + `runtime/seed/dict.db`）就能证明包内服务端可用。

## 界面约定
- **顶栏 `siteConfig.nav` 加项必须实测窄屏**：`.nav-links` 按 max-content 撑开、父级不压缩，6 项在 375px 就会挤出右边缘被 `overflow-x:hidden` 裁掉（不会横向滚动，只是看不见）。`global.css` 末尾已有一条 `@media (max-width:560px)` 收字号/内边距 + `flex:1 1 100%` 兜底，再加项要重新量 375px 与 320px。
- **面向用户的日期一律按浏览器本地时间生成**，服务端只做格式与真实性校验：容器跑 UTC，服务端算日期会差 8 小时。
- 改 CSS 后必须重新 `npm run build` 再重启服务，Astro 的 CSS 文件名带 hash，旧进程引用的 hash 会 404（页面看起来"样式规则错乱"其实根本没加载）。
