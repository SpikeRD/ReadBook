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
- 改动代码要同步：`README.md`（功能 + 变更记录表）、`需求确认单.md`（变更记录表）、必要时 `部署手册.md`。变更记录格式：日期 + 改了什么 + 为什么。
- `测试报告.md` 是阶段性快照，不随每次小改更新；但 README 里写的测试条数（当前 100 条）要同步。

## 界面约定
- **顶栏 `siteConfig.nav` 加项必须实测窄屏**：`.nav-links` 按 max-content 撑开、父级不压缩，6 项在 375px 就会挤出右边缘被 `overflow-x:hidden` 裁掉（不会横向滚动，只是看不见）。`global.css` 末尾已有一条 `@media (max-width:560px)` 收字号/内边距 + `flex:1 1 100%` 兜底，再加项要重新量 375px 与 320px。
- **面向用户的日期一律按浏览器本地时间生成**，服务端只做格式与真实性校验：容器跑 UTC，服务端算日期会差 8 小时。
- 改 CSS 后必须重新 `npm run build` 再重启服务，Astro 的 CSS 文件名带 hash，旧进程引用的 hash 会 404（页面看起来"样式规则错乱"其实根本没加载）。
