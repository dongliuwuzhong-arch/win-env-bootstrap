# win-env-bootstrap

**通用 Windows 换机内核 + 可选 DSH 专属层：公开工具装齐 + 十八类自检。**

> [English](README.en.md) · 中文

> 🔧 **要维护或修改它** → 读 [MAINTAINING.md](MAINTAINING.md)（文件地图、三条铁律、踩过的坑、还没做的事）。

一台新 Windows 上把常用公开工具装齐并自检的**换机内核**：能自动装的那部分用 winget / pip 装上，
PATH 缺项自动补，其余只出报告。十八类检查，最后出中文报告。**core 档不依赖任何 agent 框架**——
不是 DSH 用户也能直接用；DSH（DeepSeek Harness）用户额外获得专属层（插件前置修复、人格/技能库检查等）。

> A generic Windows machine-migration kernel: install the public tools, fix missing PATH entries,
> run 18 categories of checks, print a Chinese report. The `core` profile has zero agent-framework
> dependencies; a `dsh` profile adds the DSH-specific layer on top. Full English docs: [README.en.md](README.en.md).

## 两种用法（core / dsh 双档）

| 档 | 给谁 | 跑什么 |
|---|---|---|
| **core（通用内核）** | 任何换机用户、任何 agent/开发框架 | A–F 核心运行时/归档/媒体/浏览器/逆向/Python 包、I 系统配置、J 网络、K 代理自启、O 系统环境、P 迁移完整性——只依赖 Windows + winget/pip/npm |
| **dsh（专属层）** | DSH 用户（在 core 之上追加） | 00 人工前置、G DSH 本体、G2 插件加载前置修复、H 人格/技能库、L 工作区脚本、M 总检、N 技能级依赖 |

默认**自动探测**：检测到 DSH 安装或 `~/.dsh` 就两档都跑，否则只跑 core（专属段跳过并提示一行）。
显式指定：`verify.mjs --profile=core|dsh`、`bootstrap.ps1 -Profile Core|Dsh`。

## DSH 用户的两阶段：谁负责哪一段

| 阶段 | 谁做 | 内容 |
|---|---|---|
| **一（前提）** | 人 + 官方安装器 | 装 DSH 本体；拷工作区目录和 `~/.dsh\`（含 `profiles\desktop\node_modules`）；填 `.credentials.yaml` |
| **二（本工具）** | `bootstrap.ps1` + `verify.mjs` | 装齐公开工具、补 PATH 缺项、修 G2 加载前置、跑 18 类自检出中文报告 |

阶段一没做完，dsh 档只能报一堆红——它不代替阶段一。**core 档没有这个前置。**

## 它解决什么问题

换电脑最耗时的从来不是装本体，是把周围那一圈补齐：

- Node 版本不对（DSH 要 24+）
- Python 没装，或者装了但缺包
- 7-Zip 装了**但不在 PATH**（最经典的坑）
- PowerShell 5.1 读中文路径乱码
- curl 其实是 Invoke-WebRequest 的别名
- 加速器把系统代理抢走，设了也白设
- **profile 里那几个手工放的包，pnpm install 补不回来**（DSH 专属层项）

这些每台机器都要重新踩一遍。这个工具把它们固化成两个脚本。

## 它不解决什么

- **不装 DSH 本体**。官方安装器的事，装完再跑这个。
- **不建 `~/.dsh` 目录树**。profile、插件都是拷过来的，缺了脚本只报红；唯一往里写的是
  已存在目录里的 `.credentials.yaml` 注释模板。
- **不拷工作区目录和 `profiles\desktop\node_modules`**。手工搬，漏了就是三个预设全挂。
- **不填 `.credentials.yaml`**。缺文件时写一份**只有注释、没有任何值**的模板，key 得自己填。
- **G2 修不了没有源的东西**。手工包要从宿主 `node_modules` 拷，本地插件要从 `~/.dsh/plugins` 拷；
  源不在就只报红。win-bash payload 只给指引，soul schema 只读不动数据。
- **有些缺项只报告**：G 段 DSH 本体、ffprobe（随 ffmpeg 装，缺了只提示重装）、
  curl.exe / winget 本体、N/O/P 三段、拿不到源的 G2 修复件。其余缺项 `-Apply` 会自动装（见下面「十八类检查」表）。
- **PATH 缺项只补不删；重复项自动去重**（`-Apply` / `-DedupPath`，先备份 path-dedup-*.txt）。
- **不动宿主数据**（`~/.dsh/storages`、`~/.dsh/sessions`）。
- **不改系统代理**。只给目标程序挂单独的代理启动器。
- **不装 MSYS 缺失的 which/df/du**。用替代命令。

## 为什么引导层是 PowerShell

**鸡生蛋**：新机器没有 Node，Node 脚本跑不起来。

PowerShell 5.1 是 Windows 10/11 自带的，所以引导层必须是它。装完 Node 之后，详细检查才交给 verify.mjs。

## 快速开始

先只读探测，再决定装什么：

```powershell
# 1. 只探测，不改任何东西
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Check

# 1.5 变更预览（可选）：-DryRun 走 -Apply 的判断逻辑，每个写动作只打 "plan:" 不动手
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -DryRun

# 2. 装缺失的 + 配 PATH
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply

# 3. 再加代理启动器 + 开机自启（可选）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply -WithProxy

# 4. 再加对话存档计划任务（可选）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply -WithScheduledTasks

# 5. 系统调优（可选，逐项 opt-in、全部可回退——见「系统调优」一节）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -List

# 6. 导出换机清单（winget + 两套 pip + npm，落 ~/.dsh/inventory-*.json）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -ExportInventory
```

装完 Node 之后跑详细自检：

```bash
node scripts/verify.mjs
```

退出码：0 全过 / 1 有硬缺口 / 2 能跑但有提醒。

## 十八类检查

`config/manifest.json` 的 `categories` 是唯一清单，这张表跟 [SKILL.md](SKILL.md) 的表格逐行一致。
「缺了怎么办」列写的是脚本实际干的事。

| 段 | 查什么 | 缺了怎么办 |
|---|---|---|
| 00 人工前置（阶段一） | 装 DSH 本体 / 拷 `~/.dsh` / 拷工作区 / 填凭据 / 设 DSH_WORKSPACE | 只检查、只引导——阶段一是人工活，脚本从不做 |
| A 核心运行时 | Node 24+ / Python 3.12+ / Git / curl.exe / winget / pnpm | winget 装 Node、Python、Git；pnpm 先认 DSH 自带那份，没有才 `npm i -g`；curl.exe / winget 只提示 |
| B 归档工具 | 7-Zip + 是否在 PATH（User 和 Machine 都查） | winget 装；装了但不在 PATH 就追加（先备份，备份失败不动） |
| C 媒体工具 | ffmpeg / ffprobe / yt-dlp / ImageMagick | ffmpeg、yt-dlp、ImageMagick 走 winget（用 `magick` 调，`convert` 会撞系统磁盘工具）；ffprobe 随 ffmpeg 装，缺了提示重装 Gyan.FFmpeg |
| D 浏览器自动化 | Chrome / puppeteer | Chrome 走 winget；puppeteer 在 `_tools\browser` 里自动 `npm i`（工作区没这目录才只提示） |
| E 逆向工具（可选） | frida | 缺了走 pip 装 frida + frida-tools，装完复测 |
| F Python 包 | 系统包 + wechat 取证包 + DSH 自带 python 核心包（清单来自 `manifest.pythonPackages`） | 全部缺了就走 pip 装（两套解释器分开装） |
| G DSH 本体 | 宿主 exe / 解包树 / .dsh / profile bundles / 凭据内容 / CLI shim | **只检查**——官方安装器的事 |
| G2 插件加载前置 | junction / 手工包 / 本地插件 / node:sqlite / 宿主可写 / profile 名 / win-bash / uv / Steam / PS 5.1 | **会修**（`-RepairG2`，`-Apply` 隐含）：拷 5 个手工包（`dsh-compaction-basic` 建 junction）、按 manifest.g2.localPlugins 清单拷本地插件（作者机 4 个，公开仓库默认留空需自填）、缺凭据写注释模板；win-bash payload、soul schema、宿主缺失只提示 |
| H 工作区 | 七个目录 / 人格四件套 / 技能库 / pyb-pys 硬编码 | 缺目录 `-Apply` 自动建；人格、技能库只检查 |
| I 系统配置 | PATH 重复 / 执行策略生效值 / 计划任务动作 / 代码页 | 执行策略 Restricted\|AllSigned 自动改 CurrentUser RemoteSigned；PATH 重复项自动去重（`-Apply`/`-DedupPath`，先备份 path-dedup-*.txt）；计划任务只在 `-WithScheduledTasks` 时注册；代码页只提示 |
| J 网络 | 本地代理端口 7897 | 只提示 |
| K 代理与自启 | 启动器 vbs / Run 键 | `-WithProxy` 生成 |
| L 脚本可跑性 | check-paths / check-skills / persona-lint / check-persona-context | 只报哪个挂了 |
| M 总检 | 调 `dsh-selfcheck`，看退出码不看文案 | 只报 |
| N 技能级可选依赖 | exiftool / dotnet / youtube-transcript 的 node_modules / osint 依赖 / playwright / agent-reach / ChatTrace / TTS 端点 | 全是 info，不阻断，不装 |
| O 系统环境 | Defender / w32time / 中文字体 / LongPaths / 磁盘余量 | 只报 |
| P 环境完整性与迁移 | 端口 / 单实例 / 根证书 CA / 工作区 ACL / DSH_WE_DATA_DIR / AGENTS.md / 自启 vbs | 只报 |

## 哪些是真装

`bootstrap.ps1 -Apply` 真会装的有：Node、Python、Git（可选）、pnpm（`npm -g`）、7-Zip（+PATH）、
ffmpeg、yt-dlp、ImageMagick、Chrome、rg、jq、exiftool、dotnet（winget）；puppeteer（工作区里 `npm i`）；
pip 包两套解释器分开补（系统 python 的 pillow/pyyaml/frida/frida-tools/wechat 取证包，
DSH 自带 python 的 numpy/pandas/openpyxl/pillow/lxml，清单以 `manifest.pythonPackages` 为准）。

单点自动改的只有：PATH 缺项追加（先备份）、执行策略 Restricted/AllSigned → CurrentUser RemoteSigned、
`-WithProxy` 写启动器 + Run 键、`-WithScheduledTasks` 注册计划任务，
以及 G2 修复（`-RepairG2`）：`dsh-compaction-basic` 建 junction、4 个手工包 + 本地插件按清单拷（作者机 4 个）、
缺凭据时写注释模板。**只补缺，已有的一律跳过。**

其余全部只报告。`verify.mjs` 一个字节都不改系统——只写一个临时探针文件试可写性，然后删掉。

## 换机最容易漏的（G2 段专门查这些）

这些不是「功能缺失」，是**加载期直接 throw**，DSH 起来就是三个预设全挂。
verify.mjs 只读查这一段，bootstrap.ps1 的 G2 段带修复（`-RepairG2`，`-Apply` 隐含）。
**修的前提是源文件在**：宿主 `node_modules` 和 `~/.dsh/plugins` 得先拷过来，缺源只报红。

1. **@deepseek-ai/dsh-compaction-basic 的版本必须和宿主那份一致**。不一致 compactNow 可能就没了。
   junction 指向宿主最稳，但同版本目录拷贝也能跑——脚本把「版本不一致」判红、把「不是 junction」记 info。
   新机跑 pnpm install 造不出这个 junction，而多个预设都挂了某个插件的压缩后端。
2. **profile 里 @deepseek-ai/ 下 5 个包全是手工放的**，不在 dependencies 里，pnpm install 不会补。
3. **本地插件是拷贝不是符号链接**（清单在 manifest.g2.localPlugins，作者机 4 个，公开仓库默认留空需自填）。只拷 ~/.dsh/ 不带 node_modules 时清单里的全缺。
4. **会改宿主文件的插件要能写宿主安装目录**。装在 Program Files 且非管理员时，补丁一条都落不下去。
5. **用 SQLite 的插件有 schema 版本硬门**。库里 user_version 高于插件支持的值会直接 throw。

## 踩过的坑

24 条实测撞出来的坑，全在 [SKILL.md](SKILL.md) 里。最狠的两条：

- **`-split` 只返回一条时是 String 不是数组** —— `($parts + $dir)` 做字符串拼接，整条 PATH 糊成 `C:\AAAC:\BBB`，且每跑一次更烂。
- **`Set-Content -Encoding ASCII` 写中文变 `?`** —— VBS 路径含中文就静默失效，开机自启坏得无声无息。

## 两种用法

这工具是两层的（`manifest.modules` 是清单源）：

| 档 | 给谁 | 内容 | 怎么开 |
|---|---|---|---|
| **core 通用换机内核** | 任何换机/重装 Windows 的人 | 公开工具安装与补缺（A–F）、PATH 修缮、Windows 配置体检（I/J/K/O）、清单导出、tweaks 调优、MCP 解析 | 默认自动：没检测到 DSH 就只跑这层 |
| **dsh 专属层** | DSH 用户 | 阶段一人工前置（00）、DSH 本体（G）、插件前置（G2）、工作区/人格/技能（H）、dsh-selfcheck（M）、凭据 | 默认自动：检测到 DSH 本体或 `~/.dsh` 就一起跑 |

```powershell
# 显式指定（覆盖自动探测）：
node scripts\verify.mjs --profile=core
powershell -File .\scripts\bootstrap.ps1 -Check -Profile Core
# 或环境变量：DSH_MODULES=core / core,dsh
```

DSH 用户的体验不变（默认全跑 18 段）；非 DSH 用户不再被 G/G2 红条刷屏，退出码只算启用的段。
显式 `--only=段名` 点名了就跑，不受模块过滤影响。

## 支持范围

| 环境 | 状态 |
|---|---|
| Windows 11 x64 + winget + 在线 | ✅ 实测（本机 + CI windows-latest / windows-2022 双跑） |
| Windows 10 1809+ x64 | ⚠️ 未实测（有 ConPTY build 检查兜底），预计可用 |
| ARM64 / 离线 / 无 winget 的老 Win10 SKU | ❌ 未测。无 winget 时自动安装退化为「install manually」提示 |
| macOS / Linux | ❌ 不支持 |

新机端到端（裸机）验证清单见 [docs/裸机验证清单.md](docs/裸机验证清单.md)——
真机跑完归档，「开箱即用」就从承诺变实证；在那之前它自称的是「半自动换机助手」。

## 系统调优（可选）

环境补齐之外的 Windows 设置调校，**逐项 opt-in、全部可回退**，清单在 `config/manifest.json` 的 `tweaks[]`：

| id | 干什么 | 怎么撤 | 权限 |
|---|---|---|---|
| longpaths | LongPathsEnabled=1，Win32 长路径不截断 | 设回 0 | admin |
| power-highperf | 激活高性能电源计划 | 切回平衡 | 普通 |
| gamebar-off | 关 Game Bar 后台录制（HKCU） | 设回 1 | 普通 |
| defender-exclusions | 工作区/DSH 目录加 Defender 排除 | 移除排除项 | admin |
| hiberfil-off | 关休眠，释放 hiberfil.sys | powercfg /hibernate on | admin |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -List          # 纯探测，不改任何东西
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -Apply gamebar-off
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -Revert gamebar-off
```

探不到真实状态时报 `unknown`，不猜（比如 Defender 被第三方杀软接管时）。admin 项在非管理员终端报 FAIL 就停手，不硬写。

## 换机清单导出

`bootstrap.ps1 -ExportInventory` 把 winget export + 两套 python 的 pip list
+ npm 全局包导出到 `~/.dsh/inventory-时间戳.json`（winget 部分另出 `inventory-时间戳-winget.json`，
微软官方换机格式）。`-InventoryPath` 可改落点目录。换机后对着清单查漏，不用人肉记。

## 挂起重启检测

`-Check` / `-Apply` 开头探测三个挂起重启源（PendingFileRenameOperations / CBS / Windows Update），
有就先提示「重启后重跑」——驱动类包装到一半重启，不重跑就半残。

## 怎么退

| 改动 | 怎么撤 |
|---|---|
| 用户 PATH 缺项追加 | 每次 `-Apply` 前备份到 `~/.dsh/path-backup-*.txt`，覆盖回去即可 |
| 用户 PATH 去重 | 每次去重前备份到 `~/.dsh/path-dedup-*.txt`，覆盖回去即可 |
| `HKCU\...\Run\DSH` | `Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name DSH` |
| 计划任务 `DSH-DialogArchive` | `Unregister-ScheduledTask -TaskName DSH-DialogArchive -Confirm:$false` |
| G2 修复产物 | `profiles\desktop\node_modules` 下新建的 junction / 拷贝的包删掉即可；`-Apply` 结束时会自动打印本次 G2 变更清单和配对回滚命令；脚本只补缺，已有的一律跳过 |

## 作为技能安装（任意框架）

把整个目录放到工作区的技能库，DSH 及兼容 SKILL.md frontmatter 的 agent 框架都会自动识别并注册：

```
<workspace>\.agents\skills\win-env-bootstrap\
```

之后说「装环境」「换电脑」「bootstrap」就能触发。不作为技能用也行——直接跑 `scripts\` 下的脚本就是完整功能。

## 首次使用：指定工作区

脚本**不依赖作者的工作区路径**——内置兜底 `C:\DSH空间`，用下面任一方式即可覆盖。第一次跑之前告诉它工作区在哪：

```powershell
# 方式一：环境变量（推荐，一次设好）
[Environment]::SetEnvironmentVariable('DSH_WORKSPACE', 'D:\你的工作区', 'User')

# 方式二：每次传参
.\scripts\bootstrap.ps1 -Check -Workspace 'D:\你的工作区'
```

优先级：`-Workspace` 参数 > `DSH_WORKSPACE` 环境变量 > `config/manifest.json` 的 `workspace.default`。

没设的话会回落到内置默认 `C:\DSH空间`（和 bootstrap 同口径）；路径不存在时 H 段报「工作区不存在: …」——这是提示，不是 bug。

MAINTAINING.md 是维护交接文档；docs/ 下有历次审查报告归档和[维护日志](docs/维护日志.md)。

## License

MIT
