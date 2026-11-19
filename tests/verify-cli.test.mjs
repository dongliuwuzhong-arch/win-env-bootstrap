// tests/verify-cli.test.mjs
// verify.mjs 的命令行契约 —— smoke.ps1 和 CI 都靠它
//
// 覆盖的历史 bug / 风险：
//  ① 退出码契约（lib/report.js:exitCode）：0 全过 / 1 有硬缺口 / 2 仅提醒。
//     早先退出码散在各段里手写，硬缺口和提醒混在一起，CI 里断 0 就等于什么都没断。
//     现在只有 lib/report.js 一处定，这里钉住它的三种取值和「硬缺口优先」。
//  ② --only 是 smoke.ps1 快段的唯一入口。它得真的只跑指定段、并且对未知段报错退出
//     （64，别跟 0/1/2 撞），否则「快段」会静默退化成全量跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fsx from 'node:fs';
import { readSource, VERIFY, SCRIPTS } from './_helpers.mjs';
import { exitCode, summary, counts } from '../scripts/lib/report.js';

function verify(args) {
  try {
    const stdout = execFileSync(process.execPath, [VERIFY, ...args], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

const segments = (out) => [...out.matchAll(/^--- ([A-Z0-9]+)\. /gm)].map((m) => m[1]);

test('退出码契约：0 / 1 / 2 三档，硬缺口优先（bug①）', () => {
  assert.equal(exitCode({ hard: 0, soft: 0 }), 0);
  assert.equal(exitCode({ hard: 0, soft: 5 }), 2);
  assert.equal(exitCode({ hard: 1, soft: 0 }), 1);
  assert.equal(exitCode({ hard: 1, soft: 9 }), 1);
});

test('counts / summary 与退出码一致', () => {
  const res = [
    { level: 'ok', message: 'a' },
    { level: 'warn', message: 'b' },
    { level: 'info', message: 'c' },
  ];
  assert.deepEqual(counts(res), { hard: 0, soft: 1 });
  assert.equal(summary(counts(res)).code, 2);
  assert.equal(summary({ hard: 1, soft: 0 }).code, 1);
  assert.equal(summary({ hard: 0, soft: 0 }).code, 0);
});

test('--only=ZZ 报未知段并退出 64，不跟 0/1/2 撞（bug②）', () => {
  const r = verify(['--only=ZZ']);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /未知检查段/);
  assert.match(r.stderr, /ZZ/);
});

test('--only=A 只跑 A 段，不跑别的（bug②）', () => {
  const r = verify(['--only=A']);
  assert.ok([0, 1, 2].includes(r.status), '退出码必须是 0/1/2，实际 ' + r.status);
  assert.deepEqual(segments(r.stdout), ['A']);
});

test('--only=A,B 跑两段且顺序跟着 manifest（bug②）', () => {
  const r = verify(['--only=A,B']);
  assert.ok([0, 1, 2].includes(r.status));
  assert.deepEqual(segments(r.stdout), ['A', 'B']);
});

test('--only 的大小写不敏感', () => {
  const r = verify(['--only=a']);
  assert.notEqual(r.status, 64, '小写 a 应该被接受');
  assert.deepEqual(segments(r.stdout), ['A']);
});

test('不给 --only 时按 manifest 的 18 段顺序全跑（太慢，只查装载器源码）', () => {
  const src = readSource(VERIFY);
  assert.ok(src.includes('const CHECKS = [P0, A, B, C, D, E, F, G, G2, H, I, J, K, L, M, N, O, P];'), '装载器的段表被改了');
  assert.ok(src.includes('ctx.manifest.categories'), '顺序不再由 manifest 决定');
});

test('装载器引用的 checks 文件都真实存在', () => {
  const src = readSource(VERIFY);
  const imports = [...src.matchAll(/from '\.\/checks\/([a-z0-9-]+\.js)'/g)].map((m) => m[1]);
  assert.equal(imports.length, 18);
  for (const f of imports) {
    assert.ok(fsx.existsSync(path.join(SCRIPTS, 'checks', f)), '缺检查段文件: ' + f);
  }
});
