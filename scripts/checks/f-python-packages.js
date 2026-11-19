import { join } from 'node:path';
import { ok, warn, info } from '../lib/report.js';

export const id = 'F';
export const title = 'Python 包';

export async function check(ctx) {
  const out = [];
  const pyExe = ctx.pythonExe();
  const pipText = ctx.run(pyExe, ['-m', 'pip', 'list']);
  if (pipText) {
    for (const pkg of ['pillow', 'pyyaml']) {
      if (new RegExp('^' + pkg + '\\s', 'im').test(pipText)) out.push(ok('python:' + pkg));
      else out.push(warn('python:' + pkg + ' 缺失', 'pip install ' + pkg));
    }
    // wechat-history 的 check-env.py 声明要这 4 个，只查 frida 会漏掉后三个
    for (const pkg of ['frida', 'cryptodome', 'zstandard', 'pysilk']) {
      if (new RegExp('^' + pkg + '\\s', 'im').test(pipText)) out.push(ok('python:' + pkg));
      else out.push(info('python:' + pkg + ' 未装（仅 wechat-history 需要）'));
    }
  } else out.push(warn('pip list 跑不了'));

  // DSH 自带的 python 是另一套包（runtime.json 里列了 numpy/pandas/openpyxl/Pillow/lxml，
  // 但没有 PyYAML）。系统 python 有 ≠ DSH 的 python 有。
  const dshPy = ctx.firstExisting([
    ...(ctx.DSH_ROOT ? [join(ctx.DSH_ROOT, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'python', 'python.exe')] : []),
    ctx.pathJoin(ctx.HOME, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ]);
  if (dshPy) {
    const dshPip = ctx.run(dshPy, ['-m', 'pip', 'list'], { timeout: 30000 });
    if (dshPip) {
      const core = ['numpy', 'pandas', 'openpyxl', 'pillow', 'lxml'];
      const lack = core.filter((k) => !new RegExp('^' + k + '\\s', 'im').test(dshPip));
      if (lack.length === 0) out.push(ok('DSH 自带 python 核心包齐全（numpy/pandas/openpyxl/pillow/lxml）'));
      else out.push(warn('DSH 自带 python 缺包: ' + lack.join(', ')));
    } else out.push(info('DSH 自带 python 的 pip list 跑不了'));
  } else {
    out.push(warn('DSH 自带 python 运行时缺失（~/.dsh/dsh-runtimes 不完整）'));
  }
  return out;
}
