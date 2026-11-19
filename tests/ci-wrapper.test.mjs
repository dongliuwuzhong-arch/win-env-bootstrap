import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CI = path.join(HERE, '..', '.github', 'workflows', 'ci.yml');

// GH Actions 的 pwsh/powershell 包装器会在每个 run 步骤末尾追加
// exit $LASTEXITCODE。凡是「非 0 退出码也算合法」的步骤，脚本体必须显式
// exit 0 封尾，否则包装器把合法的 1 漏出去，断言通过也判红——2026-11-19
// 的 12 连红就是这个（审查第三轮严重 #1）。

function stepBody(src, nameMarker) {
  const i = src.indexOf(nameMarker);
  assert.ok(i >= 0, 'ci.yml 找不到步骤: ' + nameMarker);
  const rest = src.slice(i);
  const next = rest.indexOf('\n      - name:');
  return next >= 0 ? rest.slice(0, next) : rest;
}

// 判据钉在「最后一条实码行」上，不锚全文末尾——步骤尾部的注释行不算数。
function lastCodeLine(body) {
  return body.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .pop();
}

test('bootstrap -Check 步骤必须显式 exit 封尾（GH 包装器泄漏回归锚点）', () => {
  const src = fs.readFileSync(CI, 'utf8');
  const body = stepBody(src, 'bootstrap -Check');
  assert.ok(/if \(\$code -notin 0,1,2\)/.test(body), '退出码断言丢了');
  assert.equal(lastCodeLine(body), 'exit 0', '断言后必须显式 exit 0 封尾，否则包装器泄漏 bootstrap 的合法退出码');
});

test('smoke 步骤显式判定退出码，不靠包装器代劳', () => {
  const src = fs.readFileSync(CI, 'utf8');
  const body = stepBody(src, 'smoke.ps1（一键冒烟）');
  assert.ok(/if \(\$code -ne 0\)/.test(body), 'smoke 退出码判定丢了');
  assert.equal(lastCodeLine(body), 'exit 0', 'smoke 步骤也要显式封尾');
});
