import { ok, warn } from '../lib/report.js';

export const id = 'E';
export const title = '逆向工具（可选）';

export async function check(ctx) {
  const out = [];
  const frida = ctx.run('frida', ['--version']);
  if (frida) out.push(ok('frida ' + frida));
  else out.push(warn('frida 未装（wechat-history 需要）', 'pip install frida frida-tools'));
  return out;
}
