# dsh-env-bootstrap 「新机开箱即用」审计报告

- **审计对象**：`dongliuwuzhong-arch/dsh-env-bootstrap`，HEAD `f0628a7`（2026-11-19）
- **审计视角**：新机开箱即用 —— 首次安装后能否自动完成环境配置、检测缺失依赖/配置异常、实时反馈检测状态/失败原因/更新结果
- **审计方式**：全量通读（README/README.en、SKILL.md、MAINTAINING.md、config/manifest.json、bootstrap.ps1 974 行、verify.mjs、lib/*、checks/* 18 段、mcp/server.mjs、smoke.ps1、tweaks.ps1、ci.yml、tests 117+21）+ 实跑（node 契约 117/117 通过、verify --json 实测）+ 双实现对照与探针实验（7z 空参探针实测）
- **约束**：仅分析与建议，未修改任何代码

---

## 〇、总体判定

**结论：未达到"开箱即用"，但差距是可控的、且项目自身认知诚实。** 在其声明范围内（换机第二阶段：装 DSH 本体、拷 `~/.dsh` 与工作区、填凭据之后），检测能力与幂等性已相当成熟；但①核心主张从未在真·新机端到端验证过；②"实时反馈"只在 bootstrap 与 MCP（带 progressToken）成立，verify 人类模式是批量输出；③双脚本实现存在漂移（会引发误报与误装副作用）；④网络/权限/OS 边界的失败反馈不可行动。

### 能力对照表（声明 vs 实现）

| # | 能力 | 状态 | 依据 |
|---|---|---|---|
| 1 | 自动安装公开工具（winget/pip/npm） | ✅ 已实现 | bootstrap.ps1 A–F 段：Node/Python/Git/pnpm/7-Zip/ffmpeg/yt-dlp/ImageMagick/Chrome/rg/jq/exiftool/dotnet + puppeteer + 两套 pip 包 |
| 2 | 检测缺失依赖 | ✅ 已实现 | 18 段（00+A–P），manifest 单源，117 条契约测试锚定 |
| 3 | 检测配置异常 | ✅ 已实现 | 执行策略（读注册表而非 Get-ExecutionPolicy）、PATH 重复、ACL 实写探针、凭据 key 级检查、G2 加载前置、profile 名正则、schema user_version、挂起重启、根证书 CA、字体/磁盘/时间服务 |
| 4 | 实时反馈-检测状态 | ⚠️ 部分 | bootstrap 逐条流式 ✅；verify 人类模式**全部跑完才输出**（verify.mjs:105-124）；MCP 仅在 `_meta.progressToken` 存在时逐段推送 |
| 5 | 实时反馈-失败原因 | ⚠️ 部分 | winget 有 rc + 非管理员提示；**pip 失败吞掉 stderr**（bootstrap.ps1:390-397），只报 "install failed" 无原因；网络失败不分诊 |
| 6 | 实时反馈-更新结果 | ⚠️ 部分 | 有 summary 计数 + 逐条 [FIX] + 退出码 0/1/2 + --json 结构化；无"本次变更清单"diff，回滚指引只在 README |
| 7 | PATH 缺项自动补 | ⚠️ 部分 | **仅 7-Zip**（bootstrap.ps1:580 是唯一调用点）；其余工具"装了不在 PATH"只留 warn |
| 8 | PATH 去重 | ✅ 已实现 | Remove-PathDuplicates，先备份 path-dedup-*.txt（bootstrap.ps1:312-338） |
| 9 | 重复安装/升级幂等 | ✅ 已实现 | detect-then-fix；Pester 收敛测试断言两次 -Apply 零增量；winget -1978335212 有处理 |
| 10 | G2 插件前置修复 | ⚠️ 部分 | 手工包/junction/凭据模板会修；win-bash payload、soul schema、源缺失只报；**public 仓库 localPlugins 清单默认空**，需自填才检查 |
| 11 | 挂起重启检测 | ✅ 已实现 | Test-PendingReboot 三源（bootstrap.ps1:227-246） |
| 12 | 清单导出/迁移辅助 | ✅ 已实现 | -ExportInventory（winget export + 双 pip + npm） |
| 13 | 系统调优（opt-in 可回退） | ✅ 已实现 | tweaks.ps1 5 项，admin 项非管理员直接 FAIL |
| 14 | 自动填凭据 / 装 DSH 本体 / 建 ~/.dsh / 拷工作区 | ❌ 缺失（by design） | 00 段只检测引导；README/SKILL 明示阶段一人工 |
| 15 | 网络异常适配（代理/重试/预检） | ❌ 缺失 | J 段只查本地 7897 端口；安装失败无网络分诊 |
| 16 | 跨 OS（macOS/Linux）/ Win10/ARM64/离线 | ❌ 缺失/未声明 | Windows-only；Win10/ARM64/离线 MAINTAINING.md:219 自认未覆盖，README 也未声明不支持 |
| 17 | -DryRun 计划预览 / SIGTERM 优雅退出 | ❌ 缺失（已留账） | MAINTAINING.md:222-223 |

---

## 一、场景覆盖矩阵

| 场景 | 覆盖度 | 说明 |
|---|---|---|
| **首次安装（阶段一：人工）** | ✅ 检测 / ❌ 自动化（by design） | 00 段四项前置三态输出；缺了给做法引导。范围声明诚实 |
| **首次安装（阶段二：脚本）** | ⚠️ 部分 | 自动装链路完整，但**真·裸机全流程从未跑过**（MAINTAINING.md:216），全靠 stubs 模拟 |
| **重复安装 / 升级** | ✅ 良好 | 二次 -Apply 零增量有收敛测试；DSH 宿主升级后的 compaction-basic 版本失配有检测；但失配只报不修 |
| **已有配置** | ✅ 良好 | 只补缺：PATH 只补不删、G2 跳过已有、模板只在缺失时写、vbs/Run 键幂等覆盖 |
| **依赖缺失** | ✅ 检测 / ⚠️ 自动装 | 主要工具全装；N/O/P 只报（文档已声明）；pip 失败无原因；"装了不在 PATH"除 7-Zip 外不修 |
| **权限不足** | ⚠️ 部分 | isAdmin 提示、宿主目录实写探针、tweaks admin 项 FAIL 停手、执行策略只改 CurrentUser；**winget 提权流程未实测**（MAINTAINING.md:218），无 --scope user 降级 |
| **网络异常** | ❌ 弱 | 无连通性预检、无代理指引、无重试；失败只留 rc/空泛 warn |
| **不同 OS/环境差异** | ❌ 弱 | Win10 build≥17763（ConPTY）有检查；ARM64/离线/无 winget 环境未测未声明；非 win32 平台 verify 不 fail-fast，只会吐一片红 |

---

## 二、问题清单（按严重程度）

### P0 — 阻断级（开箱即用结论不成立的根因）

**P0-1 真·裸机端到端验证从未执行，"开箱即用"缺实证基础**
- **问题概述**：所有验证（117 node 测试 + 21 Pester + smoke + CI）都在已配好的机器或 stubs 桩上完成；从"干净 Windows + 官方安装器 + 拷盘"开始的完整流程一次都没跑过。收敛测试用假 winget/npm/python 桩，只能证明幂等，不能证明真装得上。
- **影响范围**：整个交付的可信度；新机上任何"只有真机才会暴露"的问题（winget 源行为、提权、PATH 刷新时机、拷盘遗漏）都未被发现。
- **触发条件**：任何真实新机首次运行（必然触发）。
- **依据**：MAINTAINING.md:216「真·裸机全流程验证 **没做过**」；218-219 非管理员/Win10/ARM64/离线均未覆盖；tests-ps/convergence.tests.ps1 头部自述"假 winget/npm/python/frida 桩"。
- **推荐修复方向**：跑一次受控裸机清单（Hyper-V/VMware 快照机）：装本体→拷 ~/.dsh+工作区→`-Check`→`-Apply`→重开 shell→`verify --json`→二次 `-Apply` 比对增量→全程 tee 日志归档 docs/。之后每次发版至少抽跑 V1。

### P1 — 高（直接损伤审计的三个核心主张之一）

**P1-1 verify（人类模式）无实时反馈，M 段最长 240s 屏幕静默**
- **问题概述**：verify.mjs 先 `await Promise.allSettled(全部检查段)`，全部结束后才逐段打印（verify.mjs:105-124）。M 段 selfcheck 超时上限 240s，期间用户零反馈。`--jsonl` 流式只存在于 MCP 通道，人跑 `node scripts/verify.mjs` 享受不到。
- **影响范围**："实时反馈检测状态"这一核心主张只在 bootstrap 与 MCP（且需客户端传 progressToken）成立；README 的推荐入口 `node scripts/verify.mjs` 恰好是无实时反馈的那条。
- **触发条件**：任何一次完整 verify（尤其含 M 段）。
- **依据**：verify.mjs:88-89 注释自述"并行跑…严格按 manifest 顺序输出"；105-124 输出全在 settled 之后；mcp/server.mjs:106 自管 600s 超时侧面印证 M 段是长耗时段。
- **推荐修复方向**：人类模式改为"段完成即按序打印"（已完成段缓冲到下一个就绪段即刷出），或默认走 --jsonl 串行 + 人类排版层；至少给 M 段加"开始/结束"时间戳行。

**P1-2 双实现/配置源漂移三处 —— 同一机器双脚本结论不一致，且有误装副作用**
- **问题概述**（三个子项，同一类根因）：
  1. **pnpm 候选路径不一致**：bootstrap 只查 `DSH_ROOT\resources\runtime\...\pnpm.cjs`（bootstrap.ps1:549-556），verify 额外查 `~/.dsh/dsh-runtimes\...\pnpm.cjs`（a-core-runtime.js:36-39）。只有 dsh-runtimes 里有 pnpm 的机器：verify 报 ok，bootstrap 报 bad 并**执行 `npm i -g pnpm` 误装全局包**（bootstrap.ps1:561-565）。
  2. **DSH_HOME 覆盖未贯通**：`p-integrity-migration.js:65` 的 AGENTS.md 路径写死 `ctx.HOME/.dsh`、`a-core-runtime.js:38` 的 dsh-runtimes 兜底同样写死 `ctx.HOME/.dsh`，而 DSH_HOME 环境变量（MAINTAINING.md:137 称其为"裸机模拟的钥匙"）在 bootstrap 侧是生效的（bootstrap.ps1:477）。裸机模拟时 verify 会读到真实 `~/.dsh`，**让模拟失真**。
  3. **manifest 单源被架空**：`g2-plugin-prereq.js:30` 硬编码 5 个 manualPkgs（不读 `manifest.g2.manualPackages`）；`h-workspace.js:22` 硬编码七个目录（不读 `manifest.workspaceDirs`）、persona 四件套同样硬编码。bootstrap 侧均读 manifest（bootstrap.ps1:71、788）。改 manifest 后两个脚本行为分叉。
- **影响范围**：所有未把 pnpm 装进 PATH 的机器（误装+误报）；所有裸机模拟测试（结论失真）；所有想通过改 manifest 定制检查的用户。
- **触发条件**：见各子项；1 在"DSH 自带 pnpm 且系统无 pnpm"时必现。
- **依据**：上述行号；MAINTAINING.md:203-207 已有"双脚本改一处必须改两处"的教训，但同类问题仍在三处复发。
- **推荐修复方向**：把"工具候选路径"与"DSH_HOME 解析"收敛为单一实现（建议 manifest 加 `dshRuntimesRel`，两侧都从 manifest 拼）；checks 侧全部改读 manifest（g2/manualPackages、workspaceDirs、personaFiles）；给"双脚本结论一致性"加契约测试（同一沙箱跑 bootstrap -Check 与 verify --json，断言关键项同向）。

**P1-3 安装失败的"失败原因"反馈不可行动：pip 吞 stderr，网络/权限不分诊**
- **问题概述**：`Install-Pip`（bootstrap.ps1:390-397）把 pip 的 stdout+stderr 全部 `| Out-Null`，失败只输出 "python:xxx install failed"，**真实原因（网络不通/代理缺失/权限/版本不兼容）被吞**。winget 失败有 rc + 非管理员提示，但无网络分诊（"能否访问源/是否需要代理"）；无重试。国内新机（目标用户环境）常见的代理/镜像问题只能靠用户自己猜。
- **影响范围**：F 段（13 个 pip 包 × 2 套解释器）与 E 段 frida 的全部安装失败场景；网络异常与权限不足两个场景的反馈质量。
- **触发条件**：断网、需代理未设、pip 源不可达、非管理员装机器级包等任一安装失败。
- **依据**：bootstrap.ps1:395 `2>&1 | Out-Null`；Install-Pkg 353-388 只有 rc 与 isAdmin 提示；j-network.js 只查 127.0.0.1:7897。
- **推荐修复方向**：Install-Pip 捕获最后 1-2 行错误输出并随失败消息打印；安装失败时追加分类提示（网络/权限/源）；可选：装前预检 `winget source list`/`pip config`/npm registry 可达性；失败提示设 `HTTPS_PROXY` 或换镜像的具体命令。

### P2 — 中（影响体验、可靠性或维护性）

**P2-1 "装了但不在 PATH"的自动修复仅覆盖 7-Zip；探针参数不规范**
- **问题概述**：Add-PathEntry 全脚本唯一调用点是 7-Zip（bootstrap.ps1:580）；其他工具装后若不在 PATH 只留 "restart the shell" warn。另 `Install-Pkg ... '7z' ''` 与 `'chrome' ''`（584、642）传**空字符串**做探针参数：`7z ''` 在 7-Zip 26.x 恰好打印 banner 退出 0（本机实测），旧版可能报错退出非 0 → 安装成功却走 "not resolvable" warn，`[FIX]` 不计、退出码虚高；Chrome 是 GUI 且通常不在 PATH，探针恒不成立。
- **影响范围**：非 7-Zip 工具的 PATH 缺口；7-Zip/Chrome 的安装结果确认与退出码准确性。
- **触发条件**：工具装到非 PATH 目录 / 当前进程 PATH 未刷新 / 旧版 7-Zip / Chrome 装后。
- **依据**：bootstrap.ps1:284-310（Add-PathEntry）、580、584、642；本机 PowerShell 实测 `7z ''` 与 `7z` 行为一致（26.03），属版本相关。
- **推荐修复方向**：把"装后不在 PATH → 补 PATH（备份先行）"泛化为 Install-Pkg 的通用后置步骤（manifest 有 pathDirs 的工具自动尝试）；7z 探针改 `@()`（无参）或 `-h` 首行；Chrome 探针改候选路径存在性检查。

**P2-2 非管理员会话下 winget 提权流程未实测、无降级策略**
- **问题概述**：Install-Pkg 只在失败后附 "(not elevated - may need an admin shell)" 提示；没有装前按包判定是否需提权、没有 `--scope user` 尝试、`--disable-interactivity` 与 UAC 弹窗的交互行为未验证。
- **影响范围**：所有以普通用户首次开机跑 `-Apply` 的场景（新机默认账户多为管理员但 UAC 提权仍需确认；企业环境常为标准用户）。
- **触发条件**：非提升会话 + 需机器级安装的包。
- **依据**：bootstrap.ps1:365-387；MAINTAINING.md:218「非管理员会话 winget 机器级安装的提权提示**没实测**」。
- **推荐修复方向**：裸机验证矩阵中加"标准用户会话"一行；Install-Pkg 对已知机器级包先探测 isAdmin 并预提示；失败时给出"以管理员重开终端"与"user-scope 可行包清单"两条具体路径。

**P2-3 OS/环境矩阵未覆盖也未声明：Win10 / ARM64 / 离线 / 无 winget**
- **问题概述**：I 段有 ConPTY build≥17763 检查（好），但整个矩阵未实测；README 未声明支持范围（如"仅 Windows 10 1809+/x64，在线安装"）。无 winget 的 Win10 SKU 上所有自动安装退化为"install manually"。
- **影响范围**：非目标环境用户的第一印象与失败率。
- **触发条件**：Win10 老版本 / ARM64 / 离线 / 无 App Installer。
- **依据**：MAINTAINING.md:219；bootstrap.ps1:361-364（winget 不可用即放弃自动装）。
- **推荐修复方向**：README 增加"支持矩阵"一节（已测/未测/不支持）；verify 对非 win32 平台 fail-fast 明确报"仅支持 Windows"；长期可评估 winget 不可用时的直链下载兜底。

**P2-4 PATH 重复检查口径不一致 + 过时文案**
- **问题概述**：bootstrap 查**用户 PATH** 注册表项并可去重（816-824）；verify I 段查**当前进程合并 PATH**（i-system-config.js:20-28），且其文案仍写「只报告，bootstrap 也不去重——需手工清理」——与 bootstrap 已实现的去重（-Apply/-DedupPath）矛盾，会误导用户手工处理。
- **影响范围**：同一台机器两边报告的重复项集合不同；用户被文案误导。
- **触发条件**：Machine PATH 有重复 / 用户 PATH 有重复时对比两份报告。
- **依据**：i-system-config.js:28 vs bootstrap.ps1:312-338、823。
- **推荐修复方向**：文案改为"用户 PATH 重复可由 bootstrap -Apply/-DedupPath 自动去重；此处统计的是进程合并 PATH，Machine 侧重复需手工清理"；或统一口径并注明统计范围。

**P2-5 工作区未配置时的回落语义混淆**
- **问题概述**：manifest.workspace.default 为空时两侧都回落内置 `C:\DSH空间`（一致性已修好），但用户实际工作区在别处且未设 DSH_WORKSPACE 时，H 段报「工作区不存在: C:\DSH空间」，而非「工作区未配置」；00 段的"设 DSH_WORKSPACE"是可选项（info），新用户容易漏。README 声明"这是提示不是 bug"，但对开箱用户仍是误导源。
- **影响范围**：所有未设 DSH_WORKSPACE 且工作区不在默认路径的新用户。
- **触发条件**：默认回落路径不存在。
- **依据**：bootstrap.ps1:473；paths.js:18-20、54-56；h-workspace.js:12-14；README.md:216-218。
- **推荐修复方向**：回落路径命中"内置默认且不存在"时输出「未配置 DSH_WORKSPACE，内置默认 C:\DSH空间 不存在——请设置环境变量或 -Workspace」；考虑把 00 段 env 项在"回落且落空"时升为 warn。

**P2-6 DSH 宿主升级失配只报不修**
- **问题概述**：dsh-compaction-basic 是目录拷贝（非 junction）且版本与宿主不一致时，G2 报 bad/warn 但修复逻辑只在"缺失"时建 junction/拷贝（bootstrap.ps1:98-105 走 skip 分支）。
- **影响范围**：宿主升级后的插件压缩后端失配（三个预设受影响）。
- **触发条件**：宿主升级 + profile 内是拷贝而非 junction。
- **依据**：bootstrap.ps1:98-104；g2-plugin-prereq.js:35-51（检测有、修复无）。
- **推荐修复方向**：-RepairG2 对"非 junction 或版本不一致"的 compaction-basic 提供重建 junction 动作（备份旧目录为 .bak 后替换）。

**P2-7 重复 -Apply 噪音与备份文件堆积**
- **问题概述**：探针失败（如 PATH 未刷新）的工具每次 -Apply 都重跑 winget install 并 warn "already installed"；path-backup-*.txt / path-dedup-*.txt 无保留上限，每次触发备份都新增文件。
- **影响范围**：幂等性"零增量"只覆盖状态不覆盖噪音与 ~/.dsh 目录整洁度。
- **触发条件**：连续多次 -Apply。
- **依据**：bootstrap.ps1:290-296、329-337；收敛测试只断言 PATH 与 home 文件清单（含备份文件的增长？——断言的是两次运行间清单一致，run1 产生备份后 run2 不再产生即通过）。
- **推荐修复方向**：备份文件保留最近 N 份；对 -1978335212 归为 info；探针失败先查 pathDirs 再决定是否重装。

### P3 — 低（打磨、规范与留账）

| # | 问题 | 位置 | 修复方向 |
|---|---|---|---|
| P3-1 | `runVerify()` 成死代码（env_status 已改走 spawn+--jsonl） | server.mjs:34-45 | 删除或复用 |
| P3-2 | `tool_discover` 无参数时返回 matched:0，不提示用法 | server.mjs:143-155 | 无过滤条件时返回全量或 usage |
| P3-3 | 计划任务动作用裸 `node`，任务环境 PATH 不同可能找不到 | bootstrap.ps1:948 | 用 `Get-Command node` 解析出的绝对路径 |
| P3-4 | `-WithProxy`/`-WithScheduledTasks` 不带 `-Apply` 时静默忽略 | bootstrap.ps1:899、944 | 输出"需与 -Apply 同用"提示 |
| P3-5 | Get-CmdVersion 把 banner 首行当版本串展示（如 7-Zip 版权行） | bootstrap.ps1:248-264、584 | 7z 用 `7z`（无参）后正则提取版本号 |
| P3-6 | pyb/pys 硬编码路径检测假定 `C:\Users\<name>`，用户目录在其他盘时误判 | h-workspace.js:49 | 用 `ctx.HOME` 全路径比对 |
| P3-7 | 无 -DryRun 计划预览；MCP 无 SIGTERM 优雅退出 | MAINTAINING.md:222-223（已留账） | -Apply 前打印"将装/将改/人工"清单；stdin end 时 killTree |
| P3-8 | Node winget 源 `OpenJS.NodeJS.LTS` 与 `minMajor:24` 强耦合，未来 LTS 回落会"装完再判不合格" | manifest.json tools[0] | 装后不满足最低版时报"需要 24+，当前 winget LTS 是 XX"并给手动下载链接 |
| P3-9 | CI 注释「绝不跑 bootstrap -Apply」与 Pester 收敛测试实际调用 `-Apply`（stubs 桩隔离）表述不符 | ci.yml:3-4 vs tests-ps/convergence.tests.ps1 | 注释改为"不真装软件；收敛测试以桩代真" |
| P3-10 | G2 修复产物无自动化回滚校验（回滚仅 README 手工说明） | README.md:184-192 | -Apply 输出本次 G2 变更清单，配对回滚命令 |
| P3-11 | `-ExportInventory` 未先探测 npm/winget 存在性即调用（有 try/catch 兜底，行为正确但浪费一次报错） | bootstrap.ps1:410、446 | 调用前 Get-Command 探测 |
| P3-12 | 凭据 key 检查硬编码 `OPENCODE_GO_API_KEY` 一种 key 名 | g2-plugin-prereq.js:198-203 | key 清单进 manifest（如 `credentials.requiredKeys`） |

### 幂等性专项结论

**总体达标**：detect-then-fix 贯穿全部写操作；PATH 只补不删、去重有备份；G2 只补缺；收敛测试（tests-ps/convergence.tests.ps1）用桩断言两次 -Apply 后用户 PATH 与沙箱文件清单零增量，且测试自身有变异验证（改坏判据必红）。**残留问题**仅 P2-6（失配不修）、P2-7（噪音与备份堆积）、P3-10（回滚无自动化）三类，无"每跑一次更烂"级别的累积态缺陷（历史上最狠的 -split 标量陷阱已修并锚定）。

---

## 三、可执行验证步骤（按优先级）

> 全部为只读或可回退操作；V1 建议在 VM 快照上做。

**V1（P0）裸机全流程实测** —— 一次即可把审计结论变成实证：
```powershell
# 干净 Win11 VM（快照后）：
# 1) 官方安装器装 DSH 本体
# 2) 从旧机整目录拷 ~/.dsh（含 profiles\desktop\node_modules）与工作区
# 3) [Environment]::SetEnvironmentVariable('DSH_WORKSPACE','D:\你的工作区','User')
# 4) powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Check   # 记录缺口清单
# 5) powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply 2>&1 | Tee-Object apply1.log
# 6) 重开 shell → node scripts\verify.mjs --json > verify1.json    # 期望硬缺口 0
# 7) 再跑一次 -Apply → reg export HKCU\Environment compare.reg，比对 PATH 零增量、~/.dsh 备份文件不再新增
# 8) 全程日志归档 docs/，记录耗时、失败项、人工步骤是否被 00 段准确引导
```

**V2（P1-1）verify 实时性复现**：
```powershell
Measure-Command { node scripts\verify.mjs }        # 观察 M 段期间控制台静默时长（预期：至全部结束才输出）
node scripts\verify.mjs --jsonl | Out-Null         # 对照：串行逐段有进度行（MCP 通道已具备）
```

**V3（P1-2）双脚本漂移复现**：
```powershell
# 3a) pnpm：造"只有 dsh-runtimes 有 pnpm.cjs"的沙箱
New-Item -ItemType Directory -Force C:\Temp\bare\home\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin | Out-Null
#   放入 pnpm.cjs 后：
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Check    # 预期误报 pnpm bad + -Apply 会误装全局 pnpm
$env:DSH_HOME='C:\Temp\bare\home'; node scripts\verify.mjs --only=A                   # 预期 ok（对照）
# 3b) DSH_HOME 覆盖：
$env:DSH_HOME='C:\Temp\bare\home'; $env:DSH_WORKSPACE='C:\Temp\bare\ws'
node scripts\verify.mjs --only=A,P     # 预期：不应读到真实 ~/.dsh 的 dsh-runtimes 与 AGENTS.md（当前会读到）
```

**V4（P1-3）失败原因反馈**：
```powershell
# 断网或设错误代理（如 HTTPS_PROXY=http://127.0.0.1:9）后：
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply
# 检查点：pip 段失败是否只有一句 "install failed"（当前吞 stderr）；winget 段是否给出网络/权限可行动提示
```

**V5（P2-1）7-Zip/PATH 与探针**：
```powershell
# 干净 VM 或临时改名 7z.exe 后跑 -Apply：
# 检查点：安装成功后是否 [FIX]（旧版 7-Zip 预期 [WARN] not resolvable —— 探针 bug）；非 7z 工具装后不在 PATH 是否只 warn
```

**V6（P2-2）非管理员会话**：标准用户终端跑 `-Apply`，记录 winget UAC/失败行为与提示是否足够操作。

**V7（P2-3）兼容抽测**：Win10 21H2 / ARM64 / 移除 winget 的环境各跑 `-Check`，对照支持矩阵声明。

**V8（MCP 回归）**：
```bash
# env_status 带/不带 _meta.progressToken 各一次（观察进度通知）；发 notifications/cancelled 验证 -32800
# tool_resolve name=7z（临时移出 PATH）：期望 resolved:true, inPath:false, installedNotInPath:true
# tool_discover 无参数：观察是否给出用法而非 matched:0
```

**V9（三验回归）**：`node --test "tests/**/*.test.mjs"`（117）→ Pester（21，注意其收敛测试会写真实用户 PATH，跑前 `reg export HKCU\Environment` 留底）→ `smoke.ps1`。

---

## 四、结论与最小改进路线

### 是否达到"开箱即用"？

**没有，但已达到"半自动换机助手"的成熟水平。** 三个核心主张的达成度：

1. **自动完成电脑环境配置** —— 部分达成。声明范围（阶段二）内自动装链路完整、幂等可靠；但阶段一（本体/拷盘/凭据）按设计不自动化，且全流程无真机实证（P0-1）。
2. **检测缺失依赖/配置异常** —— **达成**。18 段覆盖面、判据质量（读注册表而非 Get-ExecutionPolicy、实写探针而非 accessSync、分发名而非 import 名）是同类工具里的上乘水平。
3. **实时反馈检测状态/失败原因/更新结果** —— 部分达成。bootstrap 逐条流式 + [FIX]/退出码/JSON 齐备；verify 人类模式批量输出（P1-1）；pip 失败原因被吞（P1-3）。

### 最小改进路线（按投入/收益排序，做完 1-3 即可宣称"开箱即用"）

1. **跑 V1 裸机实测并归档**（P0-1）—— 不改一行代码，直接决定结论成色；顺手把 V5/V6 的非管理员与 7-Zip 场景并入同一次测试。
2. **verify 人类模式段级流式输出**（P1-1）—— --jsonl 串行基础已具备，只差人类排版层改造，工作量小、直击"实时反馈"主张。
3. **收敛双脚本漂移**（P1-2）—— pnpm 路径 + DSH_HOME 三处 + g2/h 清单改读 manifest，加"双脚本同向"契约测试；消除误装全局 pnpm 的副作用。
4. **失败原因透出**（P1-3）—— Install-Pip 保留尾部错误行 + 安装失败分类提示（网络/权限/源），半天工作量。
5. 其余 P2/P3 按排期消化：PATH 修复泛化（P2-1）、非管理员策略（P2-2）、支持矩阵声明（P2-3）、过时文案（P2-4）、失配自修（P2-6）、备份保留上限（P2-7）。

### 一句话总结

> 这是一个**检测面一流、安装面合格、反馈面有缺口、实证面空白**的换机助手：把 1-4 做完并完成一次裸机实测，"开箱即用"的招牌就立得住；在此之前，它的诚实文档（MAINTAINING 的"没做的"清单）是它最值得肯定的部分。

---

*审计基线 `f0628a7`；全部问题均经代码定位、双实现对照或本机探针复现，行号以该基线为准。未修改任何代码。*
