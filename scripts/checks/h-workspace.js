import fs from 'node:fs';
import path from 'node:path';
import { ok, warn, bad } from '../lib/report.js';

export const id = 'H';
export const title = '工作区';

export async function check(ctx) {
  const out = [];
  const join = ctx.pathJoin;
  const WS = ctx.WS;

  if (!ctx.exists(WS)) {
    out.push(bad('工作区不存在: ' + WS));
    return out;
  }
  out.push(ok('工作区: ' + WS));
  for (const d of ['tools', '_tools', 'knowledge', 'reports', '对话存档', '_diag', 'archives']) {
    if (ctx.exists(join(WS, d))) out.push(ok('  ' + d));
    else out.push(warn('  缺目录: ' + d));
  }

  const personaDir = join(WS, 'knowledge', 'persona');
  if (ctx.exists(personaDir)) {
    const got = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md'].filter((f) => ctx.exists(join(personaDir, f)));
    if (got.length === 4) out.push(ok('人格四件套 4/4'));
    else out.push(warn('人格 ' + got.length + '/4'));
  } else out.push(warn('knowledge/persona 缺失'));

  const skillsDir = join(WS, '.agents', 'skills');
  if (ctx.exists(skillsDir)) {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    out.push(ok('技能: ' + dirs.length + ' 个目录'));
  } else out.push(warn('技能库缺失'));

  // pyb/pys 包装器里写死了用户名路径，换机器/换用户名整条 Python 工具链静默断
  for (const wrap of ['pyb.cmd', 'pys.cmd']) {
    const wp = join(WS, '_tools', wrap);
    if (!ctx.exists(wp)) { out.push(warn('_tools/' + wrap + ' 不存在')); continue; }
    try {
      const txt = fs.readFileSync(wp, 'utf8');
      const m = txt.match(/"([A-Za-z]:\\Users\\[^\\"]+)/i);
      if (m) {
        const hardUser = m[1];
        const curUser = join('C:\\Users', path.basename(ctx.HOME));
        if (hardUser.toLowerCase() !== curUser.toLowerCase()) {
          out.push(bad(wrap + ' 写死了 ' + hardUser + '，当前用户是 ' + curUser + ' —— 会静默断'));
        } else {
          out.push(ok(wrap + ' 路径指向当前用户'));
        }
      } else out.push(ok(wrap + ' 没写死用户路径'));
    } catch { out.push(warn(wrap + ' 读不了')); }
  }
  return out;
}
