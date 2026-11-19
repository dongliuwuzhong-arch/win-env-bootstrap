<#
  dsh-env-bootstrap / smoke.ps1
  One-command local smoke test: syntax -> contract tests -> fast verify segment -> exit codes.

  ASCII-only on purpose: PowerShell 5.1 reads non-BOM UTF-8 as ANSI and mangles CJK.
  The Chinese report lives in verify.mjs and the node tests (Node handles UTF-8 fine).

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke.ps1 -SkipVerify

  Exit: 0 all pass / 1 something failed.
  Never runs bootstrap -Apply: smoke must not install anything.
#>
param(
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$script:fail = 0
$root = Split-Path -Parent $PSScriptRoot

function Head($m) { Write-Host ''; Write-Host ('--- ' + $m + ' ---') -ForegroundColor White }
function Ok($m)   { Write-Host ('[ OK ] ' + $m) -ForegroundColor Green }
function No($m)   { Write-Host ('[FAIL] ' + $m) -ForegroundColor Red; $script:fail++ }
function Note($m) { Write-Host ('       ' + $m) -ForegroundColor DarkGray }

Push-Location $root
try {
    # ---------- 1. node --check ----------
    Head '1/4 node --check (JS syntax)'
    $jsTargets = @()
    $jsTargets += @(Get-ChildItem -Path 'scripts' -Recurse -File -Include '*.mjs', '*.js' | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
    $jsTargets += @(Get-ChildItem -Path 'tests' -File -Filter '*.mjs' | ForEach-Object { 'tests\' + $_.Name })
    foreach ($t in $jsTargets) {
        & node --check $t 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Ok ('node --check ' + $t) } else { No ('node --check ' + $t) }
    }
    Note ($jsTargets.Count.ToString() + ' file(s) checked')

    # ---------- 2. PowerShell Parser ----------
    Head '2/4 PowerShell Parser (ps1 syntax)'
    foreach ($t in @('scripts\bootstrap.ps1', 'scripts\smoke.ps1')) {
        $full = (Resolve-Path -LiteralPath $t).Path
        $errs = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($full, [ref]$null, [ref]$errs)
        if ($errs -and $errs.Count -gt 0) {
            foreach ($e in $errs) { Note ('line ' + $e.Extent.StartLineNumber + ': ' + $e.Message) }
            No ('parser ' + $t)
        } else { Ok ('parser ' + $t) }
    }

    # ---------- 3. contract tests ----------
    Head '3/4 node --test (contract tests)'
    # Node 22+ treats positional args to --test as GLOB patterns, not directories:
    # 'node --test tests/' does not work, 'tests/**/*.test.mjs' does.
    $testOut = (& node --test 'tests/**/*.test.mjs' 2>&1 | Out-String)
    $testCode = $LASTEXITCODE
    $passN = 0
    $failN = 0
    $m = [regex]::Match($testOut, 'pass (\d+)')
    if ($m.Success) { $passN = [int]$m.Groups[1].Value }
    $m = [regex]::Match($testOut, 'fail (\d+)')
    if ($m.Success) { $failN = [int]$m.Groups[1].Value }
    if ($testCode -eq 0) {
        Ok ('node --test: ' + $passN + ' passed, ' + $failN + ' failed')
    } else {
        No ('node --test exit ' + $testCode + ' (' + $passN + ' passed, ' + $failN + ' failed)')
        foreach ($l in ($testOut -split "\r?\n")) {
            if ($l -match 'AssertionError|^\s*not ok|^\s*x ') { Note $l.Trim() }
        }
    }

    # ---------- 4. fast verify segment ----------
    if ($SkipVerify) {
        Head '4/4 verify.mjs --only=A,B (skipped)'
        Note '-SkipVerify given'
    } else {
        Head '4/4 verify.mjs --only=A,B (fast segment)'
        $vOut = (& node 'scripts/verify.mjs' '--only=A,B' 2>&1 | Out-String)
        $vCode = $LASTEXITCODE
        # 0 all pass / 1 hard gap / 2 warnings only -- all three mean the script ran.
        # 64 is the 'unknown segment' rejection; anything else is a crash.
        if ($vCode -eq 0 -or $vCode -eq 1 -or $vCode -eq 2) {
            Ok ('verify exit ' + $vCode + ' (0 all pass / 1 hard gap / 2 warnings only)')
        } else {
            No ('verify exit ' + $vCode + ' - not a valid verify exit code')
        }
        $segs = @([regex]::Matches($vOut, '(?m)^--- ([A-Z0-9]+)\. ') | ForEach-Object { $_.Groups[1].Value })
        if ($segs.Count -eq 2 -and $segs[0] -eq 'A' -and $segs[1] -eq 'B') {
            Ok '--only=A,B ran exactly A then B'
        } else {
            No ('--only=A,B ran segments: ' + ($segs -join ','))
        }
    }

    # ---------- 5/5 bootstrap -Check exit code ----------
    # bootstrap 自己的退出码语义（0/1/2）此前没人验证过，只测了 verify 的。
    Head '5/5 bootstrap -Check exit code'
    $bOut = (& powershell -NoProfile -ExecutionPolicy Bypass -File 'scripts/bootstrap.ps1' -Check 2>&1 | Out-String)
    $bCode = $LASTEXITCODE
    if ($bCode -eq 0 -or $bCode -eq 1 -or $bCode -eq 2) {
        Ok ('bootstrap -Check exit ' + $bCode + ' (0 all pass / 1 hard gap / 2 warnings only)')
    } else {
        No ('bootstrap -Check exit ' + $bCode + ' - not in 0/1/2, the script itself crashed')
    }

    # ---------- summary ----------
    Head 'summary'
    if ($script:fail -eq 0) {
        Write-Host 'PASS - smoke clean.' -ForegroundColor Green
        exit 0
    }
    Write-Host ('FAIL - ' + $script:fail + ' check(s) failed.') -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
