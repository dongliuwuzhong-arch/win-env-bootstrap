import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check as p0 } from '../scripts/checks/00-prerequisites.js';

// 凭据三态（审计 N8 回归）：注释模板里就写着 key 名——「文件在」不许算「key 在」。
function credCtx(tmp) {
  return {
    DSH_HOME: tmp,
    WS: 'x',
    DSH_ROOT: null,
    manifest: {
      prerequisites: [{ id: 'credentials', title: '填 .credentials.yaml', blocking: true, why: '', how: '' }],
      credentials: { requiredKeys: ['OPENCODE_GO_API_KEY'] },
    },
    exists: (p) => fs.existsSync(p),
    pathJoin: path.join,
  };
}

async function credState(content) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-'));
  fs.writeFileSync(path.join(tmp, '.credentials.yaml'), content);
  try {
    const out = await p0(credCtx(tmp));
    const line = out.find((r) => r.message.includes('.credentials.yaml'));
    return line ? line.level : null;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('空凭据文件：bad', async () => {
  assert.equal(await credState(''), 'bad');
});

test('纯注释模板（含 key 名字样）不许假绿：bad（审计 N8 的靶心）', async () => {
  assert.equal(await credState('# OPENCODE_GO_API_KEY=填这里\n# 只有注释，没有任何值\n'), 'bad');
});

test('真实 key 有值才算 ok', async () => {
  assert.equal(await credState('OPENCODE_GO_API_KEY: sk-real-value\n'), 'ok');
});