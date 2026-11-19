import path from 'node:path';
import { ok, warn } from '../lib/report.js';

export const id = 'D';
export const title = '浏览器自动化';

export async function check(ctx) {
  const out = [];
  const chrome = ctx.firstExisting([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ]);
  if (chrome) out.push(ok('Chrome: ' + chrome));
  else out.push(warn('Chrome 未安装（fetch-render.mjs 需要）'));

  if (ctx.exists(path.join(ctx.WS, '_tools', 'browser', 'node_modules', 'puppeteer'))) out.push(ok('puppeteer 已装'));
  else out.push(warn('puppeteer 缺失（_tools/browser 下跑 npm i）'));
  return out;
}
