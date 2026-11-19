import fs from 'node:fs';
import path from 'node:path';
import { ok, warn, bad } from '../lib/report.js';

export const id = 'G';
export const title = 'DSH 本体';

export async function check(ctx) {
  const out = [];
  const join = ctx.pathJoin;

  // 用 ctx.DSH_ROOT（含注册表 InstallLocation 回退），不写死常见路径：
  // 装在 D 盘等自定义目录时，写死会让 G 段报「宿主未找到」而 G2 段却全绿，自相矛盾。
  const dshExe = ctx.DSH_ROOT ? join(ctx.DSH_ROOT, 'DeepSeek Harness.exe') : null;
  if (dshExe) out.push(ok('宿主: ' + dshExe));
  else out.push(bad('DSH 宿主未找到'));

  const DSH_ROOT = ctx.DSH_ROOT;
  const appPkg = DSH_ROOT ? join(DSH_ROOT, 'resources', 'app', 'package.json') : '';
  if (ctx.exists(appPkg)) {
    try { out.push(ok('解包树版本: ' + JSON.parse(fs.readFileSync(appPkg, 'utf8')).version)); }
    catch { out.push(warn('解包树 package.json 读不了')); }
  } else out.push(warn('解包树不存在（宿主可能还在读 asar）'));

  if (ctx.exists(ctx.DSH_HOME)) out.push(ok('.dsh: ' + ctx.DSH_HOME));
  else out.push(bad('.dsh 不存在'));

  const profPkg = join(ctx.DSH_HOME, 'profiles', 'desktop', 'package.json');
  if (ctx.exists(profPkg)) {
    try {
      const j = JSON.parse(fs.readFileSync(profPkg, 'utf8'));
      const n = (j.dsh?.profile?.bundles || []).length;
      out.push(ok('profile bundles: ' + n));
    } catch { out.push(warn('profile package.json 解析失败')); }
  } else out.push(warn('profiles/desktop/package.json 不存在'));

  if (ctx.exists(join(ctx.DSH_HOME, '.credentials.yaml'))) out.push(ok('.credentials.yaml 在'));
  else out.push(warn('.credentials.yaml 不存在（要填 API key）'));

  // DSH CLI shim：丢了 dsh 命令行入口就没了，但报告会显示全过
  const cliBin = DSH_ROOT ? join(DSH_ROOT, 'resources', 'runtime', 'cli', 'bin') : '';
  if (ctx.exists(cliBin)) {
    const up = ctx.sys().env.userPath;
    const inUserPath = Boolean(up) && up.split(';').some((e) => e.trim().toLowerCase() === cliBin.toLowerCase());
    if (inUserPath) out.push(ok('DSH CLI shim 在用户 PATH'));
    // bootstrap 的 Add-PathEntry 只被 7-Zip 调用，从不补这个目录 —— 别指向一个不会发生的动作
    else out.push(warn('DSH CLI shim 不在用户 PATH（dsh 命令入口没了）', '手工把 ' + cliBin + ' 加进用户 PATH'));
  } else out.push(warn('DSH CLI bin 目录不存在'));
  return out;
}
