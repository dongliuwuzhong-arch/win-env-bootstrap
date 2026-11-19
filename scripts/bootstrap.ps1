<#
  dsh-env-bootstrap / bootstrap.ps1
  ASCII-only on purpose: PowerShell 5.1 reads non-BOM UTF-8 as ANSI and mangles CJK.
  Chinese report lives in verify.mjs (Node handles UTF-8 fine).

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 -Check
    powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 -Apply
    powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 -Apply -WithProxy
    powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 -Apply -WithScheduledTasks
    powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 -RepairG2

  -RepairG2 repairs the G2 "plugin load prerequisites" block (host node_modules
  copies, the dsh-compaction-basic junction, local plugins, credentials template).
  -Apply implies -RepairG2. Everything is detect-then-fix: a second run changes
  nothing.
#>
param(
    [switch]$Check,
    [switch]$Apply,
    [switch]$WithProxy,
    [switch]$WithScheduledTasks,
    [switch]$RepairG2,
    [switch]$DedupPath,
    [string]$Workspace
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$script:gapsFound = 0
$script:gapsLeft = 0
$script:segBase = 0
$script:warns = 0
$script:fixes = 0

# -RepairG2 is the explicit switch; -Apply implies it (a bare-machine run should
# end usable, not just "installed some tools").
$script:doG2 = ($RepairG2 -or $Apply)
$script:manifestPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\manifest.json'
$script:manifestLoaded = $false
$script:manifest = $null

function Get-Manifest {
    # ReadAllText with an explicit UTF8 decoder: manifest.json carries no BOM, and
    # Get-Content on PS 5.1 would read it as ANSI and turn CJK dir names into mojibake.
    if ($script:manifestLoaded) { return $script:manifest }
    $script:manifestLoaded = $true
    if (-not (Test-Path -LiteralPath $script:manifestPath)) { return $null }
    try {
        $txt = [System.IO.File]::ReadAllText($script:manifestPath, [System.Text.Encoding]::UTF8)
        $script:manifest = $txt | ConvertFrom-Json
    } catch { $script:manifest = $null }
    return $script:manifest
}

function Get-G2Config {
    # manifest.json is the single source of truth. These literals are only the
    # fallback for a machine where the config file did not travel along.
    $cfg = [pscustomobject]@{
        junctionPackage    = 'dsh-compaction-basic'
        manualPackages     = @('cosmokit', 'dsh-compaction', 'dsh-compaction-basic', 'dsh-compaction-tool-result-pruner', 'schemastery')
        localPlugins       = @()
        hostNodeModulesRel = 'resources\app\dsh\node_modules'
        winBashPayloadRel  = '@linxin666\dsh-win-bash\runtime\win32-x64'
    }
    $m = Get-Manifest
    if ($m -and $m.g2) {
        if ($m.g2.junctionPackage)    { $cfg.junctionPackage = [string]$m.g2.junctionPackage }
        if ($m.g2.manualPackages)     { $cfg.manualPackages = @($m.g2.manualPackages) }
        if ($m.g2.localPlugins)       { $cfg.localPlugins = @($m.g2.localPlugins) }
        if ($m.g2.hostNodeModulesRel) { $cfg.hostNodeModulesRel = [string]$m.g2.hostNodeModulesRel }
        if ($m.g2.winBashPayloadRel)  { $cfg.winBashPayloadRel = [string]$m.g2.winBashPayloadRel }
    }
    return $cfg
}

function Get-LinkType($p) {
    try { return (Get-Item -LiteralPath $p -Force -ErrorAction Stop).LinkType } catch { return $null }
}

function Copy-Tree($src, $dst) {
    # -LiteralPath everywhere: CJK paths must never go through the wildcard resolver
    Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force -ErrorAction Stop
}

function Repair-ManualPackages($profNM, $hostNM, $cfg) {
    # These 5 @deepseek-ai packages are NOT in profile package.json dependencies -
    # they were placed by hand. dsh-compaction-basic is a code-level hard dep
    # (compaction.js imports it at runtime) and must be a junction so it follows
    # host upgrades instead of silently desyncing.
    $scope = Join-Path $profNM '@deepseek-ai'
    $hostScope = if ($hostNM) { Join-Path $hostNM '@deepseek-ai' } else { '' }
    foreach ($pkg in $cfg.manualPackages) {
        $dst = Join-Path $scope $pkg
        $src = if ($hostScope) { Join-Path $hostScope $pkg } else { '' }
        if (Test-Path -LiteralPath $dst) {
            $lt = Get-LinkType $dst
            if ($pkg -eq $cfg.junctionPackage) {
                if ($lt) { Say "  $pkg already linked ($lt), skip" 'ok' }
                else { Say "  $pkg is a plain copy - runs now, desyncs after a host upgrade" 'warn' }
            } else { Say "  $pkg present, skip" 'ok' }
            continue
        }
        if (-not $src -or -not (Test-Path -LiteralPath $src)) {
            Say "  $pkg missing and no host source to copy from" 'bad'
            continue
        }
        if (-not $script:doG2) {
            Say "  $pkg missing - rerun with -RepairG2 to copy from host" 'bad'
            continue
        }
        if (-not (Test-Path -LiteralPath $scope)) { New-Item -ItemType Directory -Path $scope -Force | Out-Null }
        try {
            if ($pkg -eq $cfg.junctionPackage) {
                New-Item -ItemType Junction -Path $dst -Target $src -ErrorAction Stop | Out-Null
                Say "  linked $pkg -> $src" 'fix'
            } else {
                Copy-Tree $src $dst
                Say "  copied $pkg from host" 'fix'
            }
        } catch { Say "  repair $pkg failed: $_" 'bad' }
    }
}

function Repair-LocalPlugins($profNM, $dshHome, $cfg) {
    # Local plugins are COPIES, not links: copying ~/.dsh without node_modules
    # loses all four, and every preset then loads without them.
    $srcRoot = Join-Path $dshHome 'plugins'
    foreach ($name in $cfg.localPlugins) {
        $dst = Join-Path $profNM $name
        if (Test-Path -LiteralPath $dst) { Say "  plugin $name present, skip" 'ok'; continue }
        $src = Join-Path $srcRoot $name
        if (-not (Test-Path -LiteralPath $src)) {
            Say "  plugin $name missing and no source at $src - copy from the old machine" 'bad'
            continue
        }
        if (-not $script:doG2) {
            Say "  plugin $name missing - rerun with -RepairG2 to copy from $srcRoot" 'bad'
            continue
        }
        try {
            Copy-Tree $src $dst
            Say "  copied plugin $name from $srcRoot" 'fix'
        } catch { Say "  copy plugin $name failed: $_" 'bad' }
    }
}

function Test-WinBashPayload($profNM, $hostNM, $cfg) {
    # The 16 MB MSYS payload ships INSIDE the plugin tarball, so nothing needs
    # downloading - it only has to be unpacked in place. Guidance only: guessing
    # a source path here would silently ship a dead win_bash.
    $rel = $cfg.winBashPayloadRel
    $seen = @()
    if ($profNM) { $seen += (Join-Path $profNM $rel) }
    if ($hostNM) { $seen += (Join-Path $hostNM $rel) }
    foreach ($c in $seen) {
        if (Test-Path -LiteralPath (Join-Path $c 'usr\bin\bash.exe')) { Say "win-bash payload ok" 'ok'; return }
    }
    Say "win-bash payload missing (no usr/bin/bash.exe under runtime\win32-x64)" 'warn'
    Say "  semi-auto: npm pack @linxin666/dsh-win-bash, then copy runtime\win32-x64 into the profile copy" 'warn'
}


function New-CredentialsTemplate($dshHome) {
    $cred = Join-Path $dshHome '.credentials.yaml'
    if (Test-Path -LiteralPath $cred) { Say ".credentials.yaml present, skip" 'ok'; return }
    if (-not $script:doG2) { Say ".credentials.yaml missing - rerun with -RepairG2 for a comment-only template" 'warn'; return }
    # Comment-only document on purpose: dsh-credentials-local treats an empty
    # document as an empty store, while any value written here would read as a
    # real key and fail auth later with a misleading error.
    $lines = @(
        '# .credentials.yaml - DSH credential store (provider-managed; DSH rewrites it)'
        '#'
        '# Empty template generated by dsh-env-bootstrap. It carries NO values.'
        '# Fill it from DSH itself (credentials UI or CLI), or write refs by hand:'
        '#'
        '#   version: 1'
        '#   refs:'
        '#     DEEPSEEK_API_KEY: <paste key here>'
        '#     OPENCODE_GO_API_KEY: <paste key here>'
        '#'
        '# refs: holds addressable API keys. records: holds provider-managed tokens'
        '# (deepseek-account-*, client-connection/*) - leave those to DSH.'
    )
    try {
        Set-Content -LiteralPath $cred -Value $lines -Encoding ASCII
        Say "wrote .credentials.yaml template (comments only, no values)" 'fix'
    } catch { Say "write .credentials.yaml template failed: $_" 'warn' }
}

function Say($msg, $level = 'info') {
    switch ($level) {
        'ok'   { Write-Host "[ OK ] $msg" -ForegroundColor Green }
        'warn' { Write-Host "[WARN] $msg" -ForegroundColor Yellow; $script:warns++ }
        'bad'  { Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:gapsFound++; $script:gapsLeft++ }
        # Only offset gaps opened in this segment. Cross-segment offset lets an unrelated
        # fix eat a hard gap and makes the exit code too low.
        'fix'  { Write-Host "[FIX ] $msg" -ForegroundColor Cyan; $script:fixes++; if ($script:gapsLeft -gt $script:segBase) { $script:gapsLeft-- } }
        'head' { Write-Host ""; Write-Host "--- $msg ---" -ForegroundColor White; $script:segBase = $script:gapsLeft }
        default { Write-Host "       $msg" }
    }
}

function Resolve-DshRoot {
    # Host path must not be hardcoded: under Program Files, patches that rewrite host files fail to land
    foreach ($c in @('C:\Software\DSH', 'C:\Program Files\DSH')) {
        if (Test-Path (Join-Path $c 'DeepSeek Harness.exe')) { return $c }
    }
    try {
        $u = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction Stop |
             Where-Object { $_.DisplayName -match 'DeepSeek' } | Select-Object -First 1
        if ($u -and $u.InstallLocation -and (Test-Path $u.InstallLocation)) { return $u.InstallLocation }
    } catch { }
    return $null
}

function Get-CmdVersion($exe, $argList) {
    # Must require exit code 0 AND a non-empty non-error line.
    # "|| $out" would treat the Microsoft Store python stub (exit 9009,
    # stderr "Python was not found...") as INSTALLED and print the error
    # text as a version number.
    try {
        $raw = & $exe $argList 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        # Exit code 0 means it worked - accept text from stderr too (some tools
        # print their version banner there). Only skip EMPTY lines.
        foreach ($line in @($raw)) {
            $t = ($line -as [string]).Trim()
            if ($t) { return $t }
        }
    } catch { }
    return $null
}

function Test-PathEntry($dir) {
    # Check BOTH scopes: 7-Zip installer "for all users" writes Machine PATH only
    $key = $dir.TrimEnd('\').ToLower()
    foreach ($scope in @('User', 'Machine')) {
        $p = [Environment]::GetEnvironmentVariable('Path', $scope)
        if (-not $p) { continue }
        foreach ($e in @($p -split ';' | Where-Object { $_ -ne '' })) {
            if ($e.TrimEnd('\').ToLower() -eq $key) { return $true }
        }
    }
    return $false
}

function Add-PathEntry($dir) {
    $p = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $p) { $p = '' }
    # Backup into ~/.dsh, not C:\Windows\Temp (gets cleaned, nobody looks there)
    $backupDir = Join-Path $env:USERPROFILE '.dsh'
    if (-not (Test-Path $backupDir)) { $backupDir = 'C:\Windows\Temp' }
    $backup = Join-Path $backupDir ('path-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    try {
        Set-Content -Path $backup -Value $p -Encoding UTF8 -ErrorAction Stop
        Say "PATH backup -> $backup"
    } catch {
        Say "PATH backup FAILED, refusing to touch PATH: $_" 'bad'
        return $false
    }
    # CRITICAL: wrap in @(). When $p has exactly ONE entry, -split returns a
    # scalar String, and ($parts + $dir) does STRING CONCATENATION instead of
    # array append -> whole PATH becomes "C:\AAAC:\BBB" (destroyed).
    $parts = @($p -split ';' | Where-Object { $_ -ne '' })
    $key = $dir.TrimEnd('\').ToLower()
    foreach ($e in $parts) {
        if ($e.TrimEnd('\').ToLower() -eq $key) { return $false }
    }
    $new = (@($parts) + $dir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $new, 'User')
    Say "added to PATH: $dir" 'fix'
    return $true
}

function Remove-PathDuplicates {
    # Real dedupe (docs used to claim auto-dedupe while the code never did it).
    $p = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $p) { return }
    $parts = @($p -split ';' | Where-Object { $_ -ne '' })
    $seen = @{}
    $clean = @()
    foreach ($e in $parts) {
        $k = $e.TrimEnd('\\').ToLower()
        if (-not $seen.ContainsKey($k)) { $seen[$k] = $true; $clean += $e }
    }
    if ($clean.Count -eq $parts.Count) {
        Say "user PATH has no duplicates ($($parts.Count) entries)" 'ok'
        return
    }
    $backupDir = Join-Path $env:USERPROFILE '.dsh'
    if (-not (Test-Path $backupDir)) { $backupDir = 'C:\Windows\Temp' }
    $backup = Join-Path $backupDir ('path-dedup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.txt')
    try {
        Set-Content -Path $backup -Value $p -Encoding UTF8 -ErrorAction Stop
    } catch {
        Say "PATH backup FAILED, refusing to dedupe: $_" 'bad'
        return
    }
    [Environment]::SetEnvironmentVariable('Path', ($clean -join ';'), 'User')
    Say "deduped user PATH: $($parts.Count) -> $($clean.Count) entries (backup: $backup)" 'fix'
}

function Get-WingetId($toolName, $fallback) {
    # manifest is the single config source: editing tools[].winget in
    # config/manifest.json must actually take effect, not just be read by tests.
    try {
        $mf = Get-Manifest
        if ($mf -and $mf.tools) {
            $t = @($mf.tools | Where-Object { $_.name -eq $toolName }) | Select-Object -First 1
            if ($t -and $t.winget) { return [string]$t.winget }
        }
    } catch { }
    return $fallback
}

function Install-Pkg($id, $label, $optional, $probeCmd, $probeArgs) {
    if (-not $Apply) {
        # Optional tools must NOT count as hard gaps - otherwise -Check exit 1
        # just because ffmpeg is missing, and the exit code stops meaning anything.
        if ($optional) { Say "$label missing - optional, install with -Apply ($id)" 'warn' }
        else { Say "$label missing - rerun with -Apply to install ($id)" 'bad' }
        return
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Say "$label missing, winget unavailable - install manually" 'bad'
        return
    }
    # Packages that need elevation fail silently in a non-admin session - probe first.
    $isAdmin = $false
    try {
        $id2 = [Security.Principal.WindowsIdentity]::GetCurrent()
        $isAdmin = ([Security.Principal.WindowsPrincipal]$id2).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { }
    Say "installing $label via winget ($id) ..."
    try {
        # --disable-interactivity: an interactive prompt would hang an unattended run.
        & winget install --id $id --exact --accept-source-agreements --accept-package-agreements --silent --disable-interactivity 2>&1 | Out-Null
        $rc = $LASTEXITCODE
        # Do not trust winget's exit code - probe the command after install.
        # Probe the command the caller passed explicitly instead of wildcard-matching
        # $label. label is a display string; renaming it would silently break the probe.
        $probe = if ($probeCmd) { Get-CmdVersion $probeCmd $probeArgs } else { $null }
        if ($probe) { Say "$label installed ($probe)" 'fix' }
        elseif ($rc -eq 0) { Say "$label winget returned 0 but the command is not resolvable yet - restart the shell" 'warn' }
        elseif ($rc -eq -1978335212) { Say "$label already installed (winget -1978335212)" 'warn' }
        else {
            $why = if (-not $isAdmin) { ' (not elevated - may need an admin shell)' } else { '' }
            Say "$label install failed: winget rc=$rc$why" 'bad'
        }
    } catch { Say "$label install failed: $_" 'bad' }
}

Write-Host ""
Write-Host "=== dsh-env-bootstrap ===" -ForegroundColor Cyan
Write-Host ("mode : " + $(if ($Apply) { 'APPLY' } else { 'CHECK' }))
Write-Host ("host : " + [Environment]::OSVersion.VersionString)
Write-Host ("pwsh : " + $PSVersionTable.PSVersion.ToString())
Write-Host ("arch : " + $env:PROCESSOR_ARCHITECTURE)
Write-Host ""

# ============ A. core runtimes ============
Say 'A. core runtimes' 'head'

$node = Get-CmdVersion 'node' '--version'
if ($node) {
    $major = 0
    if ($node -match 'v(\d+)') { $major = [int]$Matches[1] }
    if ($major -ge 24) { Say "node $node" 'ok' }
    else { Say "node $node (need 24+)" 'bad' }
} else { Say "node not found" 'bad'; Install-Pkg (Get-WingetId 'node' 'OpenJS.NodeJS.LTS') 'Node.js' $false 'node' '--version' }

$python = Get-CmdVersion 'python' '--version'
$pyName = 'python'
if (-not $python) { $python = Get-CmdVersion 'python3' '--version'; if ($python) { $pyName = 'python3' } }
if ($python) {
    if ($python -match '3\.(\d+)') {
        $pyMinor = [int]$Matches[1]
        if ($pyMinor -ge 12) { Say "python $python" 'ok' }
        else { Say "python $python (need 3.12+)" 'bad' }
    } else { Say "python $python" 'ok' }
} else { Say "python not found" 'bad'; Install-Pkg (Get-WingetId 'python' 'Python.Python.3.12') 'Python 3.12' $false 'python' '--version' }

$git = Get-CmdVersion 'git' '--version'
if ($git) { Say "git $git" 'ok' } else { Say "git not found (optional but recommended)" 'warn'; Install-Pkg (Get-WingetId 'git' 'Git.Git') 'Git' $true 'git' '--version' }

# 'curl' is an alias for Invoke-WebRequest in PS 5.1 - must use curl.exe
$curl = Get-CmdVersion 'curl.exe' '--version'
if ($curl) { Say "curl present" 'ok' } else { Say "curl not found" 'warn' }

$winget = Get-CmdVersion 'winget' '--version'
if ($winget) { Say "winget $winget" 'ok' } else { Say "winget not found (cannot auto-install)" 'warn' }

$pnpm = Get-CmdVersion 'pnpm' '--version'
# DSH ships its own pnpm under resources/runtime/primary-runtime/dependencies/pnpm
$pnpmBundled = $null
$rootForPnpm = Resolve-DshRoot
if ($rootForPnpm) {
    $p = Join-Path $rootForPnpm 'resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
    if (Test-Path $p) { $pnpmBundled = $p }
}
if ($pnpm) { Say "pnpm $pnpm" 'ok' }
elseif ($pnpmBundled) { Say "pnpm shipped with DSH ($pnpmBundled)" 'ok' }
else {
    Say "pnpm not found (neither in PATH nor bundled with DSH)" 'bad'
    if ($Apply -and (Get-Command npm -ErrorAction SilentlyContinue)) {
        Say "installing pnpm via npm -g ..."
        & npm install -g pnpm 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Say "pnpm installed" 'fix' } else { Say "pnpm install failed" 'warn' }
    }
}

# ============ B. archive ============
Say 'B. archive' 'head'
$sevenCandidates = @('C:\Software\7-Zip', 'C:\Program Files\7-Zip', 'C:\Program Files (x86)\7-Zip')
$sevenDir = $null
foreach ($c in $sevenCandidates) {
    if (Test-Path (Join-Path $c '7z.exe')) { $sevenDir = $c; break }
}
if ($sevenDir) {
    Say "7z.exe at $sevenDir" 'ok'
    if (Test-PathEntry $sevenDir) { Say "already in PATH" 'ok' }
    else {
        Say "NOT in PATH - classic trap" 'bad'
        if ($Apply) { Add-PathEntry $sevenDir | Out-Null }
    }
} else {
    Say "7-Zip not installed" 'bad'
    Install-Pkg (Get-WingetId '7z' '7zip.7zip') '7-Zip' $false '7z' ''
}

# ============ C. media ============
Say 'C. media' 'head'
$ffmpeg = Get-CmdVersion 'ffmpeg' '-version'
if ($ffmpeg) { Say "ffmpeg present" 'ok' } else { Say "ffmpeg not found (media-processor needs it)" 'warn'; Install-Pkg (Get-WingetId 'ffmpeg' 'Gyan.FFmpeg') 'FFmpeg' $true 'ffmpeg' '-version' }

$ytdlp = Get-CmdVersion 'yt-dlp' '--version'
$magick = Get-CmdVersion 'magick' '-version'
if ($magick) { Say "ImageMagick present" 'ok' } else { Say "ImageMagick not found (optional)" 'warn'; Install-Pkg (Get-WingetId 'magick' 'ImageMagick.ImageMagick') 'ImageMagick' $true 'magick' '-version' }
if ($ytdlp) { Say "yt-dlp $ytdlp" 'ok' } else { Say "yt-dlp not found (video-transcript-downloader needs it)" 'warn'; Install-Pkg (Get-WingetId 'yt-dlp' 'yt-dlp.yt-dlp') 'yt-dlp' $true 'yt-dlp' '--version' }

# ============ D. browser automation ============
Say 'D. browser automation' 'head'
$chromeCands = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $null
foreach ($c in $chromeCands) { if (Test-Path $c) { $chrome = $c; break } }
if ($chrome) { Say "chrome: $chrome" 'ok' } else { Say "Chrome not found (fetch-render.mjs needs it)" 'warn'; Install-Pkg (Get-WingetId 'chrome' 'Google.Chrome') 'Google Chrome' $true 'chrome' '' }

# Workspace: -Workspace param > DSH_WORKSPACE env > manifest.workspace.default > built-in default
$wsPath = $Workspace
if (-not $wsPath) { $wsPath = $env:DSH_WORKSPACE }
if (-not $wsPath) {
    $mf = Get-Manifest
    if ($mf -and $mf.workspace -and $mf.workspace.default) { $wsPath = $mf.workspace.default }
}
if (-not $wsPath) { $wsPath = 'C:\DSH' + [char]0x7A7A + [char]0x95F4 }
$puppeteerDir = Join-Path $wsPath '_tools\browser\node_modules\puppeteer'
if (Test-Path $puppeteerDir) { Say "puppeteer installed" 'ok' }
else { Say "puppeteer missing (run npm i in _tools/browser)" 'warn' }

# ============ E. reverse engineering ============
Say 'E. reverse engineering (optional)' 'head'
$frida = Get-CmdVersion 'frida' '--version'
if ($frida) { Say "frida $frida" 'ok' }
else { Say "frida not found (wechat-history skill needs it)" 'warn' }

# ============ F. python packages ============
Say 'F. python packages' 'head'
if ($python) {
    $pyCmd = Get-Command $pyName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pyCmd) {
        $pyExe = $pyCmd.Source
        $pipText = ''
        try { $pipText = (& $pyExe -m pip list 2>&1 | Out-String) } catch { $pipText = '' }
        if (-not $pipText) {
            Say "pip list failed (pip not installed?)" 'warn'
        } else {
            $needPkgs = @('pillow', 'pyyaml')
            foreach ($pkg in $needPkgs) {
                if ($pipText -match ('(?im)^' + $pkg + '\s')) { Say "python:$pkg" 'ok' }
                else {
                    Say "python:$pkg missing" 'warn'
                    if ($Apply) {
                        # $LASTEXITCODE survives across statements - if the call throws,
                        # it still holds the PREVIOUS command's code, so we would lie
                        # about installing successfully.
                        $global:LASTEXITCODE = -1
                        try { & $pyExe -m pip install $pkg --quiet 2>&1 | Out-Null } catch { }
                        if ($LASTEXITCODE -eq 0) { Say "installed $pkg" 'fix' } else { Say "$pkg install failed" 'warn' }
                    }
                }
            }
        }
    }
}

# ============ G. DSH host ============
Say 'G. DSH host' 'head'
$DshRoot = Resolve-DshRoot
$dshExe = if ($DshRoot) { Join-Path $DshRoot 'DeepSeek Harness.exe' } else { $null }

if ($dshExe) { Say "host: $dshExe" 'ok' } else { Say "DSH host not found (run official installer first)" 'bad' }

$appDir = if ($DshRoot) { Join-Path $DshRoot 'resources\app' } else { '' }
if (Test-Path $appDir) {
    Say "unpacked tree exists" 'ok'
    $appPkg = Join-Path $appDir 'package.json'
    if (Test-Path $appPkg) {
        try {
            $v = (Get-Content $appPkg -Raw | ConvertFrom-Json).version
            Say "version: $v" 'ok'
        } catch { Say "package.json unreadable" 'warn' }
    }
} else { Say "unpacked tree missing" 'warn' }

$dshHome = Join-Path $env:USERPROFILE '.dsh'
if (Test-Path $dshHome) { Say ".dsh: $dshHome" 'ok' } else { Say ".dsh missing" 'bad' }

$profPkg = Join-Path $dshHome 'profiles\desktop\package.json'
if (Test-Path $profPkg) {
    try {
        $j = Get-Content $profPkg -Raw | ConvertFrom-Json
        $bundles = 0
        if ($j.dsh -and $j.dsh.profile -and $j.dsh.profile.bundles) { $bundles = $j.dsh.profile.bundles.Count }
        Say "profile bundles: $bundles" 'ok'
    } catch { Say "profile package.json unreadable" 'warn' }
} else { Say "profile missing" 'warn' }

$cred = Join-Path $dshHome '.credentials.yaml'
if (Test-Path $cred) { Say ".credentials.yaml present" 'ok' } else { Say ".credentials.yaml missing (fill API keys)" 'warn' }

# ============ G2. plugin load prerequisites ============
# Everything here fails at LOAD time (throw on startup), not as a missing
# feature - which is why it gets its own repair pass instead of a warning.
Say 'G2. plugin load prerequisites' 'head'

$cfgG2 = Get-G2Config
$profNM = Join-Path $dshHome 'profiles\desktop\node_modules'
$hostNM = ''
if ($DshRoot) {
    $hostNM = Join-Path $DshRoot $cfgG2.hostNodeModulesRel
    if (-not (Test-Path -LiteralPath $hostNM)) { $hostNM = '' }
}
if ($hostNM) { Say "host node_modules: $hostNM" 'ok' }
else { Say "host node_modules not found (repairs needing a host source will report bad)" 'warn' }

if (-not (Test-Path -LiteralPath $profNM)) {
    Say "profile node_modules missing: $profNM (launch DSH once, then rerun)" 'bad'
} else {
    Repair-ManualPackages $profNM $hostNM $cfgG2
    Repair-LocalPlugins $profNM $dshHome $cfgG2
    Test-WinBashPayload $profNM $hostNM $cfgG2
}
New-CredentialsTemplate $dshHome

# DSH host itself and an over-new soul db are guidance only - this script does
# not install the host and must not "fix" a schema gate by downgrading data.
if (-not $DshRoot) { Say "DSH host missing: install it with the official installer, then rerun (this script never installs the host)" 'warn' }

# ============ H. workspace ============
Say 'H. workspace' 'head'
if (Test-Path $wsPath) {
    Say "workspace: $wsPath" 'ok'
    $needDirs = @('tools','_tools','knowledge','reports','_diag','archives',([char]0x5BF9 + [char]0x8BDD + [char]0x5B58 + [char]0x6863))
    $mWs = Get-Manifest
    if ($mWs -and $mWs.workspaceDirs) { $needDirs = @($mWs.workspaceDirs) }
    foreach ($n in $needDirs) {
        $full = Join-Path $wsPath $n
        if (Test-Path $full) { Say "  $n" 'ok' }
        else {
            Say "  missing: $n" 'warn'
            if ($Apply) { New-Item -ItemType Directory -Path $full -Force | Out-Null; Say "  created: $n" 'fix' }
        }
    }
    $personaDir = Join-Path $wsPath ('knowledge\persona')
    if (Test-Path $personaDir) {
        $files = @('SOUL.md','IDENTITY.md','USER.md','MEMORY.md')
        $found = 0
        foreach ($f in $files) { if (Test-Path (Join-Path $personaDir $f)) { $found++ } }
        if ($found -eq 4) { Say "persona 4/4" 'ok' } else { Say "persona $found/4" 'warn' }
    }
    $skillsDir = Join-Path $wsPath '.agents\skills'
    if (Test-Path $skillsDir) {
        $cnt = (Get-ChildItem $skillsDir -Directory).Count
        Say "skills: $cnt dirs" 'ok'
    } else { Say "skills dir missing" 'warn' }
} else {
    Say "workspace missing: $wsPath (copy from old machine)" 'bad'
}

# ============ I. system config ============
Say 'I. system config' 'head'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @()
if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ -ne '' } }
Say ("user PATH entries: " + $entries.Count)
$dups = $entries | Group-Object | Where-Object { $_.Count -gt 1 }
if ($dups) {
    foreach ($d in $dups) { Say ("duplicate PATH: " + $d.Name) 'warn' }
    if ($DedupPath -or $Apply) { Remove-PathDuplicates }
} else { Say "no duplicate PATH entries" 'ok' }

# Cannot use Get-ExecutionPolicy: this script is normally launched with
# -ExecutionPolicy Bypass, and the Process scope outranks everything, so the
# effective value would ALWAYS read "Bypass" and the check could never fail.
# Read the persisted scopes straight from the registry instead.
function Get-PersistedPolicy($hive) {
    $k = $hive + ':\SOFTWARE\Microsoft\PowerShell\1\ShellIds\Microsoft.PowerShell'
    try {
        $v = (Get-ItemProperty -Path $k -ErrorAction Stop).ExecutionPolicy
        # Key present but value unset -> $null or empty; $null -ne 'Undefined' would count that as effective
        if ($null -eq $v) { return 'Undefined' }
        $s = [string]$v
        if ($s -eq '' -or $s -eq $null) { return 'Undefined' }
        return $s
    } catch { return 'Undefined' }
}
function Get-GroupPolicy {
    try {
        $v = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell' -ErrorAction Stop).ExecutionPolicy
        if ($null -eq $v) { return 'Undefined' }
        $s = [string]$v
        if ($s -eq '') { return 'Undefined' }
        return $s
    } catch { return 'Undefined' }
}
$epCU  = Get-PersistedPolicy 'HKCU'
$epLM  = Get-PersistedPolicy 'HKLM'
$epMachine = Get-GroupPolicy
# Precedence: GroupPolicy > Machine > User; all three normalized, empty collapses to 'Undefined'
$epEff = 'Undefined'
if ($epMachine -ne 'Undefined') { $epEff = $epMachine }
elseif ($epLM -ne 'Undefined') { $epEff = $epLM }
elseif ($epCU -ne 'Undefined') { $epEff = $epCU }
if ($epEff -eq 'Restricted' -or $epEff -eq 'AllSigned') {
    Say "ExecutionPolicy effective = $epEff (blocks scripts; CU=$epCU LM=$epLM)" 'bad'
    if ($Apply) {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
        Say "set ExecutionPolicy CurrentUser -> RemoteSigned" 'fix'
    }
} else {
    Say "ExecutionPolicy effective = $epEff (CU=$epCU LM=$epLM)" 'ok'
}

# scheduled tasks
$tasks = @()
$taskQueryFailed = $false
try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -match 'DSH' })
} catch {
    $taskQueryFailed = $true
    Say ("scheduled task query FAILED (not 'none exist'): " + $_) 'warn'
}
if (-not $taskQueryFailed) {
    if ($tasks.Count -gt 0) {
        foreach ($t in $tasks) { Say ("task: " + $t.TaskName + " = " + $t.State) 'ok' }
    } else { Say "no DSH scheduled tasks (dialog archive will not run)" 'warn' }
}

# console codepage
$cp = (chcp) 2>&1
if ($cp -match '65001') { Say "console codepage UTF-8" 'ok' }
else { Say ("console codepage: " + $cp + " (UTF-8 recommended)") 'warn' }

# ============ J. network ============
Say 'J. network' 'head'
$proxyListen = $false
try {
    $nl = netstat -an | Select-String '127.0.0.1:7897'
    if ($nl) { $proxyListen = $true }
} catch { }
if ($proxyListen) { Say "local proxy 7897 listening" 'ok' }
else { Say "local proxy 7897 not listening (DSH will go direct)" 'warn' }

# ============ K. proxy launcher (opt-in) ============
if ($WithProxy -and $Apply) {
    Say 'K. proxy launcher' 'head'
    $vbs = Join-Path $dshHome 'start-dsh-proxy.vbs'
    if (-not $dshExe) {
        Say "DSH exe not found, skip" 'warn'
    } else {
        $vbsBody = @'
' Auto-generated by dsh-env-bootstrap
' Wait for Clash, then launch DSH through the local proxy.
Option Explicit
Dim sh, env
WScript.Sleep 15000
Set sh = CreateObject("WScript.Shell")
Set env = sh.Environment("PROCESS")
env("HTTP_PROXY")  = "http://127.0.0.1:7897"
env("HTTPS_PROXY") = "http://127.0.0.1:7897"
env("NODE_USE_ENV_PROXY") = "1"
env("NO_PROXY") = "127.0.0.1,localhost"
sh.Run """__DSHEXE__"" --proxy-server=""http://127.0.0.1:7897"" --proxy-bypass-list=""127.0.0.1;localhost;<local>""", 0, False
'@
        $vbsBody = $vbsBody.Replace('__DSHEXE__', $dshExe)
        # MUST be UTF-16LE ("Unicode"), NOT UTF8:
        #   - ASCII  -> non-ASCII chars become '?'
        #   - UTF8   -> PS 5.1 writes a BOM, and wscript/cscript REJECT UTF-8 BOM
        #               ("Microsoft VBScript compilation error: Invalid character")
        #   - Unicode -> UTF-16LE, wscript accepts it and CJK survives
        Set-Content -Path $vbs -Value $vbsBody -Encoding Unicode
        $bytes = [System.IO.File]::ReadAllBytes($vbs)
        $ok = ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE)
        if (-not $ok) {
            Say "VBS is not UTF-16LE - wscript will reject it, inspect $vbs" 'bad'
        } else {
            Say "wrote $vbs (UTF-16LE)" 'fix'
        }
        if ($ok) {
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
            New-ItemProperty -Path $runKey -Name 'DSH' -Value ('wscript.exe "' + $vbs + '"') -PropertyType String -Force | Out-Null
            Say "autorun registered: DSH" 'fix'
        } else {
            Say "skip autorun: VBS is broken" 'warn'
        }
    }
}

# ============ L. scheduled tasks (opt-in) ============
if ($WithScheduledTasks -and $Apply) {
    Say 'L. scheduled tasks' 'head'
    $exportScript = Join-Path $wsPath 'tools\session-export.mjs'
    if ((Test-Path $exportScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        $act = New-ScheduledTaskAction -Execute 'node' -Argument ('"' + $exportScript + '" --days=3') -WorkingDirectory $wsPath
        $trg = New-ScheduledTaskTrigger -Daily -At '23:30'
        try {
            Register-ScheduledTask -TaskName 'DSH-DialogArchive' -Action $act -Trigger $trg -Description 'DSH daily dialog archive' -Force | Out-Null
            Say "registered DSH-DialogArchive (daily 23:30)" 'fix'
        } catch { Say "failed to register task: $_" 'warn' }
    } else {
        Say "session-export.mjs missing, skip task" 'warn'
    }
}

# ============ summary ============
Write-Host ""
Write-Host "--- summary ---"
Write-Host ("gaps found : " + $script:gapsFound)
Write-Host ("gaps left  : " + $script:gapsLeft) -ForegroundColor $(if ($script:gapsLeft -gt 0) { 'Red' } else { 'Green' })
Write-Host ("warnings  : " + $script:warns) -ForegroundColor Yellow
if ($Apply) { Write-Host ("fixes     : " + $script:fixes) -ForegroundColor Cyan }
else { Write-Host "run with -Apply to install / repair." }

Write-Host ""
Write-Host "next: restart the shell so PATH changes take effect, then run verify.mjs"
# Exit code contract, same as verify.mjs: 0 all pass / 1 hard gap / 2 warnings only
$exitCode = 0
if ($script:gapsLeft -gt 0) { $exitCode = 1 }
elseif ($script:warns -gt 0) { $exitCode = 2 }
exit $exitCode
