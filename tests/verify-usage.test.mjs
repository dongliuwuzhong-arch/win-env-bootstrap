import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.join(HERE, '..', 'scripts', 'verify.mjs');

test('--only= 空值是用法错误 exit 64，不许静默全量跑（break-it 露馅①回归）', () => {
  const r = spawnSync(process.execPath, [VERIFY, '--only='], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 64, '空 --only 必须是用法错误');
  assert.ok(r.stderr.includes('--only'), '错误信息要指得出用法');
});

test('--jsonl --only=00,,A 只跑 2 段（空段不占名额）', () => {
  const r = spawnSync(process.execPath, [VERIFY, '--jsonl', '--only=00,,A', '--no-selfcheck'], { encoding: 'utf8', timeout: 120000 });
  const lines = r.stdout.trim().split(/\r?\n/).map((l) => JSON.parse(l));
  const segs = lines.filter((l) => l.type === 'segment');
  assert.equal(segs.length, 2, '空段不该产生进度行');
});
