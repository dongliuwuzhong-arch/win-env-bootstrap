import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PS = path.join(HERE, '..', 'tests-ps');

// PS 5.1 把无 BOM 的 UTF-8 当 ANSI 读，中文注释直接炸解析——测试文件必须带 BOM
// （2026-11-20 栽过一次：编辑动作洗掉 BOM，容器级解析失败）。锚点钉死。

test('scripts/*.ps1 必须纯 ASCII（PS 5.1 无 BOM 按 ANSI 读，中文注释炸解析）', () => {
  const dir = path.join(HERE, '..', 'scripts');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ps1'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const bad = [...s].filter((c) => c.charCodeAt(0) > 127).length;
    assert.equal(bad, 0, f + ' 有 ' + bad + ' 个非 ASCII 字符——注释必须英文（2026-11-19 tweaks.ps1 栽过）');
  }
});

test('checks 不许写死 .dsh 路径段，一律走 ctx.DSH_HOME（审计 P1-2 回归）', () => {
  const dir = path.join(HERE, '..', 'scripts', 'checks');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!s.includes("'.dsh'"), f + " 写死了 '.dsh'——必须走 ctx.DSH_HOME");
  }
});

test('g2/h 段消费 manifest 清单，不许另起炉灶（审计 P1-2 回归）', () => {
  const g2 = fs.readFileSync(path.join(HERE, '..', 'scripts', 'checks', 'g2-plugin-prereq.js'), 'utf8');
  assert.ok(g2.includes('manifest.g2.manualPackages') && g2.includes('credentials.requiredKeys'), 'g2 段没走 manifest');
  const h = fs.readFileSync(path.join(HERE, '..', 'scripts', 'checks', 'h-workspace.js'), 'utf8');
  assert.ok(h.includes('workspaceDirs') && h.includes('personaFiles'), 'h 段没走 manifest');
  const a = fs.readFileSync(path.join(HERE, '..', 'scripts', 'checks', 'a-core-runtime.js'), 'utf8');
  assert.ok(!a.includes("ctx.HOME, '.dsh'"), 'a 段 pnpm 候选又写死 HOME/.dsh 了');
});

test('winget 退出码按实测语义分类（2026-11-20 纠偏回归）', () => {
  const b = fs.readFileSync(path.join(HERE, '..', 'scripts', 'bootstrap.ps1'), 'utf8');
  assert.ok(b.includes('-1978335189') && b.includes('no upgrade'), '-1978335189=已装无更新，不是失败');
  assert.ok(b.includes('-1978335212') && b.includes('no package'), '-1978335212=源里没这包，不许再叫 already installed');
  const mf = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config', 'manifest.json'), 'utf8'));
  const et = mf.tools.find((t) => t.name === 'exiftool');
  assert.equal(et.winget, 'OliverBetz.ExifTool', 'exiftool 的 winget id 是 OliverBetz.ExifTool，ExifTool.ExifTool 在源里不存在');
});

test('bootstrap 有 -Profile 参数与 DSH 段闸（验收③ PS 侧锚点）', () => {
  const b = fs.readFileSync(path.join(HERE, '..', 'scripts', 'bootstrap.ps1'), 'utf8');
  assert.ok(b.includes('[string]$Profile'), '缺 -Profile 参数');
  assert.ok(b.split('if ($script:hasDsh) {').length - 1 >= 5, 'DSH 段闸至少五处（0/G/G2/H/F）');
  assert.ok(b.includes('unknown -Profile'), '坏 profile 要有提示');
});

test('p 段 persona 清单走 manifest；凭据判定是「值非空」不是 includes（审计 N7/N8 回归）', () => {
  const p = fs.readFileSync(path.join(HERE, '..', 'scripts', 'checks', 'p-integrity-migration.js'), 'utf8');
  assert.ok(p.includes('manifest.personaFiles'), 'p 段没走 manifest.personaFiles');
  for (const f of ['g2-plugin-prereq.js', '00-prerequisites.js']) {
    const s = fs.readFileSync(path.join(HERE, '..', 'scripts', 'checks', f), 'utf8');
    assert.ok(s.includes('test(txt)'), f + ' 凭据判定应走正则 .test(txt)（判值非空）');
    assert.ok(!s.includes('txt.includes('), f + ' 凭据判定又退回 includes 了（注释模板会假绿）');
  }
});

test('manifest.tweaks 元数据完整（id/name/what/revert/requiresAdmin 布尔）', () => {
  const m = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config', 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(m.tweaks) && m.tweaks.length >= 1, 'manifest.tweaks 清单丢了');
  for (const t of m.tweaks) {
    assert.ok(t.id && t.name && t.what && t.revert, 'tweak 缺字段: ' + JSON.stringify(t).slice(0, 60));
    assert.equal(typeof t.requiresAdmin, 'boolean', t.id + ' 的 requiresAdmin 必须是布尔值');
  }
});

test('tests-ps 的 .ps1 必须带 UTF-8 BOM（PS 5.1 ANSI 陷阱回归锚点）', () => {
  const files = fs.readdirSync(PS).filter((f) => f.endsWith('.ps1'));
  assert.ok(files.length >= 2, 'Pester 套件丢了');
  for (const f of files) {
    const buf = fs.readFileSync(path.join(PS, f));
    assert.equal(buf[0], 0xef, f + ' 缺 BOM（EF BB BF），PS 5.1 会按 ANSI 读');
    assert.equal(buf[1], 0xbb, f + ' 缺 BOM');
    assert.equal(buf[2], 0xbf, f + ' 缺 BOM');
  }
});
