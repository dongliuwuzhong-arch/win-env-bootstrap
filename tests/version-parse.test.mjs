// tests/version-parse.test.mjs
// 版本号解析：v24.22.1 → 24，Python 3.12.10 → 3.12
//
// 覆盖的历史 bug：
//  ① Microsoft Store 的 python 桩被当成「已安装」（bootstrap.ps1:51-54 的注释就是这条的墓志铭）。
//     桩的行为：exit 9009 + stderr 一段 "Python was not found; run without arguments to install
//     from the Microsoft Store..."。早先不看退出码、把 stderr 一起收，于是桩被判定成已安装，
//     还把那段报错原文当版本号打了出来。
//     修法两层：lib/run.js 只认 stdout（桩的 stdout 是空的 → null），
//     A 段拿不到 3.x 就报「Python 未找到」。
//  ② 浮点解析陷阱：parseFloat('3.12.0') === 3.12，跟阈值 12 一比就挂；
//     parseInt('v24.22.1') === NaN，Node 24 会被误报成「需要 24+」。
//     a-core-runtime.js 用 parseInt + 正则切，两个坑都绕开了 ——
//     下面 3.12.0 那条就是判别用例：换成 parseFloat 立刻从 ok 掉成 warn。
//
// 行为测试：真跑 checks/a-core-runtime.js，只把 ctx 换成假的。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, fakeCoreCtx, SCRIPTS } from './_helpers.mjs';
import { check as coreCheck } from '../scripts/checks/a-core-runtime.js';

const CORE_SRC = readSource(path.join(SCRIPTS, 'checks', 'a-core-runtime.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'config', 'manifest.json'), 'utf8'));
const nodeTool = manifest.tools.find((t) => t.name === 'node');
const pyTool = manifest.tools.find((t) => t.name === 'python');

const pyLine = (res) => res.find((r) => r.message.includes('Python'));
const nodeLine = (res) => res.find((r) => r.message.includes('Node '));

test('python 3.12.0 判过 —— parseFloat 会在这里挂（bug②）', async () => {
  const r = pyLine(await coreCheck(fakeCoreCtx({ pythonVersion: 'Python 3.12.0' })));
  assert.equal(r.level, 'ok', 'parseFloat(3.12) >= 12 是 false，用浮点解析就会误报');
});

test('python 3.12.10 判过，原文照打', async () => {
  const r = pyLine(await coreCheck(fakeCoreCtx({ pythonVersion: 'Python 3.12.10' })));
  assert.equal(r.level, 'ok');
  assert.match(r.message, /Python 3\.12\.10/);
});

test('python 3.9.13 只提醒，不算硬缺口', async () => {
  const r = pyLine(await coreCheck(fakeCoreCtx({ pythonVersion: 'Python 3.9.13' })));
  assert.equal(r.level, 'warn');
  assert.match(r.message, /3\.9\.13/);
});

test('python 3.10.11 读成 minor 10，不是 3.1（bug②）', async () => {
  const r = pyLine(await coreCheck(fakeCoreCtx({ pythonVersion: 'Python 3.10.11' })));
  assert.equal(r.level, 'warn', 'minor 10 < 12，应该只提醒');
  assert.match(r.message, /3\.10\.11/);
});

test('拿不到 python 版本 → 硬缺口 + winget 修法（bug①）', async () => {
  const r = pyLine(await coreCheck(fakeCoreCtx({ pythonVersion: null })));
  assert.equal(r.level, 'bad');
  assert.match(r.message, /Python 未找到/);
  assert.equal(r.fixable, true);
  assert.match(r.fix, /Python\.Python/);
});

test('Store 桩的报错原文绝不能变成「已安装」（bug①）', async () => {
  // lib/run.js 只认 stdout，桩的 stdout 是空的 → null；这里直接喂桩原文，也不能判过
  const stub = 'Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Manage App Execution Aliases.';
  const r = pyLine(await coreCheck(fakeCoreCtx({ pythonVersion: stub })));
  assert.notEqual(r.level, 'ok', '桩的报错原文被当成了版本号');
});

test('当前 Node 版本按 minMajor 判定，输出里带版本号', async () => {
  const r = nodeLine(await coreCheck(fakeCoreCtx()));
  assert.ok(r, '没有 Node 结论行');
  assert.equal(r.level, Number(process.versions.node.split('.')[0]) >= nodeTool.minMajor ? 'ok' : 'bad');
  assert.match(r.message, /Node v\d+\./);
});

test('锚点: A 段用 parseInt 切版本，不用 parseFloat（bug②没回退）', () => {
  assert.ok(CORE_SRC.includes("parseInt(nodeV.replace('v', '').split('.')[0], 10)"), 'Node 版本解析被换成别的写法了');
  assert.ok(CORE_SRC.includes('parseInt(m[1], 10)'), 'Python 版本解析被换成别的写法了');
  assert.ok(!CORE_SRC.includes('parseFloat'), 'a-core-runtime.js 开始用 parseFloat 解析版本，3.12 会判挂');
});

test('锚点: 阈值与 manifest 一致（node 24 / python 12）', () => {
  assert.equal(nodeTool.minMajor, 24);
  assert.equal(pyTool.minMinor, 12);
  assert.ok(CORE_SRC.includes('nodeMajor >= ' + nodeTool.minMajor), 'A 段的 node 阈值和 manifest.minMajor 对不上');
  assert.ok(CORE_SRC.includes('>= ' + pyTool.minMinor), 'A 段的 python 阈值和 manifest.minMinor 对不上');
});
