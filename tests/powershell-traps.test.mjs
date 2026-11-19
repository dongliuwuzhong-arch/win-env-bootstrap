// tests/powershell-traps.test.mjs
// 契约测试 · PowerShell 侧的两个历史 bug（JS 测不出来的那两个）
//
//  ① 「-split 标量陷阱」（bootstrap.ps1:95-103）
//     PATH 只有一条时 -split 返回标量 String，($parts + $dir) 走字符串拼接，
//     整条 PATH 变成 C:\AAAC:\BBB —— 用户的 PATH 当场毁掉。
//     这个 bug 只在 PowerShell 的语义里成立，JS 侧的复现（path-normalize.test.mjs）
//     证明不了它，所以这里直接拉真 PowerShell 跑一遍。
//  ② 「VBS 编码」（bootstrap.ps1:437-446）
//     开机自启的 .vbs 必须写成 UTF-16LE（-Encoding Unicode，BOM = FF FE）。
//     写成 UTF8 时 wscript 直接报 Microsoft VBScript compilation error: Invalid character，
//     启动器静默失效。脚本自己写完会回读前两个字节核对，这里断言那两个字节能对上。
//  ③ 顺带钉住「执行策略空值」的成因：$null -ne 'Undefined' 恒为真。
//     这条恒真式就是当初把空注册表值当成有效策略的原因（判定逻辑由 exec-policy.test.mjs 守）。
//
// 只跑一次 PowerShell（约 1 秒），所有探针一次取回，各 test() 分别断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readSource, BOOTSTRAP } from './_helpers.mjs';

const PS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$o = [ordered]@{}",
  "# --- 1) -split scalar trap: single-entry PATH ---",
  "$p = 'C:\\AAA'",
  "$scalar = $p -split ';' | Where-Object { $_ -ne '' }",
  "$o.scalarType = $scalar.GetType().Name",
  "$o.scalarPlus = [string]($scalar + 'C:\\BBB')",
  "$arr = @($p -split ';' | Where-Object { $_ -ne '' })",
  "$o.arrType = $arr.GetType().Name",
  "$o.arrCount = $arr.Count",
  "$o.arrJoin = (@($arr) + 'C:\\BBB') -join ';'",
  "# --- 2) multi-entry and empty PATH ---",
  "$p2 = 'C:\\AAA;C:\\BBB'",
  "$o.multiJoin = (@(@($p2 -split ';' | Where-Object { $_ -ne '' }) + 'C:\\CCC') -join ';')",
  "$p3 = ''",
  "$o.emptyCount = @($p3 -split ';' | Where-Object { $_ -ne '' }).Count",
  "$o.emptyJoin = (@(@($p3 -split ';' | Where-Object { $_ -ne '' }) + 'C:\\BBB') -join ';')",
  "# --- 3) VBS encoding: wscript needs UTF-16LE (BOM FF FE) ---",
  "$body = [string][char]39 + ' probe' + [char]13 + [char]10 + 'WScript.Echo 1'",
  "$tmpU = Join-Path $env:TEMP ('vbsu-' + [guid]::NewGuid().ToString('N') + '.vbs')",
  "Set-Content -Path $tmpU -Value $body -Encoding Unicode",
  "$bu = [System.IO.File]::ReadAllBytes($tmpU)",
  "$o.vbsUnicodeBom = ('{0:X2}{1:X2}' -f $bu[0], $bu[1])",
  "Remove-Item -LiteralPath $tmpU -Force",
  "$tmp8 = Join-Path $env:TEMP ('vbs8-' + [guid]::NewGuid().ToString('N') + '.vbs')",
  "Set-Content -Path $tmp8 -Value $body -Encoding UTF8",
  "$b8 = [System.IO.File]::ReadAllBytes($tmp8)",
  "$o.vbsUtf8Bom = ('{0:X2}{1:X2}' -f $b8[0], $b8[1])",
  "Remove-Item -LiteralPath $tmp8 -Force",
  "# --- 4) null/empty vs Undefined ---",
  "$o.nullNeUndefined = ($null -ne 'Undefined')",
  "$o.emptyNeUndefined = ('' -ne 'Undefined')",
  "$o.castNullIsEmpty = ([string]$null -eq '')",
  "$o | ConvertTo-Json -Compress",
].join('\n');

let probe = null;
let probeError = null;
try {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  probe = JSON.parse(out.trim());
} catch (e) {
  probeError = e;
}

function needProbe() {
  assert.ok(probe, 'PowerShell 探针没跑起来: ' + (probeError && probeError.message));
  return probe;
}

test('PowerShell 探针可执行', () => {
  const p = needProbe();
  assert.equal(typeof p.scalarType, 'string');
});

test('-split 标量陷阱确实存在：单条目时返回 String（bug①）', () => {
  const p = needProbe();
  assert.equal(p.scalarType, 'String', 'PowerShell 的 -split 行为变了，这个 bug 的前提要重新核');
});

test('bug① 的破坏形态：不加 @() 时字符串被拼成一坨', () => {
  const p = needProbe();
  assert.equal(p.scalarPlus, "C:\\AAAC:\\BBB", '这正是当初把 PATH 拼坏的结果');
  assert.notEqual(p.scalarPlus, "C:\\AAA;C:\\BBB");
});

test('bug① 的修法：套上 @() 后是数组，拼接得到正确 PATH', () => {
  const p = needProbe();
  assert.equal(p.arrType, 'Object[]');
  assert.equal(p.arrCount, 1);
  assert.equal(p.arrJoin, "C:\\AAA;C:\\BBB");
});

test('多条目与空 PATH 两种边界都正确', () => {
  const p = needProbe();
  assert.equal(p.multiJoin, "C:\\AAA;C:\\BBB;C:\\CCC");
  assert.equal(p.emptyCount, 0);
  assert.equal(p.emptyJoin, "C:\\BBB");
});

test('VBS 必须写成 UTF-16LE：-Encoding Unicode 产出 FF FE BOM（bug②）', () => {
  const p = needProbe();
  assert.equal(p.vbsUnicodeBom, 'FFFE', 'Set-Content -Encoding Unicode 不再是 UTF-16LE 带 BOM，VBS 编码那套要重核');
});

test('VBS 写成 UTF8 就没有 UTF-16LE BOM —— wscript 会报 Invalid character（bug②）', () => {
  const p = needProbe();
  assert.notEqual(p.vbsUtf8Bom, 'FFFE', 'UTF8 居然产出了 FF FE，这条前提不成立了');
});

test('执行策略空值的成因：$null -ne Undefined 恒为真（bug③）', () => {
  const p = needProbe();
  assert.equal(p.nullNeUndefined, true);
  assert.equal(p.emptyNeUndefined, true);
  assert.equal(p.castNullIsEmpty, true);
});

test('锚点: bootstrap.ps1 的 VBS 仍用 -Encoding Unicode 并回读字节核对（bug②没回退）', () => {
  const src = readSource(BOOTSTRAP);
  assert.ok(src.includes('Set-Content -Path $vbs -Value $vbsBody -Encoding Unicode'), 'bootstrap.ps1 不再用 UTF-16LE 写 VBS');
  assert.ok(src.includes('[System.IO.File]::ReadAllBytes($vbs)'), 'bootstrap.ps1 不再回读 VBS 字节核对');
});

test('锚点: bootstrap.ps1 的 PATH 去重仍归一化大小写与尾部反斜杠', () => {
  const src = readSource(BOOTSTRAP);
  assert.ok(src.includes("$key = $dir.TrimEnd('\\').ToLower()"), 'bootstrap.ps1 的 PATH 归一化被改掉了');
});
