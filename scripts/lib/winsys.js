/**
 * Windows 系统快照：所有 PowerShell 查询合并成一次调用，Node 侧 JSON.parse 一次拿全。
 * 改造前这一路是 12 次冷启动（执行策略 / 计划任务 / 任务动作 / Defender / w32time /
 * LongPaths / 根证书 / 两个用户环境变量 / DSH 进程数 / icacls / 用户 PATH）。
 *
 * 三个必须注意的点（都实测踩过）：
 *  1) 走 -EncodedCommand（UTF-16LE base64），别走 -Command 长脚本或 -File：
 *     中文路径经 -File + 无 BOM UTF-8 会被按 ANSI 读成乱码，icacls 直接失败。
 *  2) 不要设全局 $ErrorActionPreference='SilentlyContinue'：它把
 *     "Get-Process | Where-Object { $_.Path ... }" 的访问拒绝变成静默终止，
 *     进程数会从 12 变成 1。
 *  3) [Console]::OutputEncoding 必须显式设 UTF-8，否则计划任务动作路径里的
 *     含中文的路径会被按 OEM 码页吐出来，Node 侧判成"文件不存在"。
 */
import { run } from './run.js';

const SNAPSHOT_PS = [
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  "$BS = [char]92",
  "$NL = [string][char]10",
  "function RegPolicy([string]$hive, [string]$sub) {",
  "  $p = $hive + ':' + $BS + $sub",
  "  $v = (Get-ItemProperty -Path $p -Name 'ExecutionPolicy' -ErrorAction SilentlyContinue).ExecutionPolicy",
  "  if ($null -eq $v) { return 'Undefined' }",
  "  $s = [string]$v",
  "  if ($s -eq '') { return 'Undefined' }",
  "  return $s",
  "}",
  "$out = [ordered]@{}",
  "$out.execPolicy = [ordered]@{",
  "  cu  = RegPolicy 'HKCU' ('SOFTWARE' + $BS + 'Microsoft' + $BS + 'PowerShell' + $BS + '1' + $BS + 'ShellIds' + $BS + 'Microsoft.PowerShell')",
  "  lm  = RegPolicy 'HKLM' ('SOFTWARE' + $BS + 'Microsoft' + $BS + 'PowerShell' + $BS + '1' + $BS + 'ShellIds' + $BS + 'Microsoft.PowerShell')",
  "  gpo = RegPolicy 'HKLM' ('SOFTWARE' + $BS + 'Policies' + $BS + 'Microsoft' + $BS + 'Windows' + $BS + 'PowerShell')",
  "}",
  "$out.tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'DSH' } | ForEach-Object {",
  "  [ordered]@{ name = [string]$_.TaskName; state = [string]$_.State;",
  "    actions = (@($_.Actions) | ForEach-Object { ([string]$_.Execute) + ' ' + ([string]$_.Arguments) }) -join $NL }",
  "})",
  "$out.defender = [ordered]@{ rtp = 'unknown'; exclusions = '' }",
  "try { $s = Get-MpComputerStatus -ErrorAction Stop; $out.defender.rtp = [string]$s.RealTimeProtectionEnabled } catch { }",
  "$out.defender.exclusions = (@((Get-MpPreference -ErrorAction SilentlyContinue).ExclusionPath) | Where-Object { $_ }) -join ';'",
  "$out.w32time = [string](Get-Service w32time -ErrorAction SilentlyContinue).Status",
  "$out.longPaths = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -ErrorAction SilentlyContinue).LongPathsEnabled",
  "$out.rootCA = @(Get-ChildItem Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -notmatch 'Microsoft|DigiCert|Sectigo|GlobalSign|Baltimore|VeriSign|Entrust|Go Daddy|USERTrust|ISRG|Amazon|COMODO|Starfield|Thawte|GeoTrust|Certum|QuoVadis|SwissSign|SecureTrust|XRamp|AffirmTrust|Actalis|Buypass|D-TRUST|IdenTrust|Network Solutions|SSL.com|T-TeleSec|Trustwave|WoSign|CFCA' } | Select-Object -ExpandProperty Subject)",
  "$out.env = [ordered]@{",
  "  userPath  = [string][Environment]::GetEnvironmentVariable('Path','User')",
  "  weDataDir = [string][Environment]::GetEnvironmentVariable('DSH_WE_DATA_DIR','User')",
  "  soulDb    = [string][Environment]::GetEnvironmentVariable('DSH_SOUL_DATABASE','User')",
  "}",
  "$out.dshProcs = (Get-Process | Where-Object { $_.Path -like '*DeepSeek Harness*' } | Measure-Object).Count",
  "$aclText = (@(& icacls '__WS__' 2>&1) | ForEach-Object { [string]$_ }) -join $NL",
  "$out.aclOk = ($LASTEXITCODE -eq 0)",
  "$out.acl = $aclText",
  "$out | ConvertTo-Json -Depth 8 -Compress",
].join('\n');

function asArray(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function systemSnapshot(ws) {
  // 工作区路径嵌进脚本文本：UTF-16LE base64 传参，中文不会被控制台码页吃掉
  const script = SNAPSHOT_PS.replace('__WS__', String(ws).replace(/'/g, "''"));
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  const out = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], { timeout: 90000 });
  if (!out) return null;
  let j;
  try { j = JSON.parse(out); } catch { return null; }
  return {
    ok: true,
    execPolicy: j.execPolicy || { cu: 'Undefined', lm: 'Undefined', gpo: 'Undefined' },
    tasks: asArray(j.tasks).map((t) => ({ name: String(t.name || ''), state: String(t.state || ''), actions: String(t.actions || '') })),
    defender: { rtp: String((j.defender && j.defender.rtp) || 'unknown'), exclusions: String((j.defender && j.defender.exclusions) || '') },
    w32time: String(j.w32time || ''),
    longPaths: j.longPaths === null || j.longPaths === undefined ? '' : String(j.longPaths),
    rootCA: asArray(j.rootCA).map(String),
    env: {
      userPath: String((j.env && j.env.userPath) || ''),
      weDataDir: String((j.env && j.env.weDataDir) || ''),
      soulDb: String((j.env && j.env.soulDb) || ''),
    },
    dshProcs: Number(j.dshProcs) || 0,
    aclOk: Boolean(j.aclOk),
    acl: String(j.acl || ''),
  };
}

// netstat -ano 一次拿全：代理端口（J）和本地监听端口数（P）都从这份文本里读
export function netstatSnapshot() {
  return run('netstat', ['-ano'], { timeout: 20000 });
}

// Run 键一次查询：开机自启是否注册（K）和启动器路径是否存在（P）共用
export function runKeySnapshot() {
  return run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'DSH'], { timeout: 8000 });
}