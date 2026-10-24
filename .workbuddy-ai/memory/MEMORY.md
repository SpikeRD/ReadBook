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
- `测试报告.md` 是阶段性快照，不随每次小改更新；但 README 里写的测试条数（当前 61 条）要同步。
