import { join } from 'node:path';
import { ok, warn, info } from '../lib/report.js';

export const id = 'F';
export const title = 'Python 包';

// manifest 读不到时的兜底，与 config/manifest.json 的 pythonPackages 对齐。
const FALLBACK_SYSTEM = [
  { name: 'pillow' }, { name: 'pyyaml' },
  { name: 'frida', optional: true, consumer: 'wechat-history' },
  { name: 'frida-tools', optional: true, consumer: 'wechat-history' },
  { name: 'pycryptodome', optional: true, consumer: 'wechat-history' },
  { name: 'pycryptodomex', optional: true, consumer: 'wechat-history' },
  { name: 'zstandard', optional: true, consumer: 'wechat-history' },
  { name: 'silk-python', optional: true, consumer: 'wechat-history' },
];
const FALLBACK_DSH = ['numpy', 'pandas', 'openpyxl', 'pillow', 'lxml'];

// pip list 打印的是分发名（pycryptodomex / silk-python），不是 import 名
// （Cryptodome / pysilk）。历史上拿 import 名来匹配 pip list，装满了也永远报缺。
// 匹配一律用 manifest 里的分发名；importName 字段只作注释，不参与匹配。
function hasPkg(pipText, name) {
  return new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'im').test(pipText);
}

export async function check(ctx) {
  const out = [];
  const mf = ctx.manifest || {};
  const sysList = (mf.pythonPackages && Array.isArray(mf.pythonPackages.system) && mf.pythonPackages.system.length)
    ? mf.pythonPackages.system : FALLBACK_SYSTEM;

  const pyExe = ctx.pythonExe();
  const pipText = ctx.run(pyExe, ['-m', 'pip', 'list']);
  if (pipText) {
    for (const p of sysList) {
      const pkg = p.name;
      if (hasPkg(pipText, pkg)) out.push(ok('python:' + pkg));
      else if (p.optional) out.push(info('python:' + pkg + ' 未装（仅 ' + (p.consumer || '个别技能') + ' 需要）'));
      else out.push(warn('python:' + pkg + ' 缺失', 'pip install ' + pkg));
    }
  } else out.push(warn('pip list 跑不了'));

  // DSH 自带的 python 是另一套包（runtime.json 里列了 numpy/pandas/openpyxl/Pillow/lxml，
  // 但没有 PyYAML）。系统 python 有 ≠ DSH 的 python 有。
  // dshBundled 是 DSH 专属项：core profile 下跳过（审计二审 5.1 模块边界）
  if (ctx.hasDsh) {
  const dshPy = ctx.firstExisting([
    ...(ctx.DSH_ROOT ? [join(ctx.DSH_ROOT, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', 'python.exe')] : []),
    ctx.pathJoin(ctx.DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ]);
  if (dshPy) {
    const dshPip = ctx.run(dshPy, ['-m', 'pip', 'list'], { timeout: 30000 });
    const core = (mf.pythonPackages && Array.isArray(mf.pythonPackages.dshBundled) && mf.pythonPackages.dshBundled.length)
      ? mf.pythonPackages.dshBundled.map((x) => x.name) : FALLBACK_DSH;
    if (dshPip) {
      const lack = core.filter((k) => !hasPkg(dshPip, k));
      if (lack.length === 0) out.push(ok('DSH 自带 python 核心包齐全（' + core.join('/') + '）'));
      else out.push(warn('DSH 自带 python 缺包: ' + lack.join(', ')));
    } else out.push(info('DSH 自带 python 的 pip list 跑不了'));
  } else {
    out.push(warn('DSH 自带 python 运行时缺失（~/.dsh/dsh-runtimes 不完整）'));
  }
  }
  return out;
}
