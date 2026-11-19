import { test } from 'node:test';
import assert from 'node:assert';
import { resolveWorkspace } from '../scripts/lib/paths.js';
import { readSource, BOOTSTRAP } from './_helpers.mjs';

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
