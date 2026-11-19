import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOT = path.join(HERE, '..', 'scripts', 'bootstrap.ps1');

function src() { return fs.readFileSync(BOOT, 'utf8'); }

test('gapsLeft 记账：fix 只能抵消本段缺口（严重 #1 的回归锚点）', () => {
  const s = src();
  // 无条件递减会让不相关的 fix 吃掉硬缺口，退出码虚低
  const fixLine = s.split('\n').find((l) => l.includes("'fix'") && l.includes('gapsLeft--'));
  assert.ok(fixLine, '没找到 fix 分支');
  assert.ok(
    fixLine.includes('segBase'),
    'fix 分支又在无条件递减 gapsLeft 了 —— 跨段抵消会让退出码虚低'
  );
  assert.ok(/\$script:segBase = \$script:gapsLeft/.test(s), 'head 分支没有重置 segBase');
});

test('退出码契约：bootstrap 也是 0/1/2，不是只有 0/1', () => {
  const s = src();
  assert.ok(/\$exitCode = 2/.test(s) || /warns -gt 0\) \{ \$exitCode = 2/.test(s), 'bootstrap 缺 exit 2 分支');
});

test('Install-Pkg 用显式 probeCmd，不再按 label 通配匹配（一般 #11）', () => {
  const s = src();
  assert.ok(!/switch -Wildcard \(\$label\)/.test(s), 'probe 又回到按 label 通配匹配了');
  assert.ok(/\$probeCmd/.test(s), 'Install-Pkg 没有 probeCmd 参数');
});

test('checks 里不得出现写死的宿主安装路径（严重 #2）', () => {
  const dir = path.join(HERE, '..', 'scripts', 'checks');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    // 7-Zip / WorkBuddy 这类第三方路径允许；DSH 本体必须走 ctx.DSH_ROOT
    if (/C:\\\\Software\\\\DSH|C:\\\\Program Files\\\\DSH/.test(t)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], '这些 check 又写死了 DSH 路径: ' + offenders.join(', '));
});

test('Run 键正则能匹配 wscript.exe "path"（严重 #3）', () => {
  const s = src().replace(/\$[a-zA-Z_]+/g, 'X');
  const p = path.join(HERE, '..', 'scripts', 'checks', 'p-integrity-migration.js');
  const t = fs.readFileSync(p, 'utf8');
  assert.ok(/wscript\\\.exe\\s\+/.test(t), 'Run 键正则又写成 wscript.exes+ 那种永不匹配的形式了');
});
