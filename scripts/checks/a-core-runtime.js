import { ok, warn, bad } from '../lib/report.js';

export const id = 'A';
export const title = '核心运行时';

export async function check(ctx) {
  const out = [];
  const nodeV = process.version;
  const nodeMajor = parseInt(nodeV.replace('v', '').split('.')[0], 10);
  if (nodeMajor >= 24) out.push(ok('Node ' + nodeV));
  else out.push(bad('Node ' + nodeV + '（需要 24+）', 'winget install OpenJS.NodeJS.LTS'));

  const pyV = ctx.pythonVersion();
  if (pyV) {
    const m = pyV.match(/3\.(\d+)/);
    if (m && parseInt(m[1], 10) >= 12) out.push(ok(pyV));
    else out.push(warn(pyV + '（建议 3.12+）'));
  } else out.push(bad('Python 未找到', 'winget install Python.Python.3.12'));

  const gitV = ctx.run('git', ['--version']);
  if (gitV) out.push(ok(gitV));
  else out.push(warn('Git 未安装（部分插件的自更新要它）', 'winget install Git.Git'));

  const curlV = ctx.run('curl.exe', ['--version']);
  if (curlV) out.push(ok('curl 可用'));
  else out.push(warn('curl 未找到'));

  const wgV = ctx.run('winget', ['--version']);
  if (wgV) out.push(ok('winget ' + wgV));
  else out.push(warn('winget 未找到（不能自动装包）'));

  // pnpm: DSH 自带一份（runtime/primary-runtime/dependencies/pnpm），
  // 系统 PATH 里没有不算缺口。只有两边都没有才是真问题。
  const pnpmV = ctx.run('pnpm.cmd', ['--version']) || ctx.run('pnpm', ['--version']);
  const bundledPnpm = ctx.firstExisting([
    'C:\\Software\\DSH\\resources\\runtime\\primary-runtime\\dependencies\\pnpm\\bin\\pnpm.cjs',
    ctx.pathJoin(ctx.HOME, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
  ]);
  if (pnpmV) out.push(ok('pnpm ' + pnpmV + '（系统）'));
  else if (bundledPnpm) out.push(ok('pnpm 由 DSH 自带（' + bundledPnpm + '）'));
  else out.push(bad('pnpm 既不在 PATH 也不在 DSH 运行时里'));
  return out;
}
