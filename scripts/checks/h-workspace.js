import fs from 'node:fs';
import path from 'node:path';
import { ok, warn, bad } from '../lib/report.js';

export const id = 'H';
export const title = '工作区';

export async function check(ctx) {
  const out = [];
  const join = ctx.pathJoin;
  const WS = ctx.WS;

  if (!WS) {
    out.push(bad('工作区未配置（设 DSH_WORKSPACE 或改 manifest.workspace.default）'));
    return out;
  }
  if (!ctx.exists(WS)) {
    // 内置兜底落空 ≠ 路径不存在：前者是「没配置」，文案要指路（审计 P2-5）
    if (ctx.wsIsFallback) out.push(bad('工作区未配置：内置默认 ' + WS + ' 不存在——设 DSH_WORKSPACE，或用 -Workspace / manifest.workspace.default 指向真实工作区'));
    else out.push(bad('工作区不存在: ' + WS));
    return out;
  }
  out.push(ok('工作区: ' + WS));
  const wsDirs = (ctx.manifest && ctx.manifest.workspaceDirs && ctx.manifest.workspaceDirs.length)
    ? ctx.manifest.workspaceDirs : ['tools', '_tools', 'knowledge', 'reports', '对话存档', '_diag', 'archives'];
  for (const d of wsDirs) {
    if (ctx.exists(join(WS, d))) out.push(ok('  ' + d));
    else out.push(warn('  缺目录: ' + d));
  }

  const personaDir = join(WS, 'knowledge', 'persona');
  const personaFiles = (ctx.manifest && ctx.manifest.personaFiles && ctx.manifest.personaFiles.length)
    ? ctx.manifest.personaFiles : ['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md'];
  if (ctx.exists(personaDir)) {
    const got = personaFiles.filter((f) => ctx.exists(join(personaDir, f)));
    if (got.length === personaFiles.length) out.push(ok('人格四件套 ' + got.length + '/' + personaFiles.length));
    else out.push(bad('人格 ' + got.length + '/' + personaFiles.length + ' —— 缺的那几份不会进上下文，agent 就不是那个 agent'));
  } else out.push(bad('knowledge/persona 缺失 —— 人格从不注入'));

  const skillsDir = join(WS, '.agents', 'skills');
  if (ctx.exists(skillsDir)) {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    out.push(ok('技能: ' + dirs.length + ' 个目录'));
  } else out.push(bad('技能库缺失（.agents/skills）—— agent 没有技能可触发'));

  // pyb/pys 包装器里写死了用户名路径，换机器/换用户名整条 Python 工具链静默断
  for (const wrap of ['pyb.cmd', 'pys.cmd']) {
    const wp = join(WS, '_tools', wrap);
    if (!ctx.exists(wp)) { out.push(warn('_tools/' + wrap + ' 不存在')); continue; }
    try {
      const txt = fs.readFileSync(wp, 'utf8');
      const m = txt.match(/"([A-Za-z]:\\Users\\[^\\"]+)/i);
      if (m) {
        const hardUser = m[1];
        // 用 HOME 全路径比对，不假定 C:\Users（用户目录在别的盘时会误判，审计 P3-6）
        if (!ctx.HOME.toLowerCase().startsWith(hardUser.toLowerCase())) {
          out.push(bad(wrap + ' 写死了 ' + hardUser + '，当前用户是 ' + curUser + ' —— 会静默断'));
        } else {
          out.push(ok(wrap + ' 路径指向当前用户'));
        }
      } else out.push(ok(wrap + ' 没写死用户路径'));
    } catch { out.push(warn(wrap + ' 读不了')); }
  }
  return out;
}
