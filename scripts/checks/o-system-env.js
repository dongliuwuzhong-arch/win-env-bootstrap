import fs from 'node:fs';
import { ok, warn, bad, info } from '../lib/report.js';

export const id = 'O';
export const title = '系统环境';

export async function check(ctx) {
  const out = [];
  const sys = ctx.sys();

  // Defender 实时防护：给宿主打补丁 / frida 注入 / 内存取证工具都在它眼皮底下
  const rtp = sys.defender.rtp;
  if (rtp === 'True') {
    const excl = sys.defender.exclusions;
    if (excl && (excl.includes(ctx.WS) || excl.includes('DSH'))) out.push(ok('Defender 实时防护开着，且有相关排除项'));
    else out.push(warn('Defender 实时防护开着、排除项为空 —— 打补丁 / frida / 取证工具可能被拦'));
  } else if (rtp === 'False') out.push(ok('Defender 实时防护已关'));
  else out.push(info('Defender 状态读不到'));

  // 时间同步：时间偏移会让 HTTPS 证书校验失败，TTS/抓取/存档切日一起炸
  const w32 = sys.w32time;
  if (w32 === 'Running') out.push(ok('w32time 运行中'));
  else out.push(warn('w32time = ' + (w32 || 'unknown') + '（时间偏移会让 HTTPS 证书校验失败）'));

  // 中文字体：英文版 Windows 默认不带 CJK
  if (ctx.exists('C:\\Windows\\Fonts\\msyh.ttc')) out.push(ok('中文字体 msyh.ttc 在'));
  else out.push(warn('中文字体缺失（msyh.ttc）—— 渲染/导出可能出方块'));

  // 长路径：profile 里 pnpm 嵌套很容易撞 260
  if (String(sys.longPaths).trim() === '1') out.push(ok('LongPathsEnabled = 1'));
  else out.push(info('LongPathsEnabled = 0（当前路径长度未超限，换机装依赖时留意）'));

  // 磁盘余量
  try {
    const st = fs.statfsSync('C:\\');
    const freeGB = (st.bfree * st.bsize) / 1073741824;
    if (freeGB >= 20) out.push(ok('C: 剩余 ' + freeGB.toFixed(0) + ' GB'));
    else if (freeGB >= 10) out.push(warn('C: 只剩 ' + freeGB.toFixed(0) + ' GB（装依赖 + playwright 要 5GB+）'));
    else out.push(bad('C: 只剩 ' + freeGB.toFixed(0) + ' GB，装不下'));
  } catch { out.push(info('磁盘余量读不到')); }
  return out;
}
