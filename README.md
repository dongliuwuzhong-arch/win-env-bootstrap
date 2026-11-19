# dsh-env-bootstrap

**换机第二阶段：公开工具装齐 + 十八类自检。**

> 🔧 **要维护或修改它** → 读 [MAINTAINING.md](MAINTAINING.md)（文件地图、三条铁律、踩过的坑、还没做的事）。

DSH（DeepSeek Harness）桌面端的**环境补齐与自检**技能。能自动装的那部分用 winget / pip 装上，
PATH 缺项自动补，其余只出报告。十八类检查，最后出中文报告。

> Second stage of a DSH setup on Windows: install the public tools, add missing PATH entries,
> run 17 categories of checks, print a Chinese report. It does not install DSH itself.

## 两阶段：谁负责哪一段

| 阶段 | 谁做 | 内容 |
|---|---|---|
| **一（前提）** | 人 + 官方安装器 | 装 DSH 本体；拷工作区目录和 `~/.dsh\`（含 `profiles\desktop\node_modules`）；填 `.credentials.yaml` |
| **二（本技能）** | `bootstrap.ps1` + `verify.mjs` | 装齐公开工具、补 PATH 缺项、修 G2 加载前置、跑 17 类自检出中文报告 |

阶段一没做完，阶段二只能报一堆红——它不代替阶段一。

## 它解决什么问题

换电脑最耗时的从来不是装本体，是把周围那一圈补齐：

- Node 版本不对（DSH 要 24+）
- Python 没装，或者装了但缺包
- 7-Zip 装了**但不在 PATH**（最经典的坑）
- PowerShell 5.1 读中文路径乱码
- curl 其实是 Invoke-WebRequest 的别名
- 加速器把系统代理抢走，设了也白设
- **profile 里那几个手工放的包，pnpm install 补不回来**

这些每台机器都要重新踩一遍。这个技能把它们固化成两个脚本。

## 它不解决什么

- **不装 DSH 本体**。官方安装器的事，装完再跑这个。
- **不建 `~/.dsh` 目录树**。profile、插件都是拷过来的，缺了脚本只报红；唯一往里写的是
  已存在目录里的 `.credentials.yaml` 注释模板。
- **不拷工作区目录和 `profiles\desktop\node_modules`**。手工搬，漏了就是三个预设全挂。
- **不填 `.credentials.yaml`**。缺文件时写一份**只有注释、没有任何值**的模板，key 得自己填。
- **G2 修不了没有源的东西**。手工包要从宿主 `node_modules` 拷，本地插件要从 `~/.dsh/plugins` 拷；
  源不在就只报红。win-bash payload 只给指引，soul schema 只读不动数据。
- **有些缺项只报告**：N/O/P 三段、PATH 重复项、curl.exe / winget 本体、
  拿不到源的 G2 修复件。其余缺项 `-Apply` 会自动装（见下面「十八类检查」表）。
- **PATH 只补不删**。重复项只报告，去重手工。
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

# 2. 装缺失的 + 配 PATH
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply

# 3. 再加代理启动器 + 开机自启（可选）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply -WithProxy

# 4. 再加对话存档计划任务（可选）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply -WithScheduledTasks
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
| A 核心运行时 | Node 24+ / Python 3.12+ / Git / curl.exe / winget / pnpm | winget 装 Node、Python、Git；pnpm 先认 DSH 自带那份，没有才 `npm i -g`；curl.exe / winget 只提示 |
| B 归档工具 | 7-Zip + 是否在 PATH（User 和 Machine 都查） | winget 装；装了但不在 PATH 就追加（先备份，备份失败不动） |
| C 媒体工具 | ffmpeg / ffprobe / yt-dlp / ImageMagick | ffmpeg、yt-dlp、ImageMagick 走 winget；ffprobe 随 ffmpeg 装，缺了提示重装 Gyan.FFmpeg |
| D 浏览器自动化 | Chrome / puppeteer | Chrome 走 winget；puppeteer 在 `_tools\browser` 里自动 `npm i`（工作区没这目录才只提示） |
| E 逆向工具（可选） | frida | 缺了走 pip 装 frida + frida-tools，装完复测 |
| F Python 包 | 系统包 + wechat 取证包 + DSH 自带 python 核心包（清单来自 `manifest.pythonPackages`） | 全部缺了就走 pip 装（两套解释器分开装） |
| G DSH 本体 | 宿主 exe / 解包树 / .dsh / profile bundles / 凭据内容 / CLI shim | **只检查**——官方安装器的事 |
| G2 插件加载前置 | junction / 手工包 / 本地插件 / node:sqlite / 宿主可写 / profile 名 / win-bash / uv / Steam / PS 5.1 | **会修**（`-RepairG2`，`-Apply` 隐含）：拷 5 个手工包（`dsh-compaction-basic` 建 junction）、拷 4 个本地插件、缺凭据写注释模板；win-bash payload、soul schema、宿主缺失只提示 |
| H 工作区 | 七个目录 / 人格四件套 / 技能库 / pyb-pys 硬编码 | 缺目录 `-Apply` 自动建；人格、技能库只检查 |
| I 系统配置 | PATH 重复 / 执行策略生效值 / 计划任务动作 / 代码页 | 执行策略 Restricted\|AllSigned 自动改；**PATH 重复项只报告，不去重**；计划任务只在 `-WithScheduledTasks` 时注册 |
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
以及 G2 修复（`-RepairG2`）：`dsh-compaction-basic` 建 junction、4 个手工包 + 4 个本地插件拷贝、
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
3. **~/.dsh/plugins/ 的 4 个本地插件是拷贝不是符号链接**。只拷 ~/.dsh/ 不带 node_modules 时四个全缺。
4. **会改宿主文件的插件要能写宿主安装目录**。装在 Program Files 且非管理员时，补丁一条都落不下去。
5. **用 SQLite 的插件有 schema 版本硬门**。库里 user_version 高于插件支持的值会直接 throw。

## 踩过的坑

24 条实测撞出来的坑，全在 [SKILL.md](SKILL.md) 里。最狠的两条：

- **`-split` 只返回一条时是 String 不是数组** —— `($parts + $dir)` 做字符串拼接，整条 PATH 糊成 `C:\AAAC:\BBB`，且每跑一次更烂。
- **`Set-Content -Encoding ASCII` 写中文变 `?`** —— VBS 路径含中文就静默失效，开机自启坏得无声无息。

## 怎么退

| 改动 | 怎么撤 |
|---|---|
| 用户 PATH | 每次 `-Apply` 前备份到 `~/.dsh/path-backup-*.txt`，覆盖回去即可 |
| `HKCU\...\Run\DSH` | `Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name DSH` |
| 计划任务 `DSH-DialogArchive` | `Unregister-ScheduledTask -TaskName DSH-DialogArchive -Confirm:$false` |
| G2 修复产物 | `profiles\desktop\node_modules` 下新建的 junction / 拷贝的包删掉即可；脚本只补缺，已有的一律跳过 |

## 作为 DSH 技能安装

把整个目录放到工作区的技能库，DSH 会自动识别 SKILL.md 的 frontmatter 并注册：

```
<workspace>\.agents\skills\dsh-env-bootstrap\
```

之后说「装环境」「换电脑」「bootstrap」就能触发。

## License

MIT

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
