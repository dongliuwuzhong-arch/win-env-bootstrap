import { test } from 'node:test';
import assert from 'node:assert';
import { check } from '../scripts/checks/f-python-packages.js';

// 历史 bug：拿 check-env.py 的 import 名（Cryptodome / pysilk）去匹配 pip list，
// 而 pip list 打印的是分发名（pycryptodomex / silk-python）——装满了也永远报缺。

function fakeCtx(pipText, manifest) {
  return {
    manifest: manifest || { pythonPackages: { system: [
      { name: 'pillow' }, { name: 'pyyaml' },
      { name: 'frida', optional: true, consumer: 'wechat-history' },
      { name: 'frida-tools', optional: true, consumer: 'wechat-history' },
      { name: 'pycryptodome', optional: true, consumer: 'wechat-history' },
      { name: 'pycryptodomex', optional: true, consumer: 'wechat-history' },
      { name: 'zstandard', optional: true, consumer: 'wechat-history' },
      { name: 'silk-python', optional: true, consumer: 'wechat-history' },
    ] } },
    pythonExe: () => 'python',
    run: () => pipText,
    firstExisting: () => null,
    pathJoin: (...a) => a.join('/'),
    DSH_ROOT: null,
    DSH_HOME: '/home/.dsh',
  };
}

test('分发名齐了就该绿：pycryptodomex / silk-python 装了不再报缺（import 名误报回归锚点）', async () => {
  const pipText = [
    'pillow 13.0.0', 'PyYAML 6.0.3', 'frida 17.27.0', 'frida-tools 14.13.2',
    'pycryptodome 4.3.0', 'pycryptodomex 3.24.1', 'zstandard 0.25.0', 'silk-python 0.2.9',
  ].join('\n');
  const out = await check(fakeCtx(pipText));
  const notOk = out.filter((r) => r.message.startsWith('python:') && r.level !== 'ok');
  assert.deepEqual(notOk.map((r) => r.message), [], '分发名齐了还报缺 = 又拿 import 名匹配了');
});

test('判据的失败输入：真缺包必须报得出来', async () => {
  const pipText = 'pillow 13.0.0\nPyYAML 6.0.3\nfrida 17.27.0';
  const out = await check(fakeCtx(pipText));
  const msgs = out.map((r) => r.message).join('\n');
  assert.ok(msgs.includes('python:pycryptodomex 未装'), '缺 pycryptodomex 必须报');
  assert.ok(msgs.includes('python:silk-python 未装'), '缺 silk-python 必须报');
  assert.ok(msgs.includes('python:frida-tools 未装'), '缺 frida-tools 必须报');
  assert.ok(!msgs.includes('python:pillow 未装') && !msgs.includes('python:pillow 缺失'), 'pillow 在场不该报');
  // frida-tools 在场与否不能靠 frida 顶——'^frida\\s' 不会命中 'frida-tools' 行
  const out2 = await check(fakeCtx('pillow 1.0\nfrida-tools 14.0'));
  const msgs2 = out2.map((r) => r.message).join('\n');
  assert.ok(msgs2.includes('python:frida 未装'), "'^frida\\s' 不许命中 frida-tools 行");
});
