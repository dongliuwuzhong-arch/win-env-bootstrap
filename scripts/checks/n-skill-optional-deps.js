import path from 'node:path';
import { ok, info } from '../lib/report.js';

export const id = 'N';
export const title = '技能级可选依赖';

// nslookup 对不存在的域名也会输出 Address:（那是 DNS 服务器地址），用它判可达永远为真。
// 这里直接在进程内 resolve，不再起 node 子进程。
async function canResolve(host, ms) {
  const dns = await import('node:dns');
  let timer;
  const probe = dns.promises.resolve4(host).then((a) => Array.isArray(a) && a.length > 0).catch(() => false);
  const deadline = new Promise((r) => { timer = setTimeout(() => r(false), ms); });
  try { return await Promise.race([probe, deadline]); } finally { clearTimeout(timer); }
}

export async function check(ctx) {
  const out = [];
  const join = ctx.pathJoin;
  const optTools = [
    ['exiftool', ['-ver'], 'osint/exif.py 用（缺了静默降级成"没元数据"）'],
    ['dotnet', ['--version'], 'ff14-dalamud 自研插件要编译'],
  ];
  for (const [tool, args, why] of optTools) {
    if (ctx.run(tool, args)) out.push(ok(tool + ' 可用'));
    else out.push(info(tool + ' 未装 — ' + why));
  }

  const vtdNM = join(ctx.WS, '.agents', 'skills', 'video-transcript-downloader', 'node_modules');
  if (ctx.exists(vtdNM)) out.push(ok('video-transcript-downloader 的 node_modules 在'));
  else out.push(info('video-transcript-downloader 未装 node_modules（vtd.js 跑不了，要 npm ci）'));

  // osint 的 Python 依赖（本机实测缺 imagehash / playwright）
  const osintOut = ctx.run('python', ['-c', 'import curl_cffi, imagehash, playwright'], { timeout: 25000 });
  if (osintOut !== null) out.push(ok('osint 依赖齐全（curl_cffi/imagehash/playwright）'));
  else out.push(info('osint 依赖不全（curl_cffi / imagehash / playwright 至少缺一个）'));

  const msPlay = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (ctx.exists(msPlay)) out.push(ok('playwright 浏览器已装'));
  else out.push(info('ms-playwright 不存在（playwright 要 playwright install）'));

  // agent-reach 是 uv tool 装的，不在工作区技能目录里
  const arExe = join(ctx.HOME, '.local', 'bin', 'agent-reach.exe');
  if (ctx.exists(arExe)) out.push(ok('agent-reach CLI 在'));
  else out.push(info('agent-reach CLI 未装（uv tool install）'));

  // DSH_SOUL_DATABASE 是用户级环境变量，两个目录都带不走（快照里已查）
  const soulEnv = ctx.sys().env.soulDb;
  if (soulEnv && soulEnv.trim()) out.push(ok('DSH_SOUL_DATABASE = ' + soulEnv.trim()));
  else out.push(info('插件数据库环境变量未设（会回落到默认路径）'));

  const chatTrace = join(ctx.WS, '_tools', 'wxdec', 'ChatTrace.exe');
  if (ctx.exists(chatTrace)) out.push(ok('ChatTrace.exe 在'));
  else out.push(info('ChatTrace.exe 不在（wechat-history 跑不了）'));

  if (await canResolve('api.msedgeservices.com', 8000)) out.push(ok('TTS 端点可解析（api.msedgeservices.com）'));
  else out.push(info('TTS 端点解析不到（dsh-plugin-tts 会哑掉）'));
  return out;
}
