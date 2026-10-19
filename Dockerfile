# ReadBook 英文阅读站 —— 生产镜像（Linux / Node 22，适配 2 核 2G 小服务器）
#
# 构建：docker build -t readbook .
# 运行：docker run -d --name readbook -p 4321:4321 -v readbook-data:/app/data \
#         -e SESSION_SECRET=<随机长字符串> -e ADMIN_PASSWORD=<管理员密码> readbook
# 或者直接用 docker compose（推荐，见 docker-compose.yml / README 第四节）。
#
# 镜像自带：
#   - 词库 data/dict.db（约 3 万词）。构建时优先使用 data/ecdict.csv（若存在），
#     否则尝试联网下载 ECDICT，再不行退回内置的 460 词小词表。
#   - 应用构建产物 dist/
# 运行时数据（账号、文章、生词本、译文缓存）都在 /app/data，建议挂载卷持久化。

# ── 1. 依赖（只装生产依赖） ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── 2. 构建（含 devDependencies，生成 dist） ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && test -f dist/server/entry.mjs

# ── 3. 生成词库 ──
FROM node:22-bookworm-slim AS dict
WORKDIR /app
# 词数，默认 30000
ARG DICT_LIMIT=30000
ENV ECDICT_LIMIT=${DICT_LIMIT}
COPY --from=build /app/scripts/build-dict.mjs ./scripts/build-dict.mjs
COPY --from=build /app/scripts/fetch-ecdict.mjs ./scripts/fetch-ecdict.mjs
COPY --from=build /app/data/seed-dict.json ./data/seed-dict.json
# data/ecdict.csv 若存在（约 63MB）则直接使用；不存在则尝试联网下载；都失败时用内置词表。
COPY data/ecdict.csv* /app/data/
RUN mkdir -p /app/data && \
    if [ -f /app/data/ecdict.csv ]; then \
      echo "[docker] 使用本地 ECDICT 数据源生成词库"; \
      ECDICT_CSV=/app/data/ecdict.csv ECDICT_LIMIT=${DICT_LIMIT} node scripts/build-dict.mjs --force; \
    else \
      (ECDICT_LIMIT=${DICT_LIMIT} node scripts/fetch-ecdict.mjs || (echo "[docker] ECDICT 不可用，退回内置词表" && node scripts/build-dict.mjs --force)); \
    fi && \
    test -f /app/data/dict.db && \
    node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/dict.db',{readOnly:true});const n=db.prepare('SELECT COUNT(*) c FROM words').get().c;console.log('[docker] 词库词条数:',n);if(n<400)process.exit(1)"

# ── 4. 运行 ──
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATA_DIR=/app/data

# 用非 root 用户运行；/app/data 需要可写
RUN groupadd -r app && useradd -r -g app -d /app app

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/prepare.mjs ./scripts/prepare.mjs
COPY --from=build /app/scripts/build-dict.mjs ./scripts/build-dict.mjs
COPY --from=build /app/data/seed-dict.json ./data/seed-dict.json
COPY --from=dict /app/data/dict.db ./data/dict.db
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 4321
VOLUME ["/app/data"]

# 健康检查：/api/health 无需登录
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node scripts/prepare.mjs --prod && node dist/server/entry.mjs"]
