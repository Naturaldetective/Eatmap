/**
 * 口令 → 空间 id。单独成文件是为了能被服务端测试直接 import：
 * 这个算法必须与 server/syncCore.ts 的 spaceIdOf **逐字节一致**，
 * 不一致的后果是「本机算出的空间 id 在云上找不到自己的数据」，
 * 而两边各自单测都发现不了 —— 所以有一条跨端一致性测同时调这两个实现。
 *
 * 不放 cloud.ts 里是因为那边 import 了 IndexedDB 层，服务端测试环境不该拖进 idb。
 */
const SPACE_ID_LEN = 16;

/** sha256(utf8) 的十六进制前 16 位 */
export async function spaceIdOf(passphrase: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passphrase.trim()));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, SPACE_ID_LEN);
}
