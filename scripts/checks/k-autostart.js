import path from 'node:path';
import { ok, info } from '../lib/report.js';

export const id = 'K';
export const title = '代理启动器与开机自启';

export async function check(ctx) {
  const out = [];
  const vbs = path.join(ctx.DSH_HOME, 'start-dsh-proxy.vbs');
  if (ctx.exists(vbs)) out.push(ok('代理启动器: ' + vbs));
  else out.push(info('没配代理启动器（可选）'));

  const runKey = ctx.runKey();
  if (runKey && runKey.includes('DSH')) out.push(ok('开机自启已注册'));
  else out.push(info('开机自启未注册'));
  return out;
}
