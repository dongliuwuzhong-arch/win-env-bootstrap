import { ok, warn, bad } from '../lib/report.js';

export const id = 'B';
export const title = '归档工具';

export async function check(ctx) {
  const out = [];
  const sevenDir = ctx.firstExisting([
    'C:\\Software\\7-Zip\\7z.exe',
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ]);
  if (sevenDir) {
    const inPath = ctx.run('7z', []) !== null;
    if (inPath) out.push(ok('7-Zip 在 PATH 内'));
    else out.push(warn('7-Zip 装了但不在 PATH：' + sevenDir, 'bootstrap -Apply 补 PATH'));
  } else out.push(bad('7-Zip 未安装', 'winget install 7zip.7zip'));
  return out;
}
