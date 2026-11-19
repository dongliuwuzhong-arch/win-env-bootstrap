// tests/_helpers.mjs
// 共享工具：定位脚本、读源码、剥注释。
//
// 测试分两层：
//   1) 行为测试 —— 直接 import scripts/lib 与 scripts/checks 里的真模块，用假 ctx 跑。
//      这是主力，改实现不改契约就不会误报。
//   2) 锚点测试 —— 只给 PowerShell 侧（bootstrap.ps1）用：那部分 JS 导不进来，
//      只能读源码确认写法没回退。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = path.join(SKILL_ROOT, 'scripts');
export const VERIFY = path.join(SCRIPTS, 'verify.mjs');
export const BOOTSTRAP = path.join(SCRIPTS, 'bootstrap.ps1');
export const MANIFEST = path.join(SKILL_ROOT, 'config', 'manifest.json');

export function readSource(file) {
  return fs.readFileSync(file, 'utf8');
}

// 剥掉注释行，只留代码。
// 用途：bootstrap.ps1:343-346 的注释里写着「不能用 Get-ExecutionPolicy」，锚点要断言的
// 是「代码里确实一次都没调」，所以必须先把注释去掉，否则注释本身会让断言误判。
export function codeOnly(src, style) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split(/\r?\n/)) {
    let line = raw;
    if (style === 'ps') {
      if (inBlock) {
        const end = line.indexOf('#>');
        if (end < 0) continue;
        inBlock = false;
        line = line.slice(end + 2);
      }
      const open = line.indexOf('<#');
      if (open >= 0) {
        const close = line.indexOf('#>', open + 2);
        if (close >= 0) line = line.slice(0, open) + line.slice(close + 2);
        else { inBlock = true; line = line.slice(0, open); }
      }
      const hash = line.indexOf('#');
      if (hash >= 0) line = line.slice(0, hash);
    } else {
      if (inBlock) {
        const end = line.indexOf('*/');
        if (end < 0) continue;
        inBlock = false;
        line = line.slice(end + 2);
      }
      const open = line.indexOf('/*');
      if (open >= 0) {
        const close = line.indexOf('*/', open + 2);
        if (close >= 0) line = line.slice(0, open) + line.slice(close + 2);
        else { inBlock = true; line = line.slice(0, open); }
      }
      const slash = line.indexOf('//');
      if (slash >= 0) line = line.slice(0, slash);
    }
    if (line.trim()) out.push(line);
  }
  return out.join('\n');
}

// I 段（系统配置）只碰 ctx.sys() 和 ctx.exists()，可以整个假掉，不触发任何子进程。
export function fakeSystemCtx({ execPolicy, tasks = [], exists = () => true } = {}) {
  return {
    sys: () => ({
      ok: true,
      execPolicy: execPolicy || { cu: 'Undefined', lm: 'Undefined', gpo: 'Undefined' },
      tasks,
      defender: { rtp: 'unknown', exclusions: '' },
      w32time: '', longPaths: '', rootCA: [],
      env: { userPath: '', weDataDir: '', soulDb: '' },
      dshProcs: 0, aclOk: true, acl: '',
    }),
    exists,
  };
}

// A 段（核心运行时）只碰 pythonVersion / run / firstExisting / pathJoin / HOME。
export function fakeCoreCtx({ pythonVersion = null, runs = {}, bundled = null } = {}) {
  return {
    HOME: 'C:\\Users\\tester',
    DSH_HOME: 'C:\\Users\\tester\\.dsh',
    manifest: {},
    pathJoin: (...parts) => path.join(...parts),
    pythonVersion: () => pythonVersion,
    run: (exe) => (exe in runs ? runs[exe] : null),
    firstExisting: () => bundled,
  };
}
