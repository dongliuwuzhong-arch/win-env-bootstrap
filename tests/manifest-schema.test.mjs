// tests/manifest-schema.test.mjs
// config/manifest.json 的 schema + 它与实现的一致性
//
// 覆盖的历史 bug / 风险：
//  ① manifest.json 的 note 写着「单一配置源：两个脚本都从这里读工具清单、类别、路径候选」。
//     改造前实测：两个脚本里 manifest 出现 0 次，各自写死了一份。改造后 lib/paths.js 才真读它。
//     所以下面的交叉校验不是形式主义 —— 它是唯一能发现「改了一边没改另一边」的地方。
//  ② 类别编号必须与 checks/*.js 的 id 一一对应且顺序一致。漏掉一段（比如 G2 或 P）意味着
//     报告里少一块，而退出码照样 0 —— 静默少查。
//  ③ exitCodes 必须和 lib/report.js 的 exitCode() 一致，否则 CI / smoke 里断言的退出码没意义。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, MANIFEST, SCRIPTS } from './_helpers.mjs';
import { loadManifest } from '../scripts/lib/paths.js';
import { exitCode } from '../scripts/lib/report.js';

import * as A from '../scripts/checks/a-core-runtime.js';
import * as B from '../scripts/checks/b-archive.js';
import * as C from '../scripts/checks/c-media.js';
import * as D from '../scripts/checks/d-browser.js';
import * as E from '../scripts/checks/e-reverse.js';
import * as F from '../scripts/checks/f-python-packages.js';
import * as G from '../scripts/checks/g-dsh-core.js';
import * as G2 from '../scripts/checks/g2-plugin-prereq.js';
import * as H from '../scripts/checks/h-workspace.js';
import * as I from '../scripts/checks/i-system-config.js';
import * as J from '../scripts/checks/j-network.js';
import * as K from '../scripts/checks/k-autostart.js';
import * as L from '../scripts/checks/l-script-runnability.js';
import * as M from '../scripts/checks/m-selfcheck.js';
import * as N from '../scripts/checks/n-skill-optional-deps.js';
import * as O from '../scripts/checks/o-system-env.js';
import * as P from '../scripts/checks/p-integrity-migration.js';

const CHECKS = [A, B, C, D, E, F, G, G2, H, I, J, K, L, M, N, O, P];
const EXPECTED_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'G2', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];

const raw = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(raw);

test('能解析成 JSON 且顶层字段齐', () => {
  for (const k of ['version', 'generated', 'workspace', 'dsh', 'exitCodes', 'categories', 'tools', 'workspaceDirs', 'personaFiles']) {
    assert.ok(k in manifest, '缺顶层字段: ' + k);
  }
  assert.equal(manifest.version, 1);
  assert.match(manifest.generated, /^\d{4}-\d{2}-\d{2}$/);
});

test('loadManifest() 读到的就是文件本身（兜底 FALLBACK 没被触发）', () => {
  assert.deepEqual(loadManifest(), manifest, 'loadManifest 落到兜底了 —— manifest 读不进来');
});

test('类别正好 17 个，编号与顺序固定', () => {
  assert.equal(manifest.categories.length, 17);
  assert.deepEqual(manifest.categories.map((c) => c.id), EXPECTED_IDS);
});

test('类别 id 不重复，且 id / name / desc 都非空', () => {
  const ids = manifest.categories.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, '类别 id 有重复');
  for (const c of manifest.categories) {
    assert.ok(typeof c.id === 'string' && c.id.trim(), '类别缺 id');
    assert.ok(typeof c.name === 'string' && c.name.trim(), '类别 ' + c.id + ' 缺 name');
    assert.ok(typeof c.desc === 'string' && c.desc.trim(), '类别 ' + c.id + ' 缺 desc');
  }
});

test('checks/*.js 的 id 与 manifest 类别一一对应且同序（bug②）', () => {
  assert.deepEqual(CHECKS.map((m) => m.id), manifest.categories.map((c) => c.id));
});

test('每个检查段都导出可用的 check() 和非空 title', () => {
  for (const mod of CHECKS) {
    assert.equal(typeof mod.check, 'function', mod.id + ' 没有导出 check()');
    assert.ok(typeof mod.title === 'string' && mod.title.trim(), mod.id + ' 没有 title');
  }
});

test('tools: 每条都有 name / optional / versionArgs，且 name 不重复', () => {
  assert.ok(Array.isArray(manifest.tools) && manifest.tools.length > 0);
  for (const t of manifest.tools) {
    assert.ok(typeof t.name === 'string' && t.name.trim(), '工具缺 name');
    assert.equal(typeof t.optional, 'boolean', t.name + ' 的 optional 必须是布尔值');
    // probeCmd/probeArgs 是 bootstrap 实际消费的字段；versionArgs 是旧名，两个都认。
    // npm 包（puppeteer）没有命令行探测，靠目录存在性判断，跳过这一项。
    if (t.npm) continue;
    const args = t.probeArgs ?? t.versionArgs;
    assert.ok(Array.isArray(args), t.name + ' 的 probeArgs（或 versionArgs）必须是数组');
    assert.ok(args.every((a) => typeof a === 'string'), t.name + ' 的 probeArgs 里有非字符串');
  }
  const names = manifest.tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, '工具名有重复');
});

test('tools: minMajor / minMinor 出现时必须是数字', () => {
  for (const t of manifest.tools) {
    for (const k of ['minMajor', 'minMinor']) {
      if (k in t) assert.equal(typeof t[k], 'number', t.name + '.' + k + ' 必须是数字');
    }
  }
});

test('tools: node 与 python 是必需项，阈值 24 / 12', () => {
  const node = manifest.tools.find((t) => t.name === 'node');
  const py = manifest.tools.find((t) => t.name === 'python');
  assert.equal(node.optional, false);
  assert.equal(py.optional, false);
  assert.equal(node.minMajor, 24);
  assert.equal(py.minMinor, 12);
});

test('exitCodes 与 lib/report.js 的 exitCode() 完全一致（bug③）', () => {
  assert.deepEqual(manifest.exitCodes, { ok: 0, hardGap: 1, warningOnly: 2 });
  assert.equal(exitCode({ hard: 0, soft: 0 }), manifest.exitCodes.ok);
  assert.equal(exitCode({ hard: 1, soft: 0 }), manifest.exitCodes.hardGap);
  assert.equal(exitCode({ hard: 0, soft: 1 }), manifest.exitCodes.warningOnly);
  assert.equal(exitCode({ hard: 2, soft: 3 }), manifest.exitCodes.hardGap, '硬缺口优先于提醒');
});

test('dsh.rootCandidates 与 lib/paths.js 兜底、bootstrap.ps1 三处一致', () => {
  const boot = readSource(path.join(SCRIPTS, 'bootstrap.ps1'));
  const pathsSrc = readSource(path.join(SCRIPTS, 'lib', 'paths.js'));
  assert.ok(Array.isArray(manifest.dsh.rootCandidates) && manifest.dsh.rootCandidates.length >= 1);
  for (const c of manifest.dsh.rootCandidates) {
    assert.ok(boot.includes(c), 'bootstrap.ps1 里没有候选根 ' + c);
    assert.ok(pathsSrc.includes(c.replace(/\\/g, '\\\\')), 'lib/paths.js 的兜底里没有候选根 ' + c);
  }
});

test('g2 清单在 bootstrap.ps1 里逐个出现（改 manifest 不改脚本会被抓到）', () => {
  const boot = readSource(path.join(SCRIPTS, 'bootstrap.ps1'));
  assert.equal(manifest.g2.manualPackages.length, 5);
  // localPlugins 是使用者自己的东西，公开仓库默认留空。
  // 只要求它是数组，不要求有具体几个——否则就把别人的插件清单写死了。
  assert.ok(Array.isArray(manifest.g2.localPlugins));
  for (const p of [...manifest.g2.manualPackages, ...manifest.g2.localPlugins]) {
    assert.ok(boot.includes(p), 'bootstrap.ps1 里没有 G2 包/插件: ' + p);
  }
});

test('workspaceDirs: 非空、无重复', () => {
  assert.ok(Array.isArray(manifest.workspaceDirs) && manifest.workspaceDirs.length > 0);
  assert.ok(manifest.workspaceDirs.every((d) => typeof d === 'string' && d.trim()));
  assert.equal(new Set(manifest.workspaceDirs).size, manifest.workspaceDirs.length, 'workspaceDirs 有重复');
});

test('personaFiles 正好是人格四件套', () => {
  assert.deepEqual(manifest.personaFiles, ['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md']);
});

test('workspace.default 与 env 名字存在（迁移时要靠它）', () => {
  assert.equal(typeof manifest.workspace.default, 'string');
  assert.match(manifest.workspace.env, /^DSH_[A-Z_]+$/);
});
