/**
 * 结果收集与渲染。check 只产出结构化结果，不打印。
 * 结果形状：{ id, level, message, fixable, fix }
 *   level: ok | warn | bad | info
 *   fixable: 能否由 bootstrap 自动补（winget 装 / 加 PATH）；fix 是具体动作提示
 */

export const MARK = { ok: '✓', warn: '⚠', bad: '✗', info: '·' };

const mk = (level) => (message, fix) => ({
  level, message, fixable: Boolean(fix), fix: fix || null,
});

export const ok = mk('ok');
export const warn = mk('warn');
export const bad = mk('bad');
export const info = mk('info');

export function stamp(id, results) {
  for (const r of results) r.id = id;
  return results;
}

export function counts(results) {
  let hard = 0;
  let soft = 0;
  for (const r of results) {
    if (r.level === 'bad') hard++;
    else if (r.level === 'warn') soft++;
  }
  return { hard, soft };
}

// 退出码契约：0 全过 / 1 有硬缺口 / 2 仅提醒
export function exitCode(c) {
  if (c.hard > 0) return 1;
  if (c.soft > 0) return 2;
  return 0;
}

export function line(r) { return '  ' + MARK[r.level] + ' ' + r.message; }

export function summary(c) {
  if (c.hard === 0 && c.soft === 0) return { text: '全过，可以开工。', code: 0 };
  if (c.hard === 0) return { text: '硬缺口 0，提醒 ' + c.soft + ' 条。能用，建议按提醒补齐。', code: 2 };
  return { text: '硬缺口 ' + c.hard + ' 条，提醒 ' + c.soft + ' 条。先修硬缺口。', code: 1 };
}
