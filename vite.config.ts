import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
// 没有 dev server.proxy：/api/fetch 与 /api/data 只在 EdgeOne Pages 上存在（node-functions/），
// 本机 dev 抓不到真实正文（预览域对非签名请求一律 401，代理过去也没用），
// 会自动降级到 r.jina.ai / 公共代理链；要验完整链路就在云上页面测（见 README 部署说明）。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // fake-indexeddb 在测试文件顶部注入，环境用 node 即可（无 DOM 依赖）
    environment: 'node',
  },
});
