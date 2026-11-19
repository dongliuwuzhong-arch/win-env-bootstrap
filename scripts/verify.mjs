#!/usr/bin/env node
/**
 * win-env-bootstrap / verify.mjs —— 装载器
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
  // --jsonl：流式输出，每段完成吐一行 {type:'segment'}，最后一行 {type:'done',...}。
  // MCP 拿它发进度通知（240s 的 M 段不再无反馈），模式下段是串行跑的。
  const jsonl = argv.slice(2).includes('--jsonl');
  // --profile=core|dsh：显式启用模块，覆盖自动探测（审计二审 5.2）
  let profile = '';
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--profile=(.*)$/);
    if (m) profile = m[1];
  }
  return { only, noSelfcheck, json, jsonl, profile };
}

const { only, noSelfcheck, json, jsonl, profile } = parseArgs(process.argv);
const ctx = createContext({ profile });
// --json/--jsonl 时把所有人类可读输出静音，只吐机器可读行
const say = (json || jsonl) ? () => {} : console.log;

const byId = new Map(CHECKS.map((m) => [m.id, m]));
const unknown = only.filter((id) => !byId.has(id));
if (unknown.length) {
  console.error('未知检查段: ' + unknown.join(', ') + '（可用: ' + [...byId.keys()].join(',') + '）');
  process.exit(64);
}
// --only= 空值是用法错误，不许静默退化成全量跑（break-it 露馅①）
const onlyRaw = process.argv.slice(2).filter((a) => a.startsWith('--only='));
if (onlyRaw.length && !only.length) {
  console.error('--only 需要至少一个段 id（如 --only=A,G2）');
  process.exit(64);
}
// 仅支持 Windows：别的平台不是「一片红」的问题，是根本不该跑（审计 R-2）
if (process.platform !== 'win32') {
  console.error('win-env-bootstrap 仅支持 Windows（当前平台: ' + process.platform + '）');
  process.exit(64);
}

// 顺序由 config/manifest.json 的 categories 决定；manifest 里没有的段兜底追加到末尾
const manifestOrder = ((ctx.manifest.categories || []).map((c) => String(c.id)));
const ordered = manifestOrder.map((id) => byId.get(id)).filter(Boolean);
for (const m of CHECKS) if (!manifestOrder.includes(m.id)) ordered.push(m);

let moduleNote = '';
// 显式 --only 优先于模块过滤（点名了就跑）；否则按启用模块收窄——
// 非 DSH 用户不再被 G/G2 红条刷屏，退出码也不被专属段污染（审计二审 5.2）
let todo;
if (only.length) {
  todo = ordered.filter((m) => only.includes(m.id));
} else {
  const enabled = new Set(ctx.modules);
  const skipped = ordered.filter((m) => !enabled.has(String(((ctx.manifest.categories || []).find((c) => String(c.id) === m.id) || {}).module || 'core')));
  todo = ordered.filter((m) => !skipped.includes(m));
  if (skipped.length) moduleNote = '未启用的专属段已跳过（' + skipped.map((m) => m.id).join(',') + '）—— ' + (ctx.hasDsh ? '' : '未检测到 DSH 环境，') + '可用 --profile=dsh 显式开启';
}
if (noSelfcheck) todo = todo.filter((m) => m.id !== 'M');

say('');
say('=== win-env-bootstrap · verify ===');
say('时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
say('主机: ' + os.hostname() + ' / ' + os.platform() + ' ' + os.arch());
if (moduleNote) say(moduleNote);

// 并行跑（ctx 的探测在 createContext 里已 memo，PowerShell 快照也只取一次），
// 按 manifest 顺序流式刷出：某段完成且它之前的段都已刷出时立刻打印——
// M 段 240s 不再让整个屏幕静默（审计 P1-1）。--jsonl 串行跑，逐段吐进度行。
const results = [];
const t0 = new Array(todo.length);
function render(i, st) {
  const mod = todo[i];
  let res;
  if (st.status === 'fulfilled') {
    res = st.value;
  } else {
    // 一段炸了不该吞掉整份报告，但也不能当没事发生
    res = [bad('检查段崩了: ' + String((st.reason && st.reason.message) || st.reason).slice(0, 120))];
  }
  if (jsonl) {
    // 崩溃段要如实报 hard:1（done 载荷里有「检查段崩了」bad 条），不许进度行装全绿（code-audit #6）
    const crashed = st.status !== 'fulfilled';
    const res0 = crashed ? [] : res;
    process.stdout.write(JSON.stringify({
      type: 'segment', id: mod.id, ...(crashed ? { crashed: true } : {}),
      hard: crashed ? 1 : res0.filter((r) => r.level === 'bad').length,
      soft: res0.filter((r) => r.level === 'warn').length,
    }) + '\n');
  } else {
    say('');
    say('--- ' + mod.id + '. ' + mod.title + '（' + Math.round((Date.now() - t0[i]) / 1000) + 's）---');
    for (const r of res) say(line(r));
  }
  results.push(...stamp(mod.id, res));
}

if (jsonl) {
  for (let i = 0; i < todo.length; i++) {
    t0[i] = Date.now();
    const st = await todo[i].check(ctx).then((v) => ({ status: 'fulfilled', value: v }), (e) => ({ status: 'rejected', reason: e }));
    render(i, st);
  }
} else {
  const slots = new Array(todo.length).fill(undefined);
  const announced = new Array(todo.length).fill(false);
  let next = 0;
  const flush = () => {
    while (next < todo.length && slots[next] !== undefined) {
      render(next, slots[next]);
      next++;
    }
    // 卡段反馈：排在队首还没好的那段，说一声在等谁（长耗时段不再无声）
    if (next < todo.length && !announced[next]) {
      announced[next] = true;
      const w = todo[next];
      say('');
      say('... 等待 ' + w.id + '. ' + w.title + '（长耗时段，最长约 240s）');
    }
  };
  await Promise.all(todo.map((m, i) => {
    t0[i] = Date.now();
    return m.check(ctx).then(
      (v) => { slots[i] = { status: 'fulfilled', value: v }; flush(); },
      (e) => { slots[i] = { status: 'rejected', reason: e }; flush(); }
    );
  }));
}

const c = counts(results);
const s = summary(c);

if (json || jsonl) {
  const payload = {
    tool: 'win-env-bootstrap/verify',
    version: 1,
    host: os.hostname(),
    platform: os.platform() + ' ' + os.arch(),
    ts: new Date().toISOString(),
    workspace: ctx.WS || null,
    dshRoot: ctx.DSH_ROOT || null,
    counts: c,
    exitCode: s.code,
    results: results.map((r) => ({ segment: r.id, level: r.level, message: r.message, fix: r.fix || undefined })),
  };
  if (jsonl) process.stdout.write(JSON.stringify({ type: 'done', ...payload }) + '\n');
  else process.stdout.write(JSON.stringify(payload, null, 2));
  process.exit(s.code);
}

console.log('');
console.log('=== 汇总 ===');
console.log(s.text);
process.exit(s.code);
