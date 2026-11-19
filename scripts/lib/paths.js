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
// workspace 兜底值和 bootstrap.ps1 的内置默认是同一个（C:\DSH空间）：两边不一致时
// 同一台机器会得出相反结论（审查严重 #3）。改一处必须改两处。
const FALLBACK = {
  workspace: { default: 'C:\\DSH空间' },
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

// 工作区解析顺序：参数 > DSH_WORKSPACE 环境变量 > manifest.workspace.default > 内置兜底。
// bootstrap.ps1 里是同一顺序、同一兜底值——两处实现必须保持一致（审查严重 #3）。
export function resolveWorkspace({ param, env, manifestDefault } = {}) {
  return param || env || manifestDefault || FALLBACK.workspace.default || '';
}

export function createContext() {
  const manifest = loadManifest();
  const HOME = os.homedir();
  // 公开库里 manifest.workspace.default 留空，由使用者用环境变量指定，避免把作者自己的路径写进仓库
  const wsEnv = process.env.DSH_WORKSPACE;
  const wsMfDefault = manifest.workspace && manifest.workspace.default;
  const WS = resolveWorkspace({ env: wsEnv, manifestDefault: wsMfDefault });
  // wsIsFallback：WS 是不是「谁都没配」时的内置兜底——兜底落空的文案跟真路径不存在不一样（审计 P2-5）
  const wsIsFallback = !wsEnv && !wsMfDefault;
  // DSH_HOME 可被环境变量覆盖：裸机模拟测试和换用户名都需要它，不能写死 homedir
  const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');

  const ctx = {
    HOME, WS, wsIsFallback, DSH_HOME, manifest,
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