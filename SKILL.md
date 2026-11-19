---
name: win-env-bootstrap
description: 通用 Windows 换机内核 + 可选 DSH 专属层：把新机常用公开工具装齐并自检，十八类检查。说「装环境」「换电脑」「新机器」「环境没配」「bootstrap」「一键配环境」时触发。core 档不依赖任何 agent 框架，任意用户可用；DSH 用户自动追加专属层（装本体/拷工作区/填凭据仍是人工前置）。能自动装的只有一部分，其余只报告；PATH 缺项自动补、重复项自动去重（先备份）。
---

# win-env-bootstrap · 新机环境一次装齐

> 2026-11-18 起草，2026-11-19 建仓（原名 dsh-env-bootstrap，2026-11-20 随 core/dsh 分层更名）。
> 定位：**通用 Windows 换机内核**——core 档把周围一圈公开工具补齐并自检，任何框架/用户可用；
> dsh 档在其上追加 DSH 专属层（插件前置修复、人格/技能库等）。

## 两种用法（core / dsh 双档）

| 档 | 给谁 | 跑什么 |
|---|---|---|
| **core** | 任何换机用户、任何 agent/开发框架 | A–F / I / J / K / O / P —— 只依赖 Windows + winget/pip/npm |
| **dsh** | DSH 用户（在 core 之上追加） | 00 / G / G2 / H / L / M / N |

默认自动探测（有 DSH 环境两档都跑，否则 core）；`--profile=core|dsh` / `-Profile Core|Dsh` 显式指定。

## DSH 用户的两阶段：谁负责哪一段

| 阶段 | 谁做 | 内容 |
|---|---|---|
| **一（前提）** | 人 + 官方安装器 | 装 DSH 本体；拷工作区目录和 `~/.dsh\`（含 `profiles\desktop\node_modules`）；填 `.credentials.yaml` |
| **二（本工具）** | `bootstrap.ps1` + `verify.mjs` | 装齐公开工具、补 PATH 缺项、修 G2 加载前置、跑 18 类自检出中文报告 |

阶段一没做完，dsh 档只能报一堆红——它不代替阶段一。**core 档没有这个前置。**

> 🔧 **要改这个技能**（加检查项、加工具、修判据、查某条检查为什么不生效、或者接手维护）→ 先读 [`MAINTAINING.md`](MAINTAINING.md)。
> 里面有文件地图、三条铁律（PS 5.1 必须纯 ASCII / 判据必须能跑红 / 改完三验）、九条踩过的坑、以及「哪些还没做」。

## 怎么用

```powershell
# 只探测，不改任何东西
powershell -NoProfile -ExecutionPolicy Bypass -File <技能目录>\scripts\bootstrap.ps1 -Check

# 装缺失的 + 配 PATH
powershell -NoProfile -ExecutionPolicy Bypass -File <技能目录>\scripts\bootstrap.ps1 -Apply

# 再加代理启动器和开机自启
powershell -NoProfile -ExecutionPolicy Bypass -File <技能目录>\scripts\bootstrap.ps1 -Apply -WithProxy

# 再加对话存档计划任务
powershell -NoProfile -ExecutionPolicy Bypass -File <技能目录>\scripts\bootstrap.ps1 -Apply -WithScheduledTasks
```

装完 Node 之后跑详细自检：

```bash
node <技能目录>/scripts/verify.mjs
```

退出码：`0` 全过 / `1` 有硬缺口 / `2` 能跑但有提醒。

## 十八类检查

`config/manifest.json` 的 `categories` 是唯一清单，下面 18 行按它逐行排。
「缺了怎么办」列写的是**脚本实际干的事**，不是打算干的事。

| # | 类别 | 查什么 | 缺了怎么办 |
|---|---|---|---|
| 00 | **人工前置（阶段一）** | 装 DSH 本体 / 拷 `~/.dsh` / 拷工作区 / 填凭据 / 设 DSH_WORKSPACE | 只检查、只引导——阶段一是人工活，脚本从不做 |
| A | **核心运行时** | Node 24+ / Python 3.12+ / Git / curl.exe / winget / pnpm | winget 装 Node、Python、Git；pnpm 先认 DSH 自带那份，没有才 `npm i -g`；**curl.exe / winget 只提示** |
| B | **归档工具** | 7-Zip + 是否在 PATH（User 和 Machine 都查） | winget 装；装了但不在 PATH 就追加（改前备份到 `~/.dsh`，备份失败则不动） |
| C | **媒体工具** | ffmpeg / ffprobe / yt-dlp / ImageMagick | ffmpeg、yt-dlp、ImageMagick 走 winget（用 `magick` 调，`convert` 会撞系统磁盘工具）；ffprobe 随 ffmpeg 装，缺了提示重装 Gyan.FFmpeg |
| D | **浏览器自动化** | Chrome / puppeteer | Chrome 走 winget；puppeteer 在 `_tools\browser` 里自动 `npm i`（工作区没这目录才只提示） |
| E | **逆向工具（可选）** | frida | 缺了走 pip 装 frida + frida-tools，装完复测 |
| F | **Python 包** | 系统包 + wechat 取证包 + DSH 自带 python 核心包（清单来自 `manifest.pythonPackages`） | 全部缺了就走 pip 装（两套解释器分开装） |
| G | **DSH 本体** | 宿主 exe / 解包树 / .dsh / profile bundles / 凭据内容 / CLI shim 在不在 PATH | **只检查**——官方安装器的事 |
| G2 | **插件加载前置** | junction / 手工包 / 本地插件 / node:sqlite / 宿主可写 / profile 名 / win-bash / uv / Steam / PS 5.1 | **会修**（`-RepairG2`，`-Apply` 隐含）：从宿主拷 5 个手工包（`dsh-compaction-basic` 建 junction）、从 `~/.dsh/plugins` 按 manifest.g2.localPlugins 清单拷本地插件（作者机 4 个，公开仓库默认留空需自填）、缺凭据时写注释模板；**win-bash payload、soul schema、宿主缺失只提示** |
| H | **工作区** | 七个目录 / 人格四件套 / 技能库 / pyb-pys 硬编码 | 缺目录 `-Apply` 自动建；人格、技能库只检查 |
| I | **系统配置** | PATH 重复 / 执行策略生效值 / 计划任务动作 / 代码页 | 执行策略 Restricted\|AllSigned 自动改 CurrentUser RemoteSigned；PATH 重复项自动去重（`-Apply`/`-DedupPath`，先备份 path-dedup-*.txt）；计划任务只在 `-WithScheduledTasks` 时注册；代码页只提示 |
| J | **网络** | 本地代理端口 7897 | 只提示（不开也能用） |
| K | **代理与自启** | 启动器 vbs / Run 键 | `-WithProxy` 生成 vbs 并写 Run 键 |
| L | **脚本可跑性** | check-paths / check-skills / persona-lint / check-persona-context | 只报哪个挂了、退出码多少 |
| M | **总检** | 调 `dsh-selfcheck`，**退出码 0 才算过**（文案只作摘要） | 只报 |
| N | **技能级可选依赖** | exiftool / dotnet / youtube-transcript 的 node_modules / osint 依赖 / playwright / agent-reach / ChatTrace / TTS 端点 | 全是 info，不阻断，不装 |
| O | **系统环境** | Defender / w32time / 中文字体 / LongPaths / 磁盘余量 | 只报（时间偏移会让 HTTPS 证书校验失败） |
| P | **环境完整性与迁移** | 端口 / 单实例 / 根证书 CA / 工作区 ACL / DSH_WE_DATA_DIR / AGENTS.md / 自启 vbs | 只报——迁移时会带毒的东西 |

## 哪些是真装，哪些只报告

`bootstrap.ps1 -Apply` 真会装的，就这些：

```
Node · Python · Git（可选）· pnpm（npm -g）· 7-Zip（+PATH）· ffmpeg · yt-dlp · ImageMagick · Chrome
rg · jq · exiftool · dotnet（winget）· puppeteer（工作区里 npm i）
pip（系统 python）：pillow · pyyaml · frida · frida-tools · wechat 取证包
pip（DSH 自带 python）：numpy · pandas · openpyxl · pillow · lxml
G2 修复（-RepairG2 / -Apply）：dsh-compaction-basic junction · 4 个手工包拷贝
                                  · 本地插件按清单拷（作者机 4 个） · .credentials.yaml 注释模板
```

单点自动改的，就这几处：

```
PATH 缺项追加（先备份） · 执行策略 Restricted|AllSigned → CurrentUser RemoteSigned
-WithProxy 写启动器 + Run 键 · -WithScheduledTasks 注册 DSH-DialogArchive
```

其余只报告：ffprobe（随 ffmpeg 装，缺了提示重装 Gyan.FFmpeg）/ curl.exe 与 winget 本体 /
G 段 DSH 本体 / N / O / P / 拿不到源的 G2 件。
G2 里「手工包 + 本地插件清单 + 凭据模板」会修，win-bash payload、soul schema、宿主缺失仍然只提示。
`verify.mjs` 一个字节都不改系统——它只写一个临时探针文件试可写性，然后删掉。

## 换机最容易漏的（G2 段专门查这些）

这些不是「功能缺失」，是**加载期直接 throw**，DSH 起来就是三个预设全挂。
`verify.mjs` 只读查这一段，`bootstrap.ps1` 的 G2 段带修复（`-RepairG2`，`-Apply` 隐含）。
**修的前提是源文件在**：宿主的 `resources\app\dsh\node_modules` 和 `~/.dsh/plugins` 得先拷过来，缺源只报红。

1. **`@deepseek-ai/dsh-compaction-basic` 的版本必须和宿主那份一致**。
   不一致 `compactNow` 可能就没了。junction 指向宿主是最稳的形态（实测 `isSymbolicLink() = true`
   → `C:\Software\DSH\resources\app\dsh\node_modules\@deepseek-ai\dsh-compaction-basic`），
   但**目录拷贝也能跑**，所以脚本只把「版本不一致」判红、把「不是 junction」记成 info。
   新机跑 `pnpm install` 造不出这个 junction，而多个预设都挂了某个插件的压缩后端。
2. **profile 里 `@deepseek-ai/` 下 5 个包全是手工放的**（cosmokit / dsh-compaction / dsh-compaction-basic /
   dsh-compaction-tool-result-pruner / schemastery），不在 `dependencies` 里，`pnpm install` 不会补。
3. **本地插件是拷贝不是符号链接**（`lstat().isSymbolicLink() = false`；清单在 manifest.g2.localPlugins，作者机 4 个，公开仓库默认留空需自填）。
   改源码不生效要重装；反过来，只拷 `~/.dsh/` 不带 `node_modules` 时四个全缺。
4. **会改宿主文件的插件要能写宿主安装目录**。装在 Program Files 且非管理员时，
   补丁一条都落不下去。
5. **用 SQLite 的插件有 schema 版本硬门**。库里 `PRAGMA user_version` 高于插件支持的值会直接 throw。

静默哑掉（不报错，功能没了）：WorkBuddy App 未登录、ffmpeg 缺失（WE 抽帧）、
WE 本体未装（空列表）、`OPENCODE_GO_API_KEY` 没设、PS 5.1 被卸（toast 失败）、
TTS 外网 WSS 不通、bridge-next 的 uv/15 个 pip 包缺。

## 它不解决什么

- **不装 DSH 本体**。官方安装器的事，装完再跑这个。
- **不建 `~/.dsh` 目录树**。profile、插件都是拷过来的，缺了脚本只报红；唯一往里写的是
  已存在目录里的 `.credentials.yaml` 注释模板。
- **不拷工作区目录和 `profiles\desktop\node_modules`**。手工搬，漏了就是三个预设全挂。
- **不填 `.credentials.yaml`**。缺文件时写一份**只有注释、没有任何值**的模板，key 得自己填。
- **G2 修不了没有源的东西**。手工包要从宿主 `node_modules` 拷，本地插件要从 `~/.dsh/plugins` 拷；
 源不在就只报红。win-bash payload 只给指引，soul schema 只读不动数据。
- **有些缺项只报告**：G 段 DSH 本体、ffprobe（随 ffmpeg 装，缺了只提示重装）、
  curl.exe / winget 本体、N/O/P 三段、拿不到源的 G2 修复件。
- **PATH 缺项只补不删；重复项自动去重**（`-Apply`/`-DedupPath`，先备份 path-dedup-*.txt）。
- **不动 `~/.dsh\storages`、`~/.dsh\sessions`**。宿主数据，只读。
- **不改系统代理**。实测鲜牛等加速器会抢 `ProxyEnable`（改成 1 后 500ms 内被压回 0），
  所以只给 DSH 单独挂代理启动器，不碰全局。
- **不装 MSYS 缺失的 which/df/du**。Git Bash 精简版的天生缺口，用替代命令。

## 这台机器实测的环境缺口（2026-11-18）

| 项 | 状态 | 处理 |
| --- | --- | --- |
| Node v24.22.1 / DSH 自带 24.21.0 | ✅ | — |
| Python 3.12.10（系统）/ 3.12.14（DSH 自带） | ✅ | 两套包不同，要分开查 |
| pnpm | ✅ DSH 自带 11.28.5 | 系统没有不算缺口 |
| 7-Zip 26.03 | ⚠️ 装了但不在 PATH | 已补（`Add-PathEntry`） |
| ffmpeg / ffprobe | ✅ | — |
| yt-dlp | ❌ 原本没有 | 已 pip 装 |
| frida | ❌ 原本没有 | 手工装 17.27.0；脚本现在可 pip 自动装（frida + frida-tools） |
| ImageMagick | ❌ 没有，且 `convert` 撞系统磁盘工具 | 未装；脚本现在可 winget 自动装（用 `magick` 调） |
| `which` `df` `du` `od` `sha256sum` `stat` `wget` | ❌ MSYS bash 没有 | 不装，用替代命令（rg / jq 已由脚本 winget 自动装） |
| PATH 重复项 | ⚠️ DSH cli bin 出现两次 | -Apply 自动去重（备份 path-dedup-*.txt）；当时是手工清的 |
| 控制台代码页 | 936（GBK） | 不影响功能，脚本零非 ASCII |

## 踩过的坑（脚本里都处理了）

1. **`$args` 是 PowerShell 自动变量** —— 当函数参数名用，`& $exe $args` 变数组展开，node/python/curl 全误报「not found」。
2. **`curl` 在 PS 5.1 里是 `Invoke-WebRequest` 的别名** —— 必须写 `curl.exe`。
3. **中文字面量在 `-File` 模式下会乱码** —— 含中文的路径被读成乱码。脚本里零非 ASCII，用 `[char]0x7A7A + [char]0x95F4` 码点拼。
4. **`Get-Command python` 返回数组**（python 和 python3 两个）—— 必须 `Select-Object -First 1`。
5. **`.cmd`/`.bat` 不能用 `execFileSync` 直调** —— Node 里要 `shell: true`。
6. **`$env:TEMP` 在 `-File` 模式下可能是空的** —— 备份路径用固定位置。
7. **MSYS bash 会把反斜杠吃掉** —— 传路径给 node 用正斜杠。
8. **加速器会抢系统代理** —— 只给目标程序单独挂代理。
9. **自启路径必须 ASCII** —— 注册表存中文路径会坏。
10. **`-split` 只返回一条时是 String 不是数组** —— `($parts + $dir)` 做字符串拼接，整条 PATH 糊成 `C:\AAAC:\BBB`，且每跑一次更烂。必须 `@()` 包裹。
11. **`Set-Content -Encoding ASCII` 写中文变 `?`** —— VBS 路径含中文就静默失效；编码必须 `-Encoding Unicode`（UTF-16LE），详见坑 18。
12. **`-or $out` 会把报错当已装** —— Microsoft Store 的 python stub 退出码 9009、stderr 打 "Python was not found"，被当成 `[ OK ] python Python was not found...`。
13. **`Get-ExecutionPolicy -Scope CurrentUser` 常是 `Undefined`** —— 要读生效值，否则 LocalMachine=Restricted 时报 OK 但实际全被挡。
14. **`Test-PathEntry` 只查 User 会误报** —— 7-Zip 选 "for all users" 时只写机器级 PATH。
15. **`convert` 在 Windows 上命中系统磁盘工具** —— ImageMagick 缺失时 `image_*.py` 会把图片参数喂给 `C:\Windows\system32\convert.exe`，不报错、跑错程序。必须查 `magick`。
16. **DSH 自带 pnpm / python，系统没有不算缺口** —— 运行时在 `resources/runtime/primary-runtime/dependencies/`，`runtime.json` 写明版本和包清单。
17. **`run()` 不能把「非零退出」当「没装」** —— 很多 CLI 的 `--version` 返回非 0；要区分 `ENOENT`（真没装）和「装了但报错」。

## 换机完整流程

```
1. 官方安装器装 DSH 本体                       ← 阶段一，本技能不管
2. 拷工作区目录和 ~/.dsh\ 过来（含 profiles/desktop/node_modules）
3. bootstrap.ps1 -Check        看缺什么
4. bootstrap.ps1 -Apply        装齐能装的 + 补 PATH 缺项 + 修 G2
5. verify.mjs                  确认十八类（重点看 G2 和 P：G2 能修但要有源，P 只查）
6. 重启 DSH（用生成的启动器）
```

⚠️ **第 2 步别漏 `profiles/desktop/node_modules`** —— 那 5 个 `@deepseek-ai` 手工包和本地插件（作者机清单里 4 个）
都不在 `dependencies` 里，`pnpm install` 补不回来。漏了就是三个预设全挂。

## 为什么引导层用 PowerShell 而不是 Node

**鸡生蛋**：新机器没有 Node，Node 脚本跑不起来。
PowerShell 5.1 是 Windows 10/11 自带的，所以引导层必须是它。
装完 Node 之后，详细检查才交给 `verify.mjs`（中文报告、JSON 处理都方便得多）。

## 怎么退

脚本会写四类持久化改动，都能撤：

| 改动 | 怎么撤 |
|---|---|
| 用户 PATH | 每次 `-Apply` 前备份到 `~/.dsh/path-backup-*.txt`，覆盖回去即可 |
| `HKCU\...\Run\DSH` | `Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name DSH` |
| 计划任务 `DSH-DialogArchive` | `Unregister-ScheduledTask -TaskName DSH-DialogArchive -Confirm:$false` |
| G2 修复产物 | `profiles\desktop\node_modules` 下新建的 junction / 拷贝的包删掉即可；脚本只补缺，已有的一律跳过 |

PATH 备份失败时脚本会**拒绝改动**（fail-closed），不会出现「以为备份了其实没有」。

## 第二轮验证补的坑（18-24）

18. **`-Encoding UTF8` 写的 .vbs 被 wscript 拒绝** —— PS 5.1 会写 BOM，而 WSH 只认 ANSI 或 UTF-16LE。实测 UTF8BOM 报「Microsoft VBScript 编译错误: 无效字符」，必须用 `-Encoding Unicode`。
19. **`fs.accessSync(W_OK)` 在 Windows 上不查 ACL** —— 它只读只读属性位，`C:/Program Files/WindowsApps` 也返回 WRITABLE。判断可写必须实际写一个临时文件再删。
20. **`Get-ExecutionPolicy` 在带 `-ExecutionPolicy Bypass` 的进程里永远返回 Bypass** —— Process 作用域优先级最高，这条检查会永远通过。要读注册表里的持久化值。
21. **junction 不是硬要求** —— `compaction.js` 只要求「能解析到 + compactNow 是函数」，同版本目录拷贝也能跑。真正的判据是**版本与宿主一致**。
22. **profile 目录名必须匹配 `^[a-zA-Z0-9_-]{1,80}$`** —— 叫「工作」之类部分插件加载即 throw。
23. **win-bash 自带 16 MB MSYS payload** —— 挂载前校验 `checksums.sha256`，不一致直接拒绝挂载。它是工作区主力 shell，挂了是断手断脚。缓存目录 `~/.dsh/win-bash` 必须可写。
24. **bridge-next 用包内自带的 uv**（`@dataiku/uv-win32-x64`），系统 PATH 有没有不是关键。

## 参数速查（2026-11-19 补）

### bootstrap.ps1

| 参数 | 干什么 |
|---|---|
| `-Check` | 只探测，不改任何东西（默认） |
| `-Apply` | 装缺失的 + 配 PATH（隐含 `-RepairG2`） |
| `-RepairG2` | 只修插件加载前置：5 个手工包 / junction / 本地插件按清单（作者机 4 个）/ 凭据模板 |
| `-WithProxy` | 额外生成代理启动器 + 开机自启（需配 `-Apply`） |
| `-WithScheduledTasks` | 额外注册对话存档计划任务 |
| `-DedupPath` | 真去重用户 PATH（之前只报告不去重，现在是真做） |
| `-ExportInventory` | 导出换机清单（winget export + 两套 pip + npm）到 `~/.dsh/inventory-*.json` |
| `-Profile Core\|Dsh` | 模块档：Core 跳过 DSH 段（0/G/G2/H/L），Dsh 全跑。默认自动探测 |
| `-Workspace <路径>` | 指定工作区，优先级：参数 > `DSH_WORKSPACE` > manifest > 默认 |

退出码：`0` 全过 / `1` 有硬缺口 / `2` 仅提醒（与 `verify.mjs` 一致）。

### verify.mjs

| 参数 | 干什么 |
|---|---|
| （无） | 18 类全跑，约 12~15 秒（视 M 段负载） |
| `--only=A,G2` | 只跑指定段（点名即跑，不受模块过滤影响） |
| `--profile=core\|dsh` | 模块档：core 通用换机内核 / dsh 含 DSH 专属段。默认自动探测，见 README「两种用法」 |
| `--no-selfcheck` | 跳过 M 段（dsh-selfcheck 数秒，负载高时 ~9 秒），降到约 5~8 秒 |

退出码：`0` 全过 / `1` 有硬缺口 / `2` 仅提醒 / `64` 未知段名。

### 耗时构成（本机实测）

```
17 段并行        5~8s
M 段 selfcheck   数秒（高负载 ~9s）   <- 大头，是 dsh-selfcheck 自己的成本
全量            12~15s
```

## 测试与 CI

```bash
cd .agents/skills/dsh-env-bootstrap
node --test "tests/**/*.test.mjs"     # 133 个 node 契约测试
powershell -Command "Import-Module Pester -MinimumVersion 5.0; Invoke-Pester -Path tests-ps"   # 30 个 Pester（bootstrap 函数直测 + 幂等收敛 + tweaks 探针）
powershell -File scripts/smoke.ps1    # 一键冒烟
```

⚠️ **Node 22+ 把 `--test` 的位置参数当 glob**，写 `node --test tests/` 会报
`Could not find 'tests'`，必须用 `node --test "tests/**/*.test.mjs"`。

133 个 node 测试 + 30 个 Pester 每个都钉住一个真实发生过的 bug（`-split` 标量陷阱、VBS 编码、
执行策略空值、Store python 桩、版本号浮点解析、manifest 与 checks 同序、退出码契约、幂等收敛）。
Pester 走 PS parser 抽函数直测，不跑脚本主体；测试文件必须带 UTF-8 BOM（锚点钉着）。

## 首次使用：指定工作区

公开仓库里**不写死任何人的工作区路径**。第一次跑之前，用下面任一方式告诉它工作区在哪：

```powershell
# 方式一：环境变量（推荐，一次设好）
[Environment]::SetEnvironmentVariable('DSH_WORKSPACE', 'D:\你的工作区', 'User')

# 方式二：每次传参
.\scripts\bootstrap.ps1 -Check -Workspace 'D:\你的工作区'
```

优先级：`-Workspace` 参数 > `DSH_WORKSPACE` 环境变量 > `config/manifest.json` 的 `workspace.default`。

没设的话 H 段会报「工作区不存在」——这是提示，不是 bug。

## MCP：让 agent 自己发现工具

`scripts/mcp/server.mjs` 是个 stdio MCP server，**只读**，不安装、不改 PATH。

| 工具 | 作用 |
|---|---|
| `env_status` | 全量体检结果（等价 `verify.mjs --json`），18 段逐条状态 |
| `tool_discover` | 按 capability 查工具，如 `media:probe` → ffprobe，含消费方与缺失后果 |
| `tool_resolve` | 工具名 → 绝对路径 + 版本 + 是否在 PATH + 安装提示 |

注册（profile 的 `cordis.patch.yml`）：

```yaml
- id: mcp
  config:
    servers:
      dsh-env-bootstrap:
        transport: stdio
        command: node
        args: ['<workspace>/.agents/skills/dsh-env-bootstrap/scripts/mcp/server.mjs']
```

或直接命令行验证：

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node scripts/mcp/server.mjs
```

## 十八类（含 00 人工前置）

`00` 段是新加的：**阶段一四件事脚本从不做，但缺了新电脑就跑不起来**。
它会明确告诉你还差哪几步、每步怎么做，而不是让你从十几条警告里自己推断。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_WORKSPACE` | 工作区路径（bootstrap 与 verify 都认） |
| `DSH_HOME` | `~/.dsh` 的替代路径（换用户名 / 裸机模拟用） |

都没设时回落到 `manifest.workspace.default` 和 `os.homedir()/.dsh`。
