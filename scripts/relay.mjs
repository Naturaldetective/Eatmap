#!/usr/bin/env node
/**
 * 本机中转服务（§4.5）。零依赖，只绑 127.0.0.1，用完 Ctrl-C 关掉。
 *
 *   npm run relay                      # 默认 http://127.0.0.1:8787/api/fetch
 *   RELAY_PORT=9000 npm run relay       # 换端口
 *   RELAY_ALLOWED_ORIGINS=http://localhost:5173 npm run relay   # 锁 CORS 来源
 *
 * 前端不需要手填地址：vite 已把 /api/fetch 代理到这里（vite.config.ts），
 * 浏览器只跟同源的 localhost:5173 说话，代理再转过来。
 *
 * 逻辑分两层：server/relayCore.ts 是纯解析 + HTTP 信封（可单测、不碰网络），
 * server/relayNode.ts 是传输层（必须 node:https，不能用 global fetch，理由写在那文件头上）。
 */
import { createServer } from 'node:http';

const { handleRelayRequest, relayCorsHeaders } = await import(
  new URL('../server/relayCore.ts', import.meta.url).href
);
const { nodePageFetcher } = await import(new URL('../server/relayNode.ts', import.meta.url).href);

const PORT = Number(process.env.RELAY_PORT || 8787);
const HOST = process.env.RELAY_HOST || '127.0.0.1';
const ENV = {
  allowedOrigins: process.env.RELAY_ALLOWED_ORIGINS || '',
  cacheSeconds: Number(process.env.RELAY_CACHE_SECONDS || 0),
};

/** 日志里绝不出现 xsec_token：它等同于访问凭证，落到终端历史/日志就是泄露 */
function safeUrl(u) {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname}`;
  } catch {
    return '(非法地址)';
  }
}

const server = createServer(async (req, res) => {
  const x = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    // 预检走同一套头（含 PNA），否则云上 https 页面调本机这一跳会被 Chrome 拦下
    res.writeHead(204, relayCorsHeaders(req.headers.origin, ENV, req.headers['access-control-request-headers']));
    res.end();
    return;
  }

  if (x.pathname === '/' || x.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'eatmap-relay',
        endpoints: ['/api/fetch?url=<带 xsec_token 的原地址>&format=meta|html'],
        hosts: ['xiaohongshu.com', 'xhslink.com', 'mp.weixin.qq.com'],
      }) + '\n',
    );
    return;
  }

  if (x.pathname !== '/api/fetch') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '未知路径，用 /api/fetch?url=…' }));
    return;
  }

  const t0 = Date.now();
  const out = await handleRelayRequest(
    { url: x.searchParams.get('url') || '', format: x.searchParams.get('format') || 'meta', origin: req.headers.origin },
    nodePageFetcher,
    ENV,
  );
  const size = out.body.length;
  res.writeHead(out.status, out.headers);
  res.end(out.body);
  const peek = out.status === 200 ? (x.searchParams.get('format') === 'html' ? `${size}B html` : JSON.parse(out.body).meta?.title?.slice(0, 28)) : out.body.slice(0, 80);
  console.log(
    `${out.status} ${String(Date.now() - t0).padStart(5)}ms ${safeUrl(x.searchParams.get('url') || '')} → ${peek}`,
  );
});

server.listen(PORT, HOST, () => {
  console.log(`EatMap 中转已启动 http://${HOST}:${PORT}/api/fetch`);
  console.log('健康检查：curl "http://' + HOST + ':' + PORT + '/"');
  console.log('云上页面也能直接用它：导入页「中转地址」填 http://' + HOST + ':' + PORT + '/api/fetch');
  console.log('停止：Ctrl-C（只监听本机，不对外暴露）');
});
