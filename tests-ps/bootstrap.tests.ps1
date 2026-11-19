# Pester 5 直测 bootstrap.ps1 的函数（P0-2）。
# 用 PS parser 抽出 FunctionDefinitionAst 再定义到测试作用域，不执行脚本主体——
# 这样 -split 标量陷阱这类判据 bug 有真测试拦着，不再只靠 regex 锚点。

BeforeAll {
    $BOOTSTRAP = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\bootstrap.ps1'
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($BOOTSTRAP, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) { throw "bootstrap.ps1 解析失败: $($errs[0].Message)" }
    $fns = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
    foreach ($fn in $fns) {
        # 必须用完整定义文本（含 C 式参数表）——Body 里没有 param，
        # 只 dot-source Body 会让 $dir/$exe 全是 null。
        . ([scriptblock]::Create($fn.Extent.Text))
    }
    $script:fnCount = $fns.Count
}

Describe '函数抽取' {
    It '抽得出核心函数' {
        $script:fnCount | Should -BeGreaterThan 10
        Get-Command Say -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}

Describe 'Say 记账' {
    BeforeEach {
        Mock Write-Host { }
        $script:gapsFound = 0; $script:gapsLeft = 0; $script:segBase = 0
        $script:warns = 0; $script:fixes = 0
    }
    It 'bad 计硬缺口，warn 计提醒' {
        Say 'x' 'bad'; Say 'y' 'warn'
        $script:gapsFound | Should -Be 1
        $script:gapsLeft | Should -Be 1
        $script:warns | Should -Be 1
    }
    It 'fix 只能抵消本段缺口，跨段不许（gapsLeft 记账回归）' {
        Say 'h' 'head'; Say 'x' 'bad'
        Say 'h2' 'head'; Say 'y' 'bad'
        Say 'f' 'fix'; Say 'f2' 'fix'
        # 两个 fix 只有一个生效：第二个不许跨段吃掉第一段的缺口
        $script:gapsLeft | Should -Be 1
        $script:fixes | Should -Be 2
    }
}

Describe 'PATH 函数' {
    BeforeEach {
        Mock Write-Host { }
        Mock Set-Content { }
        $script:setVal = $null
        Mock Set-UserPath { param($value) $script:setVal = $value }
    }
    It 'Add-PathEntry 不毁单条目 PATH（-split 标量陷阱回归）' {
        Mock Get-UserPath { 'C:\ONLY' }
        Add-PathEntry 'C:\NEW' | Should -Be $true
        $script:setVal | Should -Be 'C:\ONLY;C:\NEW'
    }
    It '重复条目（含尾反斜杠差异）不重复追加' {
        Mock Get-UserPath { 'C:\A;C:\B' }
        Add-PathEntry 'C:\a\' | Should -Be $false
        $script:setVal | Should -Be $null
    }
    It 'Remove-PathDuplicates 去重保序' {
        Mock Get-UserPath { 'C:\A;C:\B;C:\a\;C:\C' }
        Remove-PathDuplicates
        $script:setVal | Should -Be 'C:\A;C:\B;C:\C'
    }
    It '单条目 PATH 不动写' {
        Mock Get-UserPath { 'C:\ONLY' }
        Remove-PathDuplicates
        $script:setVal | Should -Be $null
    }
    It 'Test-PathEntry 两域都查、尾反斜杠不算差异' {
        Mock Get-UserPath { 'C:\Tools' }
        Mock Get-MachinePath { '' }
        Test-PathEntry 'C:\tools\' | Should -Be $true
        Test-PathEntry 'C:\Missing' | Should -Be $false
    }
}

Describe 'Get-CmdVersion' {
    It '真实命令有输出' {
        Get-CmdVersion 'node' '--version' | Should -Match '^v?\d+'
    }
    It '不存在的命令返回 null，不当已安装' {
        Get-CmdVersion 'zzz-not-a-real-cmd-9527' '--version' | Should -BeNullOrEmpty
    }
}

Describe 'Test-PendingReboot' {
    It '三个源都亮时报三条' {
        Mock Get-ItemProperty { [pscustomobject]@{ PendingFileRenameOperations = @('x') } }
        Mock Test-Path { $true }
        @(Test-PendingReboot).Count | Should -Be 3
    }
    It '干净时报 0 条' {
        Mock Get-ItemProperty { throw 'none' }
        Mock Test-Path { $false }
        @(Test-PendingReboot).Count | Should -Be 0
    }
    It '属性存在但为空数组不报挂起（code-audit #12 回归）' {
        Mock Get-ItemProperty { [pscustomobject]@{ PendingFileRenameOperations = @() } }
        Mock Test-Path { $false }
        @(Test-PendingReboot).Count | Should -Be 0
    }
}

Describe 'Repair-ManualPackages 失配自修（审计 P2-6 回归）' {
    BeforeEach {
        Mock Write-Host { }
        $script:renamed = $null
        $script:junctionTo = $null
        Mock Test-Path { $true }
        Mock Get-LinkType { $null }
        Mock Rename-Item { $script:renamedCalled = $true; $script:renamed = $PesterBoundParameters['NewName'] }
        Mock New-Item {
            $script:junctionCalled = $true
            # New-Item 的 -Target 是 -Value 的别名，绑定表里存的是 Value
            $t = $PesterBoundParameters['Target']; if (-not $t) { $t = $PesterBoundParameters['Value'] }
            $script:junctionTo = $t
        }
        $script:doG2 = $true
        # Pester 5+ discovery/run 两阶段：Describe 体里的赋值到运行期是 $null，必须放 BeforeEach
        $cfg2 = [pscustomobject]@{ junctionPackage = 'dsh-compaction-basic'; manualPackages = @('dsh-compaction-basic') }
    }
    It '普通拷贝 + doG2 + 有源：备份旧目录并重建 junction' {
        $script:renamedCalled = $false
        $script:junctionCalled = $false
        Repair-ManualPackages 'C:\prof\node_modules' 'C:\host\node_modules' $cfg2
        $script:renamedCalled | Should -Be $true
        $script:junctionCalled | Should -Be $true
        $script:renamed | Should -Match '\.bak-'
        $script:junctionTo | Should -Be 'C:\host\node_modules\@deepseek-ai\dsh-compaction-basic'
    }
    It '普通拷贝但没开 -RepairG2：只警告不动手' {
        $script:doG2 = $false
        Repair-ManualPackages 'C:\prof\node_modules' 'C:\host\node_modules' $cfg2
        $script:renamed | Should -Be $null
        $script:junctionTo | Should -Be $null
    }
    It 'junction 创建失败必须回滚改名，包不许消失（审计 N2 回归）' {
        $script:renames = @()
        Mock Rename-Item { $script:renames += [string]$PesterBoundParameters['NewName'] }
        Mock New-Item { throw 'junction denied' }
        Repair-ManualPackages 'C:\prof\node_modules' 'C:\host\node_modules' $cfg2
        $script:renames.Count | Should -Be 2
        $script:renames[0] | Should -Match '\.bak-'
        $script:renames[1] | Should -Be 'dsh-compaction-basic'   # 回滚成原名
    }
}

Describe 'Install-PathFix（审计 N3 回归）' {
    BeforeEach {
        Mock Write-Host { }
        $script:added = @()
        Mock Add-PathEntry {
            $v = $PesterBoundParameters['dir']; if (-not $v) { $v = $args[0] }
            $script:added += [string]$v
            return $true
        }
        Mock Test-Path { $true }
        $script:oldPath = $env:Path
    }
    AfterEach { $env:Path = $script:oldPath }
    It '补 PATH 后当次就能复测到，且只加第一个命中的目录' {
        Mock Get-CmdVersion { if ($env:Path -like '*C:\FakeToolDir*') { 'v1.2' } else { $null } }
        $t = [pscustomobject]@{ pathDirs = @('C:\FakeToolDir'); exeName = 'ft.exe' }
        Install-PathFix $t 'ft' '--version' | Should -Be 'v1.2'
        $script:added.Count | Should -Be 1
        ($env:Path -like '*C:\FakeToolDir*') | Should -Be $true
    }
    It '目录里没有 exe 就不加 PATH' {
        Mock Test-Path { $false }
        Mock Get-CmdVersion { $null }
        $t = [pscustomobject]@{ pathDirs = @('C:\Nope'); exeName = 'ft.exe' }
        Install-PathFix $t 'ft' '--version' | Should -BeNullOrEmpty
        $script:added.Count | Should -Be 0
    }
}

Describe 'Get-WingetId' {
    It 'manifest 有就用 manifest，没有用兜底' {
        Mock Get-Manifest { [pscustomobject]@{ tools = @([pscustomobject]@{ name = '7z'; winget = '7zip.7zip' }) } }
        Get-WingetId '7z' 'fallback' | Should -Be '7zip.7zip'
        Get-WingetId 'zz' 'fallback' | Should -Be 'fallback'
    }
}

Describe 'DryRun 计划预览（审计 R7 -DryRun 回归）' {
    BeforeEach {
        $script:dryRun = $true
        # Install-Pkg 读的是裸变量 $Apply（脚本参数），测试作用域必须给它真值
        # 否则会先走进「-not $Apply」的探测分支，dryRun 守卫根本到不了
        $script:Apply = $true
        $script:setVal = $null
        $script:msgs = @()
        Mock Write-Host { $script:msgs += [string]$PesterBoundParameters['Object'] }
        Mock Set-UserPath { param($value) $script:setVal = $value }
        Mock Set-Content { }
        $script:gapsFound = 0; $script:gapsLeft = 0; $script:segBase = 0
        $script:warns = 0; $script:fixes = 0
    }
    AfterEach { $script:dryRun = $false; $script:Apply = $false }
    It 'Add-PathEntry 只出 plan 不写 PATH' {
        Add-PathEntry 'C:\X' | Should -Be $true
        $script:setVal | Should -Be $null
        ($script:msgs -join ' ') | Should -Match 'plan:'
    }
    It 'Install-Pip 只出 plan 不调 pip（用假解释器名防误伤）' {
        Install-Pip 'zzz-not-a-real-python-9527' 'pillow' 'python:pillow'
        $script:fixes | Should -Be 0
        ($script:msgs -join ' ') | Should -Match 'plan: .*pip install'
    }
    It 'Remove-PathDuplicates 只出 plan 不写' {
        Mock Get-UserPath { 'C:\A;C:\A' }
        Remove-PathDuplicates
        $script:setVal | Should -Be $null
        ($script:msgs -join ' ') | Should -Match 'plan: dedupe'
    }
    It 'Install-Pkg 只出 plan 不调 winget' {
        Mock Get-Command { throw 'must not resolve winget in dry-run' }
        Install-Pkg 'Some.Id' 'Some Tool' $true 'zzz-cmd' '--version'
        ($script:msgs -join ' ') | Should -Match 'plan: winget install'
    }
}
