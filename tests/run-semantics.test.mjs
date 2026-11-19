// tests/run-semantics.test.mjs
// run() 的 ENOENT vs 非零退出语义（scripts/lib/run.js）
//
// 覆盖的历史 bug：
//  ① Microsoft Store 的 python 桩被当成「已安装」（bootstrap.ps1:51-54 注释里的那条）。
//     桩：exit 9009 + stderr 一段 "Python was not found..."。早先不看退出码、把 stderr 一起收，
//     于是桩被判定成已安装，版本号打出那段报错原文。
//     契约：stderr 永远不能变成版本号；非零退出且 stdout 为空 = 拿不到版本 = null。
//  ② 「装了但非零退出」被误报成「未安装」（lib/run.js 里的注释）。
//     有的工具版本横幅走 stdout 却返回非零；这类必须当拿到了输出处理，
//     否则一个装好的工具会被判成缺失，然后被 winget 重装一遍。
//
// 这里 import 的是真模块，不是复制出来的逻辑。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { run, exists, firstExisting, memo } from '../scripts/lib/run.js';
import { readSource, codeOnly, SCRIPTS } from './_helpers.mjs';

const RUN_SRC = readSource(path.join(SCRIPTS, 'lib', 'run.js'));

test('ENOENT：程序真的不存在 → null', () => {
  assert.equal(run('dsh-no-such-binary-xyz-0001', ['--version']), null);
});

test('非零退出但有 stdout → 当拿到了输出（bug②）', () => {
  const out = run(process.execPath, ['-e', 'console.log("v1.2.3"); process.exit(1)']);
  assert.equal(out, 'v1.2.3', '装好的工具 --version 返回非零时不能被判成未安装');
});

test('非零退出且 stdout 为空 → null', () => {
  assert.equal(run(process.execPath, ['-e', 'process.exit(9009)']), null);
});

test('Store 桩的形态：stderr 有报错、stdout 空 → null，报错原文绝不能当版本号（bug①）', () => {
  const stub = 'console.error("Python was not found; run without arguments to install from the Microsoft Store"); process.exit(9009)';
  assert.equal(run(process.execPath, ['-e', stub]), null);
});

test('正常路径：输出两端的空白被 trim 掉', () => {
  const out = run(process.execPath, ['-e', 'console.log("  Python 3.12.10  ")']);
  assert.equal(out, 'Python 3.12.10');
});

test('真实 node --version 能被拿到', () => {
  assert.match(run(process.execPath, ['--version']), /^v\d+\./);
});

test('超时也算拿不到，不是崩溃', () => {
  const out = run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 300 });
  assert.equal(out, null);
});

test('exists / firstExisting：第一个存在的候选', () => {
  const real = path.join(SCRIPTS, 'verify.mjs');
  assert.equal(exists(real), true);
  assert.equal(exists(path.join(SCRIPTS, 'nope-xyz.mjs')), false);
  assert.equal(firstExisting([path.join(SCRIPTS, 'nope-xyz.mjs'), real]), real);
  assert.equal(firstExisting([path.join(SCRIPTS, 'nope-xyz.mjs')]), null);
});

test('memo：同一个查询只真跑一次', () => {
  let calls = 0;
  const probe = memo(() => { calls++; return 'v' + calls; });
  assert.equal(probe(), 'v1');
  assert.equal(probe(), 'v1');
  assert.equal(calls, 1);
});

test('锚点: run() 仍把 ENOENT/EACCES 单独判掉、只读 e.stdout（bug①②没回退）', () => {
  assert.ok(RUN_SRC.includes("e.code === 'ENOENT'"), '不再区分 ENOENT —— 装了但报错的工具会被判成未安装');
  assert.ok(RUN_SRC.includes("e.code === 'EACCES'"), '不再区分 EACCES');
  assert.ok(RUN_SRC.includes("((e && e.stdout) || '').trim()"), '不再读 e.stdout —— 非零退出的版本横幅会丢');
  const body = RUN_SRC.slice(RUN_SRC.indexOf('export function run('), RUN_SRC.indexOf('export function runNode('));
  assert.ok(body.length > 100, 'run() 函数体没截出来，锚点失效');
  assert.ok(!codeOnly(body, 'js').includes('stderr'), 'run() 开始拿 stderr 当输出，Store 桩会再次被当成已安装');
});
