import { test } from 'node:test';
import assert from 'node:assert';
import { readSource, codeOnly, BOOTSTRAP } from './_helpers.mjs';

// 2026-11-19 开箱即用审查的回归锚点：$wsPath 在赋值前被 puppeteer 块使用，
// 整个安装块是死代码。锚点钉住「赋值先于使用」和「安装块唯一」。

test('wsPath 先赋值后使用（puppeteer 死代码回归锚点，审查严重 #1）', () => {
  const lines = codeOnly(readSource(BOOTSTRAP), 'ps').split(/\r?\n/);
  const assignIdx = lines.findIndex((l) => /\$wsPath\s*=/.test(l));
  const useIdx = lines.findIndex((l) => /\$wsPath\b/.test(l) && !/\$wsPath\s*=/.test(l));
  assert.ok(assignIdx >= 0, '找不到 $wsPath 赋值');
  assert.ok(useIdx >= 0, '找不到 $wsPath 使用点');
  assert.ok(assignIdx < useIdx, '赋值行 ' + (assignIdx + 1) + ' 必须在首次使用行 ' + (useIdx + 1) + ' 之前');
});

test('puppeteer 只有一个安装块（检测→安装→复测），第二块只报不装的不许回来（审查严重 #1）', () => {
  const s = codeOnly(readSource(BOOTSTRAP), 'ps');
  const installs = (s.match(/installing puppeteer/g) || []).length;
  assert.equal(installs, 1, 'puppeteer 安装块必须唯一，现在有 ' + installs + ' 个');
  assert.ok(!/puppeteer missing \(run npm i in _tools\/browser\)/.test(s), '只报不装的第二块又回来了');
});

test('bootstrap 输出人工前置清单，走 manifest.prerequisites（审查一般 #8）', () => {
  const s = codeOnly(readSource(BOOTSTRAP), 'ps');
  assert.ok(/manual prerequisites/.test(s), 'bootstrap 缺 00 人工前置清单');
  assert.ok(/\$mfPre\.prerequisites/.test(s), '前置清单没走 manifest.prerequisites');
});

test('env 判定覆盖环境变量或 manifest.default 两种显式配置（审查一般 #9）', () => {
  const s = codeOnly(readSource(BOOTSTRAP), 'ps');
  assert.ok(/\$wsConfigured/.test(s), 'bootstrap 缺 wsConfigured');
  assert.ok(/DSH_WORKSPACE -or/.test(s), 'env 判定必须覆盖环境变量或 manifest.default');
});

test('E/F 段安装消费 manifest 的 pip 清单（审查严重 #2）', () => {
  const s = codeOnly(readSource(BOOTSTRAP), 'ps');
  assert.ok(/Install-Pip \$pyCmdE\.Source/.test(s), 'E 段 frida 又回到只报不装');
  assert.ok(/\$mfPkg\.pythonPackages\.system/.test(s), 'F 段没有消费 manifest.pythonPackages.system');
  assert.ok(/\$mfPkg\.pythonPackages\.dshBundled/.test(s), 'F 段没有覆盖 DSH 自带 python');
  assert.ok(/Install-Pip \$dshPy /.test(s), 'DSH 自带 python 缺包没有安装动作');
});
