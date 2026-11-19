import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ok, warn } from '../lib/report.js';

export const id = 'L';
export const title = '工作区脚本可跑性';

// 这里要拿退出码和 stderr 的前两行，不能走 lib/run.js 的「有输出就算成功」语义
const scriptChecks = [
  ['check-paths.mjs', '宿主路径解析'],
  ['check-skills.mjs', '技能注册'],
  ['persona-lint.mjs', '人格数字一致性'],
  ['check-persona-context.mjs', '人格注入'],
];

export async function check(ctx) {
  const out = [];
  for (const [file, label] of scriptChecks) {
    const p = path.join(ctx.WS, 'tools', file);
    if (!ctx.exists(p)) { out.push(warn(label + '：脚本不存在 ' + file)); continue; }
    try {
      execFileSync(process.execPath, [p], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
      out.push(ok(label + '（' + file + '）'));
    } catch (e) {
      const txt = ((e.stdout || '') + (e.stderr || '')).split('\n').filter((l) => l.trim()).slice(0, 2).join(' ');
      out.push(warn(label + '（' + file + '）退出码 ' + e.status + '：' + txt.slice(0, 100)));
    }
  }
  return out;
}
