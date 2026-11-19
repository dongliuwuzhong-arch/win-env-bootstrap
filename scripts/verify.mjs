#!/usr/bin/env node
/**
 * dsh-env-bootstrap / verify.mjs —— 装载器
 * 详细自检：Node 装好之后跑这个。中文报告，覆盖 DSH 日常全部前置条件。
 *
 * 结构：checks/*.js 每段一个，导出 check(ctx) -> Result[]；这里只按 manifest 的
 * 类别顺序跑、排版、计数、定退出码。单跑某段：--only=A,G2
 *
 * 退出码：0 全过 / 1 有硬缺口 / 2 能跑但有提醒
 */
import os from 'node:os';
import { createContext } from './lib/paths.js';
import { bad, stamp, line, counts, summary } from './lib/report.js';

import * as P0 from './checks/00-prerequisites.js';
import * as A from './checks/a-core-runtime.js';
import * as B from './checks/b-archive.js';
import * as C from './checks/c-media.js';
import * as D from './checks/d-browser.js';
import * as E from './checks/e-reverse.js';
import * as F from './checks/f-python-packages.js';
import * as G from './checks/g-dsh-core.js';
import * as G2 from './checks/g2-plugin-prereq.js';
import * as H from './checks/h-workspace.js';
import * as I from './checks/i-system-config.js';
import * as J from './checks/j-network.js';
import * as K from './checks/k-autostart.js';
import * as L from './checks/l-script-runnability.js';
import * as M from './checks/m-selfcheck.js';
import * as N from './checks/n-skill-optional-deps.js';
import * as O from './checks/o-system-env.js';
import * as P from './checks/p-integrity-migration.js';

const CHECKS = [P0, A, B, C, D, E, F, G, G2, H, I, J, K, L, M, N, O, P];

function parseArgs(argv) {
  const only = [];
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--only=(.*)$/);
    if (!m) continue;
    for (const raw of m[1].split(',')) {
      const id = raw.trim().toUpperCase();
      if (id && !only.includes(id)) only.push(id);
    }
  }
  // --no-selfcheck：M 段的 selfcheck 约 8 秒，调试期跳过
  const noSelfcheck = argv.slice(2).includes('--no-selfcheck');
  // --json：机器可读输出，MCP server 与自动化都靠它
  const json = argv.slice(2).includes('--json');
  return { only, noSelfcheck, json };
}

const ctx = createContext();
const { only, noSelfcheck, json } = parseArgs(process.argv);
// --json 时把所有人类可读输出静音，只在最后吐一份 JSON
const say = json ? () => {} : console.log;

const byId = new Map(CHECKS.map((m) => [m.id, m]));
const unknown = only.filter((id) => !byId.has(id));
if (unknown.length) {
  console.error('未知检查段: ' + unknown.join(', ') + '（可用: ' + [...byId.keys()].join(',') + '）');
  process.exit(64);
}

// 顺序由 config/manifest.json 的 categories 决定；manifest 里没有的段兜底追加到末尾
const manifestOrder = ((ctx.manifest.categories || []).map((c) => String(c.id)));
const ordered = manifestOrder.map((id) => byId.get(id)).filter(Boolean);
for (const m of CHECKS) if (!manifestOrder.includes(m.id)) ordered.push(m);

let todo = only.length ? ordered.filter((m) => only.includes(m.id)) : ordered;
if (noSelfcheck) todo = todo.filter((m) => m.id !== 'M');

say('');
say('=== dsh-env-bootstrap · verify ===');
say('时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
say('主机: ' + os.hostname() + ' / ' + os.platform() + ' ' + os.arch());

// 并行跑（ctx 的探测在 createContext 里已 memo，PowerShell 快照也只取一次），
// 但严格按 manifest 顺序输出——否则报告读起来会跳。
const settled = await Promise.allSettled(todo.map((m) => m.check(ctx)));

const results = [];
for (let i = 0; i < todo.length; i++) {
  const mod = todo[i];
  const st = settled[i];
  let res;
  if (st.status === 'fulfilled') {
    res = st.value;
  } else {
    // 一段炸了不该吞掉整份报告，但也不能当没事发生
    res = [bad('检查段崩了: ' + String((st.reason && st.reason.message) || st.reason).slice(0, 120))];
  }
  say('');
  say('--- ' + mod.id + '. ' + mod.title + ' ---');
  for (const r of res) say(line(r));
  results.push(...stamp(mod.id, res));
}

const c = counts(results);
const s = summary(c);

if (json) {
  process.stdout.write(JSON.stringify({
    tool: 'dsh-env-bootstrap/verify',
    version: 1,
    host: os.hostname(),
    platform: os.platform() + ' ' + os.arch(),
    ts: new Date().toISOString(),
    workspace: ctx.WS || null,
    dshRoot: ctx.DSH_ROOT || null,
    counts: c,
    exitCode: s.code,
    results: results.map((r) => ({ segment: r.id, level: r.level, message: r.message, fix: r.fix || undefined })),
  }, null, 2));
  process.exit(s.code);
}

console.log('');
console.log('=== 汇总 ===');
console.log(s.text);
process.exit(s.code);
