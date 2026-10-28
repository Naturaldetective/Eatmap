import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 开发期把 /api/fetch 与 /api/data 都转给本机服务（npm run relay，默认 127.0.0.1:8787）。
    // 这样浏览器只跟同源的 5173 说话，前端代码里的地址在生产/开发是同一个写法。
    // 中转没启动时代理回 500，fetch.ts 会自动降级到下一条通道（r.jina.ai），不阻塞导入；
    // /api/data 在本机是文件存储（.eatmap-sync/），与云上 Blob 跑同一份 syncCore 判定。
    proxy: {
      '/api/fetch': {
        target: process.env.RELAY_ORIGIN || 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
      '/api/data': {
        target: process.env.RELAY_ORIGIN || 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  test: {
    // fake-indexeddb 在测试文件顶部注入，环境用 node 即可（无 DOM 依赖）
    environment: 'node',
  },
});
