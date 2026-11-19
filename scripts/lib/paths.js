/**
 * 路径与配置源。config/manifest.json 是类别顺序和候选路径的唯一来源。
 * 这里同时负责把上下文（ctx）拼出来：check 只拿 ctx，不碰环境变量和全局状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, runNode, exists, firstExisting, memo } from './run.js';
import { systemSnapshot, netstatSnapshot, runKeySnapshot } from './winsys.js';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(LIB_DIR, '..', '..', 'config', 'manifest.json');

// manifest 读不到时按这份兜底（技能目录被单独拷走也不会炸）
const FALLBACK = {
  workspace: { default: '' },
  dsh: { rootCandidates: ['C:\\Software\\DSH', 'C:\\Program Files\\DSH'] },
  categories: [
    { id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }, { id: 'F' },
    { id: 'G' }, { id: 'G2' }, { id: 'H' }, { id: 'I' }, { id: 'J' }, { id: 'K' },
    { id: 'L' }, { id: 'M' }, { id: 'N' }, { id: 'O' }, { id: 'P' },
  ],
};

export function loadManifest() {
  try {
    const j = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (!j || !Array.isArray(j.categories)) return FALLBACK;
    return j;
  } catch {
    return FALLBACK;
  }
}

// 宿主安装路径不能写死：装在 Program Files 时，改宿主文件的插件一条补丁都落不下去，
// 而那正是最该报硬缺口的场景。先试常见路径，再从注册表 Uninstall 项取 InstallLocation。
// 只有常见路径都不在时才会起 PowerShell（换机场景，不是热路径）。
export function resolveDshRoot(candidates) {
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  try {
    const out = run('powershell', ['-NoProfile', '-Command', "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'DeepSeek' } | Select-Object -First 1 -ExpandProperty InstallLocation"]);
    if (out && exists(out.trim())) return out.trim();
  } catch { }
  return null;
}

export function createContext() {
  const manifest = loadManifest();
  const HOME = os.homedir();
  // 工作区路径：manifest.default > DSH_WORKSPACE 环境变量 > 内置回退
  // 公开库里 manifest.default 留空，由使用者用环境变量指定，避免把作者自己的路径写进仓库
  const WS = (manifest.workspace && manifest.workspace.default)
    || process.env.DSH_WORKSPACE
    || FALLBACK.workspace.default
    || '';
  // DSH_HOME 可被环境变量覆盖：裸机模拟测试和换用户名都需要它，不能写死 homedir
  const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');

  const ctx = {
    HOME, WS, DSH_HOME, manifest,
    run, runNode, exists, firstExisting,
    path, pathJoin: path.join,
    DSH_ROOT: resolveDshRoot((manifest.dsh && manifest.dsh.rootCandidates) || FALLBACK.dsh.rootCandidates),
  };

  // 每次运行只跑一次的外部查询（改造前这些各段各自重复起子进程）
  const pyProbe = memo(() => ({
    py: run('python', ['--version']),
    py3: run('python3', ['--version']),
  }));
  ctx.pythonVersion = () => pyProbe().py || pyProbe().py3;
  ctx.pythonExe = () => (pyProbe().py ? 'python' : (pyProbe().py3 ? 'python3' : 'python'));
  // 快照失败也要有形状：check 里直接读字段，不做 null 判断
  ctx.sys = memo(() => systemSnapshot(WS) || {
    ok: false,
    execPolicy: { cu: 'Undefined', lm: 'Undefined', gpo: 'Undefined' },
    tasks: [], defender: { rtp: 'unknown', exclusions: '' },
    w32time: '', longPaths: '', rootCA: [],
    env: { userPath: '', weDataDir: '', soulDb: '' },
    dshProcs: 0, aclOk: false, acl: '',
  });
  ctx.netstat = memo(() => netstatSnapshot());
  ctx.runKey = memo(() => runKeySnapshot());
  return ctx;
}