import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ok, warn } from '../lib/report.js';

export const id = 'M';
export const title = 'dsh-selfcheck 总检';

export async function check(ctx) {
  const out = [];
  const selfcheck = path.join(ctx.WS, '.agents', 'skills', 'dsh-selfcheck', 'scripts', 'selfcheck.mjs');
  if (!ctx.exists(selfcheck)) {
    out.push(warn('selfcheck 脚本不存在'));
    return out;
  }
  try {
    const o = execFileSync(process.execPath, [selfcheck], {
      encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_SURFACE: 'desktop' },
    });
    const tail = o.split('\n').filter((l) => /真问题|全过/.test(l)).join(' | ');
    // 走到这里说明 execFileSync 没抛 = 退出码 0 = 通过。文案只作摘要。
    out.push(ok('selfcheck 通过' + (tail ? '：' + tail : '')));
  } catch (e) {
    const txt = ((e.stdout || '') + (e.stderr || '')).trim();
    const tail = txt.split('\n').filter((l) => /真问题|^bad|^  ✗/.test(l)).slice(0, 3).join(' | ');
    out.push(warn('selfcheck 退出 ' + e.status + '：' + (tail || txt.slice(0, 120) || '无输出')));
  }
  return out;
}
