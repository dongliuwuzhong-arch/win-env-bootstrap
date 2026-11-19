import fs from 'node:fs';
import path from 'node:path';
import { ok, warn, bad, info } from '../lib/report.js';

export const id = 'G2';
export const title = '插件加载前置';

// node:sqlite 可用性一次子进程问完
const SOUL_PROBE = [
  'let DB=null,sqlite=false,uv=null,err=null;',
  "try{DB=require('node:sqlite').DatabaseSync;sqlite=(typeof DB==='function');}catch{}",
  "if(sqlite&&process.argv[1]){try{const d=new DB(process.argv[1],{readOnly:true});",
  "const r=d.prepare('PRAGMA user_version').get();d.close();",
  'const v=r?(r.user_version!==undefined?r.user_version:Object.values(r)[0]):null;',
  'uv=(typeof v==="number")?v:null;}catch(e){err=String(e.message).slice(0,60);}}',
  'console.log(JSON.stringify({sqlite,uv,err}));',
].join('');

export async function check(ctx) {
  const out = [];
  const join = ctx.pathJoin;
  const DSH_ROOT = ctx.DSH_ROOT;

  const profNM = join(ctx.DSH_HOME, 'profiles', 'desktop', 'node_modules');
  const hostNM = DSH_ROOT ? join(DSH_ROOT, 'resources', 'app', 'dsh', 'node_modules') : '';

  // 1) 这 5 个 @deepseek-ai 包不在 package.json dependencies 里，是手工放进 profile 的。
  //    其中 dsh-compaction-basic 必须是 junction 指向宿主那份，否则三个预设里的
  //    某个插件的压缩后端在加载期就 throw —— 挂它的预设一起死。
  // manifest.g2.manualPackages 是单一配置源（写死清单会在改 manifest 后行为分叉，审计 P1-2）
  const manualPkgs = (ctx.manifest && ctx.manifest.g2 && ctx.manifest.g2.manualPackages && ctx.manifest.g2.manualPackages.length)
    ? ctx.manifest.g2.manualPackages : ['cosmokit', 'dsh-compaction', 'dsh-compaction-basic', 'dsh-compaction-tool-result-pruner', 'schemastery']
  ;
  const missingManual = [];
  for (const pkg of manualPkgs) {
    const dir = join(profNM, '@deepseek-ai', pkg);
    if (!ctx.exists(dir)) { missingManual.push(pkg); continue; }
    if (pkg === 'dsh-compaction-basic') {
      // compaction.js 只要求「能解析到」+「compactNow 是函数」，同版本目录拷贝也能跑。
      // junction 只是跟着宿主升级不失效的维护手段，所以不是 junction 只提示不报错。
      let isLink = false;
      try { isLink = fs.lstatSync(dir).isSymbolicLink(); } catch { }
      const basicPkg = join(dir, 'package.json');
      try {
        const v1 = JSON.parse(fs.readFileSync(basicPkg, 'utf8')).version;
        const hostBasic = hostNM ? join(hostNM, '@deepseek-ai', 'dsh-compaction-basic', 'package.json') : '';
        if (hostBasic && ctx.exists(hostBasic)) {
          const v2 = JSON.parse(fs.readFileSync(hostBasic, 'utf8')).version;
          if (v1 === v2) out.push(ok('dsh-compaction-basic 版本与宿主一致（' + v1 + '）'));
          else out.push(bad('dsh-compaction-basic 版本 ' + v1 + ' 与宿主 ' + v2 + ' 不一致 —— compactNow 可能没了'));
        }
      } catch { out.push(info('dsh-compaction-basic 版本比对不了')); }
      if (isLink) out.push(ok('dsh-compaction-basic 是 junction（跟宿主升级）'));
      else out.push(info('dsh-compaction-basic 是目录拷贝（能跑，但宿主升级后会失配）'));
    }
  }
  // 只有 dsh-compaction-basic 是代码级硬依赖（compaction.js 运行时动态 import）；
  // 另外 4 个走宿主解析域，缺了通常不影响加载 —— 分开报，别等权 hard-fail。
  const hardManual = missingManual.filter((p) => p === 'dsh-compaction-basic');
  const softManual = missingManual.filter((p) => p !== 'dsh-compaction-basic');
  if (hardManual.length) out.push(bad('profile 缺 dsh-compaction-basic —— 三个预设会在加载期 throw'));
  else if (softManual.length) out.push(warn('profile 缺建议包: ' + softManual.join(', ') + '（通常走宿主解析，可不补）'));
  else out.push(ok('@deepseek-ai 手工包 5/5'));

  // 2) 本地插件是拷贝不是链接，换机只拷 ~/.dsh 不带 node_modules 就全缺
  const localPlugins = (ctx.manifest?.g2?.localPlugins || []);
  const missingLocal = localPlugins.filter((n) => !ctx.exists(join(profNM, n)));
  // 清单为空时不许说「4/4」——那是谎报（2026-11-19 二验 A3）
  if (!localPlugins.length) out.push(info('本地插件清单为空（manifest.g2.localPlugins 自填后才查）'));
  else if (missingLocal.length) out.push(bad('本地插件缺失: ' + missingLocal.join(', ')));
  else out.push(ok('本地插件 ' + localPlugins.length + '/' + localPlugins.length));

  // 18 个 bundle 逐个查：只查 4 个本地插件会漏掉另外 14 个，
  // 换机漏拷 profile/node_modules 时报告仍是绿的
  try {
    const bp = join(ctx.DSH_HOME, 'profiles', 'desktop', 'package.json');
    const bundles = JSON.parse(fs.readFileSync(bp, 'utf8')).dsh?.profile?.bundles || [];
    // 有些 bundle 只从宿主解析（dsh-base / dsh-web-app / dsh-experimental-auto-review），
    // profile 里本来就没有 —— 两边都查，都没有才算真缺
    const missingB = bundles.filter((b) => {
      if (ctx.exists(join(profNM, b))) return false;
      if (hostNM && ctx.exists(join(hostNM, b))) return false;
      return true;
    });
    if (missingB.length === 0) out.push(ok('bundles ' + bundles.length + '/' + bundles.length + ' 都在（profile 或宿主）'));
    else out.push(bad('bundle 缺失 ' + missingB.length + '/' + bundles.length + ': ' + missingB.slice(0, 4).join(', ')));
  } catch (e) { out.push(warn('bundles 清单读不了: ' + String(e.message).slice(0, 60))); }

  // 3) node:sqlite 可用性（部分插件用它做本地存储）。
  // 阈值统一按 A 段的 Node 24+ 走，不在这里另立一个 22.5+ 的口径。
  let probe = { sqlite: false };
  try {
    const raw = ctx.runNode(['-e', SOUL_PROBE, ''], { timeout: 20000 });
    if (raw) probe = JSON.parse(raw);
  } catch { }
  if (probe.sqlite) out.push(ok('node:sqlite DatabaseSync 可用'));
  else out.push(bad('node:sqlite 不可用（Node 版本不够，A 段要求的 24+ 会自动满足这一条）'));

  // profile 目录名必须匹配 ^[a-zA-Z0-9_-]{1,80}$，否则部分插件加载即 throw
  // （index.js:28 显式校验，且拒绝回落到共享库）
  try {
    const pdir = join(ctx.DSH_HOME, 'profiles');
    const activeProfiles = fs.readdirSync(pdir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.includes('.bak'))
      .map((e) => e.name);
    const badNames = activeProfiles.filter((p) => !/^[a-zA-Z0-9_-]{1,80}$/.test(p));
    if (badNames.length) out.push(bad('profile 名不合法（部分插件会 throw）: ' + badNames.join(', ')));
    else out.push(ok('profile 名全部合法（' + activeProfiles.join(', ') + '）'));
  } catch { out.push(info('profiles 目录读不了')); }


  // 4) 会改宿主文件的插件要能写宿主安装目录；装在 Program Files 且非管理员时补丁一条都落不下去
  if (DSH_ROOT && hostNM && ctx.exists(hostNM)) {
    const appRoot = join(DSH_ROOT, 'resources', 'app');
    // fs.accessSync(W_OK) 在 Windows 上只读 FILE_ATTRIBUTE_READONLY，不查 ACL：
    // 实测 C:/Program Files/WindowsApps 也返回 WRITABLE。必须实际写一次。
    let writable = false;
    const probeFile = join(appRoot, '.dsh-write-probe-' + process.pid);
    try {
      fs.writeFileSync(probeFile, 'x', { flag: 'wx' });
      writable = true;
    } catch { writable = false; }
    // finally 保证清理：unlink 失败（杀软锁 / Ctrl-C）不留垃圾
    finally { try { fs.unlinkSync(probeFile); } catch { } }
    if (writable) out.push(ok('宿主安装目录可写（改宿主文件的插件能打补丁）'));
    else out.push(bad('宿主安装目录不可写（' + appRoot + '）—— 改宿主文件的插件一条补丁都落不下去'));
  } else {
    out.push(bad('宿主安装目录解析不到（DSH_ROOT=' + DSH_ROOT + '）—— 无法验证插件能否打补丁'));
  }

  // win-bash 自带 16 MB MSYS payload，挂载前校验 checksums.sha256，
  // 通过后复制到 ~/.dsh/win-bash/runtime/<digest>；不一致就拒绝挂载。
  // 它是工作区主力 shell（win_bash 工具），挂了是断手断脚。
  const wbPayload = profNM ? join(profNM, '@linxin666', 'dsh-win-bash', 'runtime', 'win32-x64') : '';
  if (wbPayload && ctx.exists(wbPayload)) {
    const bashExe = join(wbPayload, 'usr', 'bin', 'bash.exe');
    const sums = join(wbPayload, 'checksums.sha256');
    if (ctx.exists(bashExe)) out.push(ok('win-bash payload 含 bash.exe'));
    else out.push(bad('win-bash payload 缺 usr/bin/bash.exe —— 挂载会被拒'));
    if (ctx.exists(sums)) out.push(ok('win-bash checksums.sha256 在'));
    else out.push(warn('win-bash checksums.sha256 缺失（完整性校验会失败）'));
    const cacheDir = join(ctx.DSH_HOME, 'win-bash');
    let cw = false;
    // accessSync 在 Windows 上只读 FILE_ATTRIBUTE_READONLY，不查 ACL —— 必须实写一次
    const cacheProbe = join(cacheDir, '.dsh-probe-' + process.pid);
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheProbe, 'x', { flag: 'wx' });
      cw = true;
    } catch { cw = false; }
    finally { try { fs.unlinkSync(cacheProbe); } catch { } }
    if (cw) out.push(ok('win-bash 缓存目录可写'));
    else out.push(warn('win-bash 缓存目录不可写（~/.dsh/win-bash）'));
  } else out.push(info('win-bash 包不在 profile（跳过 payload 检查）'));

  // 5) 各插件的软依赖
  // bridge-next 优先用包内自带的 uv（@dataiku/uv-win32-x64），系统 PATH 里有没有不是关键
  const uvBundled = profNM ? join(profNM, '@dataiku', 'uv-win32-x64', 'bin', 'uv.exe') : '';
  if (uvBundled && ctx.exists(uvBundled)) out.push(ok('bridge-next 自带 uv（' + uvBundled + '）'));
  else if (ctx.run('uv', ['--version'])) out.push(ok('uv 在 PATH（bridge-next 可用）'));
  else out.push(bad('uv 既不在包内也不在 PATH —— bridge-next 起不来'));

  const steam = ctx.firstExisting(['C:\\Program Files (x86)\\Steam\\steam.exe', 'C:\\Game\\Steam\\steam.exe']);
  if (steam) out.push(ok('Steam: ' + steam));
  else out.push(info('Steam 未找到（wallpaper-engine 插件会返回空列表）'));
  // Wallpaper Engine 本体（appid 431960）：没有就是空列表，不报错
  if (steam) {
    const we = ctx.firstExisting([
      join(path.dirname(steam), 'steamapps', 'common', 'wallpaper_engine', 'wallpaper64.exe'),
      'C:\\Game\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe',
    ]);
    if (we) out.push(ok('Wallpaper Engine 本体: ' + we));
    else out.push(info('Wallpaper Engine 本体未找到（插件会返回空列表，不报错）'));
  }

  // WorkBuddy 桌面 App：dsh-connect-workbuddy 复用它的登录态
  const wb = ctx.firstExisting([
    'C:\\Software\\WorkBuddyAI\\WorkBuddyAI.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'WorkBuddyAI', 'WorkBuddyAI.exe'),
  ]);
  if (wb) out.push(ok('WorkBuddy App: ' + wb));
  else out.push(info('WorkBuddy App 未找到（connect-workbuddy 会显示未登录）'));

  const ps51 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  if (ctx.exists(ps51)) out.push(ok('Windows PowerShell 5.1 在（dsh-notification 的 toast 需要）'));
  else out.push(bad('Windows PowerShell 5.1 缺失 —— dsh-notification 静默失败'));

  // 6) 凭据里到底有没有这把 key（文件在 != key 在）
  const credPath = join(ctx.DSH_HOME, '.credentials.yaml');
  if (ctx.exists(credPath)) {
    // 逐行扫，只留布尔结果：凭据不整文件进内存，也绝不打印内容
    let hasKey = false;
    try {
      // key 清单来自 manifest.credentials.requiredKeys（单一配置源，审计 P3-12）
      const reqKeys = (ctx.manifest && ctx.manifest.credentials && ctx.manifest.credentials.requiredKeys && ctx.manifest.credentials.requiredKeys.length)
        ? ctx.manifest.credentials.requiredKeys : ['OPENCODE_GO_API_KEY'];
      const txt = fs.readFileSync(credPath, 'utf8');
      const missing = reqKeys.filter((k) => !txt.includes(k));
      if (missing.length === 0) out.push(ok('凭据含必需 key: ' + reqKeys.join(', ')));
      else out.push(bad('凭据里缺 key: ' + missing.join(', ') + ' —— 默认模型通道起不来（文件在≠key在）'));
    } catch { out.push(warn('凭据文件读不了')); }
  }
  return out;
}