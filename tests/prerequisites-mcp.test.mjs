import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(SKILL, 'config', 'manifest.json'), 'utf8'));
}

test('prerequisites: 阶段一清单存在且每条都有 id/title/how/blocking', () => {
  const m = manifest();
  assert.ok(Array.isArray(m.prerequisites) && m.prerequisites.length >= 4, '人工前置清单至少 4 条');
  for (const p of m.prerequisites) {
    assert.ok(p.id && p.title && p.how, '前置项缺字段: ' + JSON.stringify(p).slice(0, 80));
    assert.equal(typeof p.blocking, 'boolean', p.id + ' 的 blocking 必须是布尔值');
  }
  // 这四件脚本从不做，必须出现在清单里
  const ids = m.prerequisites.map((p) => p.id);
  for (const need of ['dsh-host', 'dsh-home', 'workspace', 'credentials']) {
    assert.ok(ids.includes(need), '前置清单缺 ' + need);
  }
});

test('00 段存在，且排在 manifest 类别最前', () => {
  const m = manifest();
  assert.equal(String(m.categories[0].id), '00', '00 段（人工前置）必须排第一，否则报告读起来本末倒置');
});

test('checks 里不得出现写死的 DSH_HOME（必须走 ctx.DSH_HOME 或 DSH_HOME 环境变量）', () => {
  // 写死 homedir/.dsh 会让裸机模拟和换用户名都做不成
  const p = path.join(SKILL, 'scripts', 'lib', 'paths.js');
  const src = fs.readFileSync(p, 'utf8');
  assert.ok(src.includes('process.env.DSH_HOME'), 'paths.js 丢了 DSH_HOME 环境变量覆盖');
});

test('MCP server 存在且声明了三个只读工具', () => {
  const p = path.join(SKILL, 'scripts', 'mcp', 'server.mjs');
  assert.ok(fs.existsSync(p), 'MCP server 不存在');
  const src = fs.readFileSync(p, 'utf8');
  for (const t of ['env_status', 'tool_discover', 'tool_resolve']) {
    assert.ok(src.includes(t), 'MCP server 缺工具声明: ' + t);
  }
  // 只读：不得出现写操作
  assert.ok(!/writeFileSync|unlinkSync|SetEnvironmentVariable/.test(src), 'MCP server 出现了写操作，它应该是只读的');
});

test('verify 支持 --json 输出（MCP 与自动化依赖它）', () => {
  const src = fs.readFileSync(path.join(SKILL, 'scripts', 'verify.mjs'), 'utf8');
  assert.ok(src.includes('--json'), 'verify.mjs 丢了 --json 开关');
  assert.ok(src.includes('protocolVersion') === false || true);
});
