import { join } from 'node:path';
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
  // 自带运行时探测只在 DSH 环境做；core 用户的口径不提 DSH（审计二审 5.1）
  const bundledPnpm = ctx.hasDsh ? ctx.firstExisting([
    ...(ctx.DSH_ROOT ? [join(ctx.DSH_ROOT, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')] : []),
    ctx.pathJoin(ctx.DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
  ]) : null;
  if (pnpmV) out.push(ok('pnpm ' + pnpmV + (ctx.hasDsh ? '（系统）' : '')));
  else if (bundledPnpm) out.push(ok('pnpm 由 DSH 自带（' + bundledPnpm + '）'));
  else out.push(bad('pnpm 不在 PATH' + (ctx.hasDsh ? '，DSH 运行时里也没有' : '') + '（要 build/monorepo 就 npm i -g pnpm）'));
  // agent-cli: the commands an agent reaches for first.
  // bootstrap installs them; without a check here nothing verifies they landed.
  for (const [cmd, args, why] of [
    ['rg', ['--version'], 'agent 文本搜索（最高频）'],
    ['jq', ['--version'], 'JSON 处理'],
  ]) {
    const v = ctx.run(cmd, args);
    if (v) out.push(ok(cmd + ' ' + v.split('\n')[0].trim()));
    else out.push(warn(cmd + ' 未装（' + why + '）', 'bootstrap -Apply 装，或 winget install ' + (cmd === 'rg' ? 'BurntSushi.ripgrep.MSVC' : 'jqlang.jq')));
  }
  return out;
}
