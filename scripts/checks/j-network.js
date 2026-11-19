import { ok, warn } from '../lib/report.js';

export const id = 'J';
export const title = '网络';

export async function check(ctx) {
  const out = [];
  // netstat -ano 一次拿全，P 段也读这份快照
  const text = ctx.netstat();
  const proxyUp = Boolean(text) && /127\.0\.0\.1:7897/.test(text);
  if (proxyUp) out.push(ok('本地代理 7897 在听'));
  else out.push(warn('本地代理 7897 没在听（DSH 会直连，慢但能用）'));
  return out;
}
