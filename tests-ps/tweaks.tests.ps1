# tweaks.ps1 的探针直测（抽取法同 bootstrap.tests.ps1）

BeforeAll {
    $TW = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\tweaks.ps1'
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($TW, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) { throw "tweaks.ps1 解析失败: $($errs[0].Message)" }
    $fns = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
    foreach ($fn in $fns) { . ([scriptblock]::Create($fn.Extent.Text)) }
    # Defender 停用的机器上 Get-MpPreference 不存在，Mock 会先炸——补个空壳
    if (-not (Get-Command Get-MpPreference -ErrorAction SilentlyContinue)) {
        function global:Get-MpPreference { param($ErrorAction) }
    }
}

Describe 'tweak 探针' {
    It 'gamebar-off：两个值都归零才判 applied' {
        Mock Get-ItemProperty { [pscustomobject]@{ AppCaptureEnabled = 0; GameDVR_Enabled = 0 } }
        Get-TweakState 'gamebar-off' | Should -Be 'applied'
    }
    It 'gamebar-off：非 0 判 not-applied' {
        Mock Get-ItemProperty { [pscustomobject]@{ AppCaptureEnabled = 1; GameDVR_Enabled = 0 } }
        Get-TweakState 'gamebar-off' | Should -Be 'not-applied'
    }
    It 'gamebar-off：半写状态（只写了一个值）不许报 applied（code-audit #11 回归）' {
        Mock Get-ItemProperty { [pscustomobject]@{ AppCaptureEnabled = 0; GameDVR_Enabled = 1 } }
        Get-TweakState 'gamebar-off' | Should -Be 'not-applied'
    }
    It 'longpaths：注册表读不到报 unknown，不猜' {
        Mock Get-ItemProperty { throw 'no key' }
        Get-TweakState 'longpaths' | Should -Be 'unknown'
    }
    It 'hiberfil-off：走注册表真值（Test-Path 对内核独占文件恒假，code-audit #3）' {
        Mock Get-ItemProperty { [pscustomobject]@{ HibernateEnabled = 0 } }
        Get-TweakState 'hiberfil-off' | Should -Be 'applied'
        Mock Get-ItemProperty { [pscustomobject]@{ HibernateEnabled = 1 } }
        Get-TweakState 'hiberfil-off' | Should -Be 'not-applied'
    }
    It 'defender-exclusions：工作区与 DSH 目录都得在排除里才算 applied' {
        Mock Test-Path { $true }
        Mock Get-MpPreference { [pscustomobject]@{ ExclusionPath = @('C:\DSH空间', 'C:\Software\DSH') } }
        Get-TweakState 'defender-exclusions' | Should -Be 'applied'
        Mock Get-MpPreference { [pscustomobject]@{ ExclusionPath = @('C:\DSH空间') } }
        Get-TweakState 'defender-exclusions' | Should -Be 'not-applied'
    }
}
