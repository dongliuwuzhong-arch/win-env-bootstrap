# P0-3 幂等收敛契约：连跑两次 -Apply，第二次对状态零改动。
# 历史事故：-split 标量陷阱让 PATH「每跑一次更烂」——这个测试就是钉死这类累积态回归。
#
# 方法：假 winget/npm/python/frida 桩（只记日志、假版本、不真装）前置 PATH，
# DSH_HOME/DSH_WORKSPACE/USERPROFILE 全指沙箱，起子进程真跑 bootstrap.ps1 -Apply。
# 收敛判据是状态增量为零：run1 -> run2，HKCU 用户 PATH 与沙箱 home 文件清单必须一致。
# 注：若机器上某工具目录真实存在且不在 PATH，run1 会补一次（-Apply 的文档行为），
# run2 必须静止。用户 PATH 的改动走真实注册表（等于跑了一次正常 -Apply）；
# 备份写沙箱且随测试清理，跑完没有回退件，在意就先 reg export HKCU\Environment 留底。

BeforeAll {
    $script:BOOTSTRAP = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\bootstrap.ps1'
    $script:SB = Join-Path ([System.IO.Path]::GetTempPath()) ('conv-' + [guid]::NewGuid().ToString('N'))
    $script:STUBS = Join-Path $script:SB 'stubs'
    $script:SBHOME = Join-Path $script:SB 'home'
    $script:WS = Join-Path $script:SB 'ws'
    foreach ($d in @($script:STUBS, $script:SBHOME, (Join-Path $script:SBHOME '.dsh'), (Join-Path $script:WS '.agents\skills'), (Join-Path $script:WS 'knowledge\persona'))) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
    $script:STUBLOG = Join-Path $script:SB 'stub.log'

    Set-Content -Path (Join-Path $script:STUBS 'winget.cmd') -Encoding ASCII -Value ('@echo off' + [Environment]::NewLine + 'echo %* >> "%STUB_LOG%"' + [Environment]::NewLine + 'exit /b 0')
    Set-Content -Path (Join-Path $script:STUBS 'npm.cmd') -Encoding ASCII -Value ('@echo off' + [Environment]::NewLine + 'echo npm %* >> "%STUB_LOG%"' + [Environment]::NewLine + 'exit /b 0')
    Set-Content -Path (Join-Path $script:STUBS 'frida.cmd') -Encoding ASCII -Value ('@echo off' + [Environment]::NewLine + 'echo 17.27.0' + [Environment]::NewLine + 'exit /b 0')
    $pyStub = @'
@echo off
set ARGS=%*
if "%1"=="--version" (echo Python 3.12.10 & exit /b 0)
echo %* >> "%STUB_LOG%"
echo pillow 13.0.0
echo PyYAML 6.0.3
echo frida 17.27.0
echo frida-tools 14.0.0
echo pycryptodome 4.3.0
echo pycryptodomex 3.24.1
echo zstandard 0.25.0
echo silk-python 0.2.9
exit /b 0
'@
    Set-Content -Path (Join-Path $script:STUBS 'python.cmd') -Encoding ASCII -Value $pyStub

    function script:Invoke-BootstrapRun {
        $saved = @{}
        foreach ($k in @('PATH', 'DSH_HOME', 'DSH_WORKSPACE', 'USERPROFILE', 'STUB_LOG')) { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
        $env:PATH = $script:STUBS + ';' + $saved['PATH']
        $env:DSH_HOME = $script:SBHOME
        $env:DSH_WORKSPACE = $script:WS
        # USERPROFILE 必须指 SBHOME（不是 SB）：备份目录按 USERPROFILE\.dsh 落，
        # 指错会把备份写进 C:\Windows\Temp 且落在断言盲区（code-audit #13）
        $env:USERPROFILE = $script:SBHOME
        $env:STUB_LOG = $script:STUBLOG
        try {
            # 原生调用，不用 Start-Process：Start-Process 会把环境变量灌进大小写不敏感的
            # .NET 字典，机器上同时存在 HTTPS_PROXY/https_proxy 时直接抛
            # "已添加项"（2026-11-20 实测）。原生调用继承原始环境块，没有这个问题。
            & powershell -NoProfile -ExecutionPolicy Bypass -File $script:BOOTSTRAP -Apply -Workspace $script:WS | Out-Null
            return $LASTEXITCODE
        } finally {
            foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
        }
    }

    function script:Get-UserPathRaw {
        try { return [string](Get-ItemProperty 'HKCU:\Environment' -Name Path -ErrorAction Stop).Path } catch { return '' }
    }
    function script:Get-HomeFiles {
        @(Get-ChildItem -Recurse -File $script:SBHOME -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName.Substring($script:SBHOME.Length) } | Sort-Object)
    }
}

Describe '幂等收敛（detect-then-fix 的契约）' {
    It 'run1 -> run2：用户 PATH 与沙箱 home 零增量' {
        Invoke-BootstrapRun | Out-Null
        $path1 = Get-UserPathRaw
        $files1 = Get-HomeFiles
        $files1.Count | Should -BeGreaterThan 0   # run1 确实动过状态，别跑了个寂寞

        Invoke-BootstrapRun | Out-Null
        $path2 = Get-UserPathRaw
        $files2 = Get-HomeFiles

        $path2 | Should -Be $path1   # PATH 不许再变（钉 -split 那类累积损坏）
        ($files2 -join '|') | Should -Be ($files1 -join '|')   # 备份/模板不许重复生产
    }
}

AfterAll {
    Remove-Item -Recurse -Force $script:SB -ErrorAction SilentlyContinue
}
