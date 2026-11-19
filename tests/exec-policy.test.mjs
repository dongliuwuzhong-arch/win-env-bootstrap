// tests/exec-policy.test.mjs
// 执行策略（ExecutionPolicy）生效值 —— 组策略 > 机器 > 用户，Undefined 归一化
//
// 覆盖的历史 bug：
//  ① 「执行策略空值」：注册表键存在、值不存在时读到 $null / 空串，
//     而 $null -ne 'Undefined' 恒为真，于是空值被当成一个有效策略。
//     后果是 'Undefined' 这条正常分支被吃掉，报出来的生效值是空字符串。
//     修法：归一化（lib/winsys.js 的 RegPolicy 把 $null 返回成 'Undefined'，
//     bootstrap.ps1 的 Get-PersistedPolicy 把 $null 和空串都归一成 'Undefined'）。
//  ② 「用 Get-ExecutionPolicy 永远读不出问题」：本技能全程带 -ExecutionPolicy Bypass 启动，
//     Process 作用域优先级最高，生效值永远是 Bypass，这条检查就永远不可能失败。
//     必须直接读注册表里的持久化值（lib/winsys.js 的 RegPolicy）。
//
// 行为测试：真跑 checks/i-system-config.js，只把 ctx.sys() 换成假快照。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, codeOnly, fakeSystemCtx, BOOTSTRAP, SCRIPTS } from './_helpers.mjs';
import path from 'node:path';
import { check as systemConfigCheck } from '../scripts/checks/i-system-config.js';

async function policyResults(execPolicy) {
  const res = await systemConfigCheck(fakeSystemCtx({ execPolicy }));
  return res.filter((r) => r.message.includes('执行策略'));
}
const LEVEL = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'info' };

test('优先级：组策略压过机器与用户（bug②）', async () => {
  const [r] = await policyResults({ cu: 'Bypass', lm: 'RemoteSigned', gpo: 'Restricted' });
  assert.equal(r.level, 'bad', '组策略 Restricted 必须报硬缺口');
  assert.match(r.message, /生效值 = Restricted/);
  assert.match(r.message, /CU=Bypass LM=RemoteSigned/, '原始三个作用域的值要一并打出来，否则查不出为什么');
});

test('优先级：没有组策略时机器压过用户', async () => {
  const [r] = await policyResults({ cu: 'Bypass', lm: 'AllSigned', gpo: 'Undefined' });
  assert.equal(r.level, 'bad');
  assert.match(r.message, /生效值 = AllSigned/);
});

test('优先级：只剩用户作用域时用用户值', async () => {
  const [r] = await policyResults({ cu: 'RemoteSigned', lm: 'Undefined', gpo: 'Undefined' });
  assert.equal(r.level, 'ok');
  assert.match(r.message, /生效值 = RemoteSigned/);
});

test('三者都 Undefined 时是「未持久化」的 info，不是 ok 也不是 bad（bug①）', async () => {
  const [r] = await policyResults({ cu: 'Undefined', lm: 'Undefined', gpo: 'Undefined' });
  assert.equal(r.level, 'info');
  assert.match(r.message, /未持久化/);
});

test('Restricted / AllSigned 才挡脚本，其余放行', async () => {
  for (const ep of ['Restricted', 'AllSigned']) {
    const [r] = await policyResults({ cu: ep, lm: 'Undefined', gpo: 'Undefined' });
    assert.equal(r.level, 'bad', ep + ' 应该报硬缺口');
  }
  for (const ep of ['RemoteSigned', 'Bypass', 'Unrestricted']) {
    const [r] = await policyResults({ cu: ep, lm: 'Undefined', gpo: 'Undefined' });
    assert.equal(r.level, 'ok', ep + ' 不该报缺口');
  }
});

test('Process 作用域不参与判定（bug②）', async () => {
  // ctx.sys() 里根本没有 process 字段；把 Process 塞进去也不能改变结论
  const [r] = await policyResults({ cu: 'Undefined', lm: 'Undefined', gpo: 'Restricted', process: 'Bypass' });
  assert.equal(r.level, 'bad');
  assert.match(r.message, /生效值 = Restricted/);
});

test('组策略值是空串时不该顶掉机器策略（bug①的残留形态，已修）', async () => {
  const [r] = await policyResults({ cu: 'Undefined', lm: 'Restricted', gpo: '' });
  assert.equal(r.level, 'bad', '空串的组策略值不该顶掉机器作用域的 Restricted');
});

test('锚点: bootstrap.ps1 的代码里没有调用 Get-ExecutionPolicy（bug②没回退）', () => {
  const code = codeOnly(readSource(BOOTSTRAP), 'ps');
  assert.ok(!code.includes('Get-ExecutionPolicy'), 'bootstrap.ps1 又用 Get-ExecutionPolicy 读生效值了，这条检查会永远通过');
});

test('锚点: winsys 的 RegPolicy 仍把 $null 归一成 Undefined（bug①没回退）', () => {
  const src = readSource(path.join(SCRIPTS, 'lib', 'winsys.js'));
  assert.ok(src.includes("if ($null -eq $v) { return 'Undefined' }"), 'winsys.js 不再把 $null 归一成 Undefined，空值会被当成有效策略');
  assert.ok(src.includes('ExecutionPolicy'), 'winsys.js 不再读 ExecutionPolicy 注册表值');
});

test('锚点: bootstrap.ps1 的 Get-PersistedPolicy 仍把 null 与空串都归一成 Undefined（bug①没回退）', () => {
  const code = codeOnly(readSource(BOOTSTRAP), 'ps');
  assert.ok(code.includes("if ($null -eq $v) { return 'Undefined' }"), 'bootstrap.ps1 不再把 $null 归一成 Undefined');
  assert.ok(code.includes("if ($s -eq '' -or $s -eq $null) { return 'Undefined' }"), 'bootstrap.ps1 不再把空串归一成 Undefined');
});

test('锚点: bootstrap.ps1 仍按 组策略 > 机器 > 用户 的链判定（bug②没回退）', () => {
  const code = codeOnly(readSource(BOOTSTRAP), 'ps');
  assert.ok(code.includes("if ($epMachine -ne 'Undefined') { $epEff = $epMachine }"), 'bootstrap.ps1 的组策略优先级被改了');
  assert.ok(code.includes("elseif ($epLM -ne 'Undefined') { $epEff = $epLM }"), 'bootstrap.ps1 的 机器>用户 链被改了');
});
