// tests/path-normalize.test.mjs
// PATH 去重归一化（大小写 / 尾部反斜杠 / 空条目）
//
// 覆盖的历史 bug：
//  ① 「-split 标量陷阱」（bootstrap.ps1:95-103）
//     PATH 只有一条时 -split 返回标量 String，($parts + $dir) 走字符串拼接，
//     整条 PATH 变成 "C:\\AAAC:\\BBB" —— 用户 PATH 当场毁掉。修法是在外面套 @()。
//     这一段是 PowerShell，JS 导不进来：JS 侧只做契约复现（appendPath），
//     PowerShell 侧的真实语义由 tests/powershell-traps.test.mjs 拉真进程验证。
//  ② 归一化漏项（checks/i-system-config.js 的重复判定）
//     早先直接比原始字符串，"C:\\7-Zip\\" 与 "C:\\7-Zip" 被算成两条，
//     "C:\\Windows" 和 "c:\\windows" 也漏 —— 重复项永远报不出来。
//  ③ 空条目（;; 或纯空白）必须先丢掉，否则重复计数虚高。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, fakeSystemCtx, BOOTSTRAP } from './_helpers.mjs';
import { check as systemConfigCheck } from '../scripts/checks/i-system-config.js';

// 真跑 I 段，只把 process.env.Path 换掉。改完必须还原，别污染同文件后续用例。
async function pathResults(pathValue) {
  const saved = process.env.Path;
  try {
    process.env.Path = pathValue;
    return await systemConfigCheck(fakeSystemCtx());
  } finally {
    if (saved === undefined) delete process.env.Path;
    else process.env.Path = saved;
  }
}
const dupLines = (res) => res.filter((r) => r.message.includes('PATH 重复'));
const cleanLine = (res) => res.find((r) => r.message.includes('进程 PATH 无重复项'));

test('归一化：大小写 + 尾部反斜杠折叠成一个重复项（bug②）', async () => {
  const res = await pathResults('C:\\AAA;c:\\aaa\\;C:\\BBB');
  const dups = dupLines(res);
  assert.equal(dups.length, 1, '大小写/尾部反斜杠不同的同一目录必须算重复');
  assert.match(dups[0].message, /重复 2 次/);
  assert.match(dups[0].message, /c:\\aaa/);
});

test('归一化：正斜杠结尾也折叠', async () => {
  assert.equal(dupLines(await pathResults('C:\\AAA;C:\\AAA/')).length, 1);
});

test('真正不同的条目不算重复', async () => {
  const res = await pathResults('C:\\AAA;C:\\BBB');
  assert.equal(dupLines(res).length, 0);
  assert.ok(cleanLine(res), '没有重复时必须报 ok');
});

test('空条目与纯空白条目被忽略（bug③）', async () => {
  const res = await pathResults('C:\\AAA;;;  ;C:\\BBB;');
  assert.equal(dupLines(res).length, 0, '空条目不能被算成重复');
  assert.ok(cleanLine(res));
});

test('空条目夹着真重复时仍然只报真重复（bug③）', async () => {
  const dups = dupLines(await pathResults('C:\\AAA;;C:\\AAA;'));
  assert.equal(dups.length, 1);
  assert.match(dups[0].message, /重复 2 次/);
});

test('单条目 PATH 不会崩，也不会误报重复（bug①的 JS 侧对照）', async () => {
  const res = await pathResults('C:\\AAA');
  assert.equal(dupLines(res).length, 0);
  assert.ok(cleanLine(res));
});

test('空 PATH 不会崩', async () => {
  const res = await pathResults('');
  assert.equal(dupLines(res).length, 0);
});

// ---- PowerShell 侧契约复现：bootstrap.ps1:98-103 的追加逻辑 ----
function splitEntries(p) {
  return String(p ?? '').split(';').filter(Boolean);
}
function pathKey(entry) {
  return entry.trim().replace(/[\\/]+$/, '').toLowerCase();
}
function appendPath(p, dir) {
  const parts = splitEntries(p);
  const key = pathKey(dir);
  for (const e of parts) if (pathKey(e) === key) return p;
  return [...parts, dir].join(';');
}

test('appendPath: 单条目 PATH 不能被拼成一坨（bug①）', () => {
  assert.equal(appendPath('C:\\AAA', 'C:\\BBB'), 'C:\\AAA;C:\\BBB');
});

test('appendPath: 已在 PATH 里（仅大小写/尾部反斜杠不同）就不重复加（bug②）', () => {
  assert.equal(appendPath('C:\\Software\\7-Zip', 'c:\\software\\7-zip\\'), 'C:\\Software\\7-Zip');
});

test('appendPath: 空 PATH 直接就是新条目', () => {
  assert.equal(appendPath('', 'C:\\BBB'), 'C:\\BBB');
});

test('appendPath: 多条目时保序追加', () => {
  assert.equal(appendPath('C:\\a;C:\\b', 'C:\\c'), 'C:\\a;C:\\b;C:\\c');
});

test('锚点: bootstrap.ps1 的 PATH 追加仍套着 @()（bug①没回退）', () => {
  const src = readSource(BOOTSTRAP);
  assert.ok(src.includes("$parts = @($p -split ';'"), 'bootstrap.ps1 的 $parts 不再套 @()，标量陷阱回来了');
  assert.ok(src.includes("$new = (@($parts) + $dir) -join ';'"), 'bootstrap.ps1 的拼接不再先 @()，单条目 PATH 会被拼坏');
});

test('锚点: bootstrap.ps1 的 PATH 去重仍归一化大小写与尾部反斜杠（bug②没回退）', () => {
  const src = readSource(BOOTSTRAP);
  assert.ok(src.includes("$key = $dir.TrimEnd('\\').ToLower()"), 'bootstrap.ps1 的 PATH 归一化被改掉了');
});
