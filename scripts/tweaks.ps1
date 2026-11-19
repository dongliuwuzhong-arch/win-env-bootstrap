<#
  dsh-env-bootstrap / tweaks.ps1 - opt-in Windows tuning.
  Separated from environment completion on purpose: bootstrap.ps1 converges the
  toolchain, this script only touches OS settings you explicitly name.
  Report-first: -List probes state and changes nothing; -Apply / -Revert act.
  Metadata (name / what / revert / requiresAdmin) lives in config/manifest.json
  under "tweaks" - the single config source. Actions live here.

  Usage:
    powershell -File tweaks.ps1 -List
    powershell -File tweaks.ps1 -Apply longpaths,gamebar-off
    powershell -File tweaks.ps1 -Apply all
    powershell -File tweaks.ps1 -Revert hiberfil-off
#>
param(
    [switch]$List,
    [string[]]$Apply,
    [string[]]$Revert,
    [string]$Workspace
)

$ErrorActionPreference = 'Continue'
$script:failCount = 0
$script:hadUnknown = $false
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Say($msg, $level = 'info') {
    switch ($level) {
        'ok'   { Write-Host "[ OK ] $msg" -ForegroundColor Green }
        'warn' { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
        'bad'  { Write-Host "[FAIL] $msg" -ForegroundColor Red }
        'fix'  { Write-Host "[FIX ] $msg" -ForegroundColor Cyan }
        'head' { Write-Host ""; Write-Host "--- $msg ---" -ForegroundColor White }
        default { Write-Host "       $msg" }
    }
}

function Test-IsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Get-DefenderTargets {
    # workspace + DSH host install dir: the two IO-heavy trees
    $t = @(Resolve-Workspace)
    foreach ($c in @('C:\Software\DSH', 'C:\Program Files\DSH')) {
        if (Test-Path $c) { $t += $c; break }
    }
    return $t
}

function Get-TweakMeta {
    $mfPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\manifest.json'
    try {
        $txt = [System.IO.File]::ReadAllText($mfPath, [System.Text.Encoding]::UTF8)
        return @(($txt | ConvertFrom-Json).tweaks)
    } catch { return @() }
}

# Workspace resolution: -Workspace > DSH_WORKSPACE env > manifest default > built-in.
# Same order as bootstrap.ps1 / scripts/lib/paths.js - keep all three in sync.
function Resolve-Workspace {
    if ($Workspace) { return $Workspace }
    if ($env:DSH_WORKSPACE) { return $env:DSH_WORKSPACE }
    try {
        $mfPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\manifest.json'
        $txt = [System.IO.File]::ReadAllText($mfPath, [System.Text.Encoding]::UTF8)
        $d = ($txt | ConvertFrom-Json).workspace.default
        if ($d) { return [string]$d }
    } catch { }
    return 'C:\DSH' + [char]0x7A7A + [char]0x95F4
}

function Get-TweakState($id) {
    switch ($id) {
        'longpaths' {
            try {
                $v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled
                if ($v -eq 1) { return 'applied' } else { return 'not-applied' }
            } catch { return 'unknown' }
        }
        'power-highperf' {
            try {
                $g = (& powercfg /getactivescheme 2>&1 | Out-String)
                if ($g -match '8c5e7fda') { return 'applied' } else { return 'not-applied' }
            } catch { return 'unknown' }
        }
        'gamebar-off' {
            # Set-Tweak writes TWO values (AppCaptureEnabled + GameDVR_Enabled), so the
            # probe must check both - one value would trust a half-written state (#11)
            try {
                $a = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' -Name AppCaptureEnabled -ErrorAction Stop).AppCaptureEnabled
                $g = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameConfigStore' -Name GameDVR_Enabled -ErrorAction Stop).GameDVR_Enabled
                if ($a -eq 0 -and $g -eq 0) { return 'applied' } else { return 'not-applied' }
            } catch { return 'unknown' }
        }
        'defender-exclusions' {
            try {
                $paths = @((Get-MpPreference -ErrorAction Stop).ExclusionPath)
                foreach ($t in @(Get-DefenderTargets)) {
                    if ($paths -notcontains $t) { return 'not-applied' }
                }
                return 'applied'
            } catch { return 'unknown' }
        }
        'hiberfil-off' {
            # Test-Path is always FALSE for kernel-locked system files (pagefile/hiberfil
            # class): 'cannot see' would be misread as 'does not exist' and always report
            # applied. Registry is the truth; file probe is fallback only (#3)
            try {
                $h = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -Name HibernateEnabled -ErrorAction Stop).HibernateEnabled
                if ($h -eq 0) { return 'applied' } else { return 'not-applied' }
            } catch {
                if ([System.IO.File]::Exists('C:\hiberfil.sys')) { return 'not-applied' } else { return 'applied' }
            }
        }
        default { return 'unknown' }
    }
}

function Set-Tweak($id, $on) {
    switch ($id) {
        'longpaths' {
            $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
            if ($on) { Set-ItemProperty -Path $key -Name LongPathsEnabled -Value 1 -Type DWord }
            else { Set-ItemProperty -Path $key -Name LongPathsEnabled -Value 0 -Type DWord }
        }
        'power-highperf' {
            # High performance / Balanced scheme GUIDs. Check powercfg exit code:
            # without it 'reverted' is an unverified assertion (#10)
            if ($on) { & powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c | Out-Null }
            else { & powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e | Out-Null }
            if ($LASTEXITCODE -ne 0) { return $false }
        }
        'gamebar-off' {
            $dvr = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR'
            $cfg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameConfigStore'
            if (-not (Test-Path $dvr)) { New-Item -Path $dvr -Force | Out-Null }
            if (-not (Test-Path $cfg)) { New-Item -Path $cfg -Force | Out-Null }
            $v = if ($on) { 0 } else { 1 }
            Set-ItemProperty -Path $dvr -Name AppCaptureEnabled -Value $v -Type DWord
            Set-ItemProperty -Path $cfg -Name GameDVR_Enabled -Value $v -Type DWord
        }
        'defender-exclusions' {
            foreach ($t in @(Get-DefenderTargets)) {
                try {
                    if ($on) { Add-MpPreference -ExclusionPath $t }
                    else { Remove-MpPreference -ExclusionPath $t }
                } catch { Say "defender exclusion failed for ${t}: $_" 'warn' }
            }
        }
        'hiberfil-off' {
            if ($on) { & powercfg /hibernate off | Out-Null }
            else { & powercfg /hibernate on | Out-Null }
            if ($LASTEXITCODE -ne 0) { return $false }
        }
        default { Say "unknown tweak id: $id" 'warn'; return $false }
    }
    return $true
}

$metas = Get-TweakMeta
if (-not $metas.Count) { Say "manifest has no tweaks list" 'bad'; exit 1 }

$isAdmin = Test-IsAdmin

if ($List -or (-not $Apply -and -not $Revert)) {
    Say 'tweaks (opt-in; nothing is applied by -List)' 'head'
    foreach ($t in $metas) {
        $st = Get-TweakState ([string]$t.id)
        $adm = if ($t.requiresAdmin) { ' [admin]' } else { '' }
        Say ("{0,-22} {1,-12} {2}{3}" -f $t.id, $st, $t.name, $adm)
    }
    Say ""
    Say "apply with: powershell -File tweaks.ps1 -Apply <id|all>   revert with: -Revert <id|all>"
    exit 0
}

if ($Revert) {
    foreach ($id in @($Revert)) {
        $targets = if ($id -eq 'all') { @($metas | ForEach-Object { [string]$_.id }) } else { @($id) }
        foreach ($tid in $targets) {
            $meta = @($metas | Where-Object { [string]$_.id -eq $tid }) | Select-Object -First 1
            if (-not $meta) { Say "unknown tweak: $tid" 'warn'; $script:hadUnknown = $true; continue }
            if ($meta.requiresAdmin -and -not $isAdmin) { Say "$tid needs an admin shell" 'bad'; $script:failCount++; continue }
            Say ("reverting " + $tid + " (" + $meta.revert + ") ...")
            if (Set-Tweak $tid $false) {
                Say "$tid reverted" 'fix'
                if ((Get-TweakState $tid) -eq 'applied') { Say "$tid still shows applied after revert" 'warn'; $script:failCount++ }
            } else { Say "$tid revert failed" 'bad'; $script:failCount++ }
        }
    }
}

if ($Apply) {
    foreach ($id in @($Apply)) {
        $targets = if ($id -eq 'all') { @($metas | ForEach-Object { [string]$_.id }) } else { @($id) }
        foreach ($tid in $targets) {
            $meta = @($metas | Where-Object { [string]$_.id -eq $tid }) | Select-Object -First 1
            if (-not $meta) { Say "unknown tweak: $tid" 'warn'; $script:hadUnknown = $true; continue }
            if ($meta.requiresAdmin -and -not $isAdmin) { Say "$tid needs an admin shell" 'bad'; $script:failCount++; continue }
            Say ("applying " + $tid + " ...")
            if (Set-Tweak $tid $true) {
                $st = Get-TweakState $tid
                if ($st -eq 'applied') { Say "$tid applied (revert: $($meta.revert))" 'fix' }
                else { Say "$tid wrote but probe says: $st" 'warn'; $script:failCount++ }
            } else { Say "$tid apply failed" 'bad'; $script:failCount++ }
        }
    }
}
# Exit codes: 64 usage error (unknown id) / 1 something failed (admin missing, write
# failed, post-probe disagrees) / 0 all good
if ($script:hadUnknown) { exit 64 }
if ($script:failCount -gt 0) { exit 1 }
exit 0
