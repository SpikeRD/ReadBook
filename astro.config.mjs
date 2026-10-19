// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Windows 本机：`npm run dev` 开发，`npm run start` 以 Node 常驻服务方式运行构建产物。
// 输出目录为 dist/（assets 为静态文件，server 为 Node 服务入口）。
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT) || 4321,
  },
  devToolbar: { enabled: false },
  security: {
    // 关闭 Astro 内建 CSRF：它要求「无 Content-Type 的写请求」Origin 严格等于内部 URL，
    // 而 Node 适配器内部 URL 常见为 https://，浏览器的同源 DELETE（不发 Origin、也不发
    // Content-Type）会被误拦 403。src/middleware.ts 里用真实 Host 做了同源校验 + 补
    // application/json，安全性等价且兼容本机/反向代理。
    checkOrigin: false,
  },
  build: {
    assets: 'assets',
  },
  vite: {
    ssr: {
      external: ['node:sqlite'],
    },
  },
});
