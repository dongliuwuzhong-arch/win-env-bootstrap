import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
import { resolveWorkspace } from '../scripts/lib/paths.js';
import { readSource, BOOTSTRAP } from './_helpers.mjs';

function sandboxWithPyb(content) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  fs.mkdirSync(path.join(tmp, '_tools'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '_tools', 'pyb.cmd'), content);
  return tmp;
}
function hctx(tmp, home) {
  return { WS: tmp, wsIsFallback: false, HOME: home, DSH_HOME: path.join(tmp, '.dsh'), manifest: {}, exists: (p) => fs.existsSync(p), pathJoin: path.join };
}

// 2026-11-19 审查严重 #3：bootstrap.ps1 与 paths.js 曾用两套解析顺序和两个兜底值，
// 同一台机器两边结论相反。契约：参数 > 环境变量 > manifest.default > 内置兜底。

test('工作区解析顺序：参数 > 环境变量 > manifest > 兜底', () => {
  assert.equal(resolveWorkspace({ param: 'P', env: 'E', manifestDefault: 'M' }), 'P');
  assert.equal(resolveWorkspace({ env: 'E', manifestDefault: 'M' }), 'E');
  assert.equal(resolveWorkspace({ manifestDefault: 'M' }), 'M');
});

test('兜底值是 C:\\DSH空间，与 bootstrap.ps1 内置默认一致', () => {
  assert.equal(resolveWorkspace({}), 'C:\\DSH空间');
});

test('bootstrap.ps1 的内置兜底码点没变（0x7A7A 0x95F4 = 空间）', () => {
  const s = readSource(BOOTSTRAP);
  assert.ok(/'C:\\DSH' \+ \[char\]0x7A7A \+ \[char\]0x95F4/.test(s),
    'bootstrap 兜底码点变了，paths.js 的 FALLBACK 必须跟着核对');
});

test('pyb.cmd 写死异用户路径要报 bad「写死了」，坏分支不许被吞（审计 N1 回归）', async () => {
  const h = await import('../scripts/checks/h-workspace.js');
  const tmp = sandboxWithPyb('"C:\\Users\\OldUser\\tools\\pyb.exe" %*');
  try {
    const out = await h.check(hctx(tmp, 'C:\\Users\\Me'));
    const line = out.find((r) => r.message.includes('pyb.cmd'));
    assert.ok(line && line.level === 'bad' && line.message.includes('写死了'), '坏分支必须报 bad 写死了，实际: ' + JSON.stringify(line));
    assert.ok(line.message.includes('C:\\Users\\Me'), '要报出当前用户是谁');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('pyb/pys 路径比对不许前缀越界：Tom 不命中 Tommy（审计 N5 回归）', async () => {
  const h = await import('../scripts/checks/h-workspace.js');
  const tmp = sandboxWithPyb('"C:\\Users\\Tom\\tools\\pyb.exe" %*');
  try {
    const out = await h.check(hctx(tmp, 'C:\\Users\\Tommy'));
    const line = out.find((r) => r.message.includes('pyb.cmd'));
    assert.ok(line && line.level === 'bad', 'Tommy 的家不许被 Tom 前缀蒙混过关，实际: ' + JSON.stringify(line));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});


test('resolveModules：显式 profile > DSH_MODULES > 自动探测（审计二审 5.2）', async () => {
  const { resolveModules } = await import('../scripts/lib/paths.js');
  assert.deepEqual(resolveModules({ profile: 'core', hasDshInstall: true }), ['core']);
  assert.deepEqual(resolveModules({ profile: 'dsh', hasDshInstall: false }), ['core', 'dsh']);
  assert.deepEqual(resolveModules({ env: 'core', hasDshInstall: true }), ['core']);
  assert.deepEqual(resolveModules({ env: 'junk', hasDshInstall: true }), ['core', 'dsh'], '垃圾值回落自动探测');
  assert.deepEqual(resolveModules({ hasDshInstall: true }), ['core', 'dsh']);
  assert.deepEqual(resolveModules({ hasDshInstall: false }), ['core']);
});

test('core profile 不许带出 DSH 专属段（验收①：无 DSH 沙箱全量跑）', async () => {
  const { spawnSync } = await import('node:child_process');
  const verify = path.join(HERE, '..', 'scripts', 'verify.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mhome-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mws-'));
  const r = spawnSync(process.execPath, [verify, '--json', '--profile=core'], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, DSH_HOME: home, DSH_WORKSPACE: ws, DSH_MODULES: '' },
  });
  try {
    const j = JSON.parse(r.stdout);
    const segs = new Set(j.results.map((x) => x.segment));
    for (const bad of ['00', 'G', 'G2', 'H', 'L', 'M']) assert.ok(!segs.has(bad), 'core profile 不该跑 ' + bad + ' 段');
    // 「不被 DSH 段污染」的保证是段级排除（计数只来自 results）——退出码断言三档即可，
    // 裸 runner 上 core 自己就有硬缺口（没 7z），exit 1 在那里是合法的
    assert.ok([0, 1, 2].includes(j.exitCode), 'core profile 退出码必须是正常三档，实际 ' + j.exitCode);
    assert.equal(j.counts.hard, j.results.filter((x) => x.level === 'bad').length, '计数只许来自启用段');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true }); }
});

test('默认档（本机有 DSH）段集合与 manifest 全量一致（验收②：体验不降级）', async () => {
  const { spawnSync } = await import('node:child_process');
  const verify = path.join(HERE, '..', 'scripts', 'verify.mjs');
  const r = spawnSync(process.execPath, [verify, '--json', '--profile=dsh'], { encoding: 'utf8', timeout: 240000, env: process.env });
  const j = JSON.parse(r.stdout);
  const got = [...new Set(j.results.map((x) => x.segment))].sort();
  const want = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config', 'manifest.json'), 'utf8')).categories.map((c) => String(c.id)).sort();
  assert.deepEqual(got, want, 'dsh 档必须是全 18 段');
});
test('内置兜底落空时报「未配置」并指路，不是干巴巴「不存在」（审计 P2-5 回归）', async () => {
  const h = await import('../scripts/checks/h-workspace.js');
  const out = await h.check({ WS: 'C:\\不存在\\的路径', wsIsFallback: true, exists: () => false, pathJoin: (...a) => a.join('/') });
  assert.ok(out.some((r) => r.message.includes('工作区未配置')), '兜底落空要报未配置');
  assert.ok(out.some((r) => r.message.includes('DSH_WORKSPACE')), '要指路');
});

test('真路径不存在时报「不存在:」，不冒充未配置', async () => {
  const h = await import('../scripts/checks/h-workspace.js');
  const out = await h.check({ WS: 'D:\\real-but-missing', wsIsFallback: false, exists: () => false, pathJoin: (...a) => a.join('/') });
  assert.ok(out.some((r) => r.message.includes('不存在: D:\\real-but-missing')));
});

test('工作区未配置时文案是「未配置」，不再吐空路径「不存在: 」', async () => {
  const h = await import('../scripts/checks/h-workspace.js');
  const out = await h.check({ WS: '', exists: () => false, pathJoin: (...a) => a.join('/') });
  assert.ok(out.some((r) => r.message.includes('工作区未配置')), '空 WS 应报「工作区未配置」');
  assert.ok(!out.some((r) => r.message.includes('不存在')), '空 WS 不该报「不存在」');
});
