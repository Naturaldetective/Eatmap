// 一次性数据收集服务：接收浏览器 POST 的城市原始数据，落盘后自动退出。
// 用法：node scripts/collect-cities.mjs  （然后由页面 fetch POST 数据）
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '.cities_raw.json');

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405).end('no'); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    writeFileSync(out, body);
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`saved ${body.length}`);
    console.log(`saved ${body.length} bytes -> ${out}`);
    setTimeout(() => process.exit(0), 100);
  });
}).listen(5199, '127.0.0.1', () => console.log('collector on 5199'));
