# 维护交接 · dsh-env-bootstrap

> 给下一个接手这个技能的会话看。**改任何东西之前先读这一份。**
> 不是介绍功能（那在 `SKILL.md`），是「这个技能怎么被维护」——哪些地方一碰就坏、怎么验证你没改坏、哪些坑已经踩过。
>
> **维护约定：缺陷清单随每轮修复同步更新。改了代码不改这份表，它就重新变成骗人的东西。**

## 现在到哪了

| 项 | 值 |
|---|---|
| 仓库 | `dongliuwuzhong-arch/dsh-env-bootstrap`（PUBLIC） |
| HEAD | 见 `git log -1`（提交史都在本仓）；历轮处置与审查报告见 `docs/` |
| 规模 | 53 个文件 / 4339 行代码 / 108 条测试（2026-11-19 实测） |
| 定位 | **换机第二阶段**。阶段一（装本体、拷 `~/.dsh`、拷工作区、填凭据）人工完成 |
| 基线状态 | `verify` 硬缺口 0 / 提醒 6；`smoke.ps1` PASS；108/108 测试 |
| 仓库形态 | 目录自带 `.git`（远端 `dongliuwuzhong-arch/dsh-env-bootstrap`）。外面的 `C:\DSH空间` 大仓是白名单式 .gitignore，**不追踪本目录**（2026-11-19 显式写进它的配置）。本机 push 已配 `http.proxy=127.0.0.1:7897`，裸 `git push` 即可 |
| 说明文档 | README.md（中文）/ README.en.md（英文）逐节镜像；维护史在 `docs/维护日志.md` |

⚠️ **别把它当成「新电脑一键配齐」**。文档已经诚实改口，但它离那个目标还差三件事（见文末「没做的」）。

## 改之前必读的三条

### 1. `bootstrap.ps1` 必须保持纯 ASCII，且不能加 BOM

PS 5.1 读无 BOM 的 UTF-8 会按 ANSI 解，中文注释直接变乱码。乱码里一旦带上全角括号或引号，`try/catch` 的解析就坏了，报的错是 `Unexpected token '}'` 但指向的行号看起来完全正常。

```bash
# 改完必查
node -e "const s=require('fs').readFileSync('scripts/bootstrap.ps1','utf8');console.log('非ASCII:',[...s].filter(c=>c.charCodeAt(0)>127).length)"
# 必须是 0
```

需要中文路径时用码点拼：`[char]0x7A7A + [char]0x95F4`。

### 2. 判据不能只写着不改，也不能「看着对」就算过

这个项目历史上最贵的几次返工，全是**判据本身写错**，而不是代码没写：

- `[string]::IsNullOrEmpty` 在执行策略那里失效 → 空值被当有效值，`bad` 分支永远走不到（**漏报**，比误报更糟）
- `$null -ne 'Undefined'` 恒为真 → 同上
- `/wscript.exes+/` 要求 exe 后面至少一个 s → 永不匹配，那条检查等于没写
- `gapsLeft` 无条件递减 → 任何 fix 都能吃掉不相关的硬缺口，退出码虚低
- `nslookup` 对不存在的域名也输出 `Address:`（那是 DNS 服务器地址）→ 判据永远为真

**规律**：`.test()` / `-eq` / `-ne` 这类断言，写完后必须构造一个**会失败的输入**跑一遍。跑不红，就是判据坏了。

### 3. 改动必须走「改 → 三验 → 推」

```bash
cd C:/DSH空间/.agents/skills/dsh-env-bootstrap

# 三验
node --test "tests/**/*.test.mjs"                    # 108 条，必须全过
node scripts/verify.mjs                              # 硬缺口必须 0
powershell -File scripts/smoke.ps1                   # PASS
```

任何一项不过，就不许推。`smoke.ps1` 自己会跑前两项再加语法检查。

```bash
# 推：本机 github.com 直连不通，仓库本地 config 已配 http.proxy=127.0.0.1:7897
git add -A && git commit -m "..." && git push
# 推完看一眼 CI（绿了才算落地）：
# https://github.com/dongliuwuzhong-arch/dsh-env-bootstrap/actions
```

## 文件地图

```
config/manifest.json     单一配置源：18 段类别 / 17 个工具 / G2 清单 / python 包 / POSIX 映射 / 人工前置
                         ↑ 改检查项、加工具、改 winget ID 都优先改这里

scripts/bootstrap.ps1    引导层（PS 5.1，纯 ASCII）
                         -Check 只读 / -Apply 装+修 / -RepairG2 只修插件前置
                         -DedupPath 真去重 PATH / -Workspace 指定工作区

scripts/verify.mjs       装载器：按 manifest 顺序跑 checks、排版、定退出码
                         --only=A,G2 / --no-selfcheck / --json

scripts/lib/
  report.js              结果对象 + 计数 + 退出码契约
  run.js                 execFileSync 封装（ENOENT / 非零退出 / 超时语义）
  paths.js               manifest 读取 / WS / DSH_HOME / resolveDshRoot / createContext
  winsys.js              合并的 PowerShell 快照（-EncodedCommand + JSON，全量只起 1 次）

scripts/checks/*.js      18 个检查段，各 export { id, title, check(ctx) -> Result[] }
                         00 人工前置 / A 运行时 / B 归档 / C 媒体 / D 浏览器 / E 逆向
                         F Python包 / G DSH本体 / G2 插件前置 / H 工作区 / I 系统配置
                         J 网络 / K 自启 / L 脚本可跑性 / M 总检 / N 技能级依赖
                         O 系统环境 / P 完整性与迁移

scripts/mcp/server.mjs   MCP 只读三件套：env_status / tool_discover / tool_resolve
scripts/smoke.ps1        一键冒烟（语法 + 测试 + 快段 + bootstrap 退出码）
tests/*.mjs              108 条契约测试，每条钉住一个真实发生过的 bug
.github/workflows/ci.yml windows-latest，不含任何 -Apply
docs/                    审查报告归档（两份）+ 维护日志（倒序，新条目加最上）
LICENSE / .gitignore     MIT / 备份与临时件忽略
README.md / README.en.md 中文 / 英文说明，逐节镜像，改一份必须改另一份
```

## 常用命令

```bash
S=C:/DSH空间/.agents/skills/dsh-env-bootstrap

# 体检（人类可读）
node $S/scripts/verify.mjs
# 体检（机器可读，MCP 与自动化用）
node $S/scripts/verify.mjs --json
# 只跑某几段
node $S/scripts/verify.mjs --only=A,G2,00
# 快速模式（跳过 M 段 selfcheck，约 8~9 秒）
node $S/scripts/verify.mjs --no-selfcheck

# 引导层
powershell -File $S/scripts/bootstrap.ps1 -Check
powershell -File $S/scripts/bootstrap.ps1 -Apply
powershell -File $S/scripts/bootstrap.ps1 -Apply -RepairG2

# 测试
cd $S && node --test "tests/**/*.test.mjs"
```

⚠️ **`node --test tests/` 不成立**。Node 22+ 把位置参数当 glob，会报 `Could not find 'tests'`。必须写 `node --test "tests/**/*.test.mjs"`。

## 环境变量

| 变量 | 作用 | 没设时 |
|---|---|---|
| `DSH_WORKSPACE` | 工作区路径（bootstrap 与 verify 都认） | 回落到 `manifest.workspace.default` |
| `DSH_HOME` | `~/.dsh` 的替代路径 | 回落到 `os.homedir()/.dsh` |

这两个是**裸机模拟的钥匙**——不设它们就没法在一台已配好的机器上测「新电脑会怎样」。

## 加一个新检查项

1. `config/manifest.json` 的 `categories` 加一行（**顺序就是报告顺序**）
2. `scripts/checks/` 新建文件，`export const id` 必须和 manifest 里那个 id 一致
3. `scripts/verify.mjs` 顶部 import + 加进 `CHECKS` 数组
4. `tests/manifest-schema.test.mjs` 的 `EXPECTED_IDS` 和 `CHECKS` 同步（否则一致性测试会挂——这是故意的）
5. 跑三验

**完成判据**：`node --test` 全过，且 `verify --only=<你的新段>` 能单独跑出结果。

## 加一个新工具

1. `manifest.tools` 加一条，至少要有 `name` / `optional` / `probeCmd` / `probeArgs`
2. 补 `consumer`（谁用它）/ `capability`（能干什么）/ `degradedBehavior`（缺了会怎样）—— 这三个字段是给 agent 判断轻重用的，别省
3. 有 winget 就写 `winget`，有 pip 写 `pip`，npm 包写 `npm` + `npmDir`
4. 在 `bootstrap.ps1` 对应段加 `Install-Pkg (Get-WingetId '<name>' '<fallback>') '<Label>' $optional '<probeCmd>' '<probeArgs>'`
5. 在对应 `checks/*.js` 加检测（**只装不查等于没装**）

**完成判据**：`verify` 能在工具缺失时报出来，且报的内容带安装命令。

## 踩过的坑（按代价排序）

### `-split` 单条时返回 String 不是数组

```powershell
$parts = $p -split ';' | Where-Object { $_ }   # PATH 只有一个条目时返回 String
($parts + $dir) -join ';'                       # 变成字符串拼接 → C:\AAAC:\BBB
```
必须 `@($parts)` 包一层。这个坑毁过一次 PATH，而且每跑一次更烂。

### `-Encoding UTF8` 写的 vbs 被 wscript 拒绝

PS 5.1 的 `-Encoding UTF8` 会写 BOM，wscript 报 `无效字符`。正确是 `-Encoding Unicode`（UTF-16LE）。验证：`FF FE` 开头 + `cscript exit=0`。

### `winget install` 会挂死

无人值守时必须加 `--disable-interactivity`，否则交互提示会等输入。退出码也不能信——装完要实测命令能不能解析到。

### `fs.accessSync(W_OK)` 在 Windows 上不查 ACL

它只看只读属性位，`C:/Program Files/WindowsApps` 也返回 WRITABLE。判可写必须**真写一个临时文件再删**，并且用 `finally` 保证清理。

### `powershell -Command` 的输出的编码

用 `-Command` 读含中文的路径，输出会按 OEM 码页（CP936）吐成乱码，Node 侧判成「文件不存在」。要么显式 UTF-8，要么走 `-EncodedCommand` + JSON（`lib/winsys.js` 就是这么做的）。

### 中文注释只在 vite-only 场景安全

`checks/*.js` 里可以有中文（Node 读 UTF-8 没问题）；`bootstrap.ps1` 里**一个都不能有**（见开头第 1 条）。

### import 名 ≠ pip 分发名

wechat-history 的 check-env.py 用 `importlib.util.find_spec` 查 **import 名**（Cryptodome、pysilk），
但 `pip list` 打印的是**分发名**（pycryptodomex、silk-python）。拿 import 名去匹配 pip list，
**装满了也永远报缺**——判据恒假，比误报更难发现。映射以
`importlib.metadata.packages_distributions()` 为准；manifest 的 pythonPackages 一律存分发名，
`importName` 字段只作注释，不参与匹配。

### 工作区解析是双实现，改一处必须改两处

`bootstrap.ps1` 顶部的解析块和 `scripts/lib/paths.js` 的 `resolveWorkspace()` 必须同顺序、
同兜底（参数 > 环境变量 > manifest.default > 内置 C:\DSH空间）。2026-11-19 审查前两边各写各的，
同一台机器结论相反。回归锚点在 `tests/workspace-resolution.test.mjs`。

## 已知缺陷 / 没做的

2026-11-19 两轮审查的严重项（puppeteer 死代码 / frida 等不装 / 工作区解析不一致 / MCP 三处 / CI 退出码泄漏）**都已修**，逐项处置见 `docs/` 下两份审查报告，回归锚点在 `tests/`。下表只记**仍然没做**的。

| 项 | 状态 |
|---|---|
| MCP `tool_run` / `env_repair`（写操作） | **没做**。写操作 MCP = 任意命令执行面，要先想清白名单和审计 |
| 真·裸机全流程验证 | **没做过**。所有验证都是在已配好的机器上跑的 |
| 非标准安装路径（D 盘等） | 代码已走 `ctx.DSH_ROOT`，但**没在那样的机器上实测过** |
| 非管理员会话 | winget 机器级安装的提权提示**没实测** |
| Windows 10 / ARM64 / 离线 | 未覆盖，文档里也没声明不支持 |
| `G2` 修复源 | 源是宿主 `resources\app\dsh\node_modules` 与 `~/.dsh/plugins`，两者都得先从旧机带过来。真·新机两处皆空时修不了，得改成从 npm 拉（`npm pack @deepseek-ai/dsh-compaction-basic`） |
| CI 实跑 | **跑过且修过**。2026-11-19 发现 Actions 12 次全红：GH 的 pwsh 包装器在步骤末尾 `exit $LASTEXITCODE`，把 bootstrap -Check 的合法退出码 1 漏给步骤，断言通过也判红。已修（断言后显式 `exit 0` 封尾，锚点在 `tests/ci-wrapper.test.mjs`）。实况以 Actions 页为准 |
| verify / MCP 长耗时段无进度（M 段最长 240s） | **没做**（审查建议 #11）。要做得上流式逐段输出 |
| `-DryRun` 计划预览 | **没做**（审查建议 #12） |
| MCP `notifications/cancelled` / SIGTERM 优雅退出 | **没做**（审查建议 #13 剩余部分；`isError` 已补） |
| 00 段与 H 段工作区口径有重叠 | **不合并**（审查建议 #14）。00 查「前置到位」、H 查「内容完整」，各有用途 |
| winget -1978335212 降级为 ok | **不做**（审查建议 #15）。该分支只在「winget 说装了但命令解析不到」时走到——那是真缺口（多半是 PATH），降级成 ok 就是漏报。只把文案改准了 |

## 怎么确认你没改坏

```bash
cd C:/DSH空间/.agents/skills/dsh-env-bootstrap

# 1. 三验
node --test "tests/**/*.test.mjs" && node scripts/verify.mjs && powershell -File scripts/smoke.ps1

# 2. 裸机模拟（必须有这两个环境变量才做得成）
mkdir -p /c/Windows/Temp/bare/ws /c/Windows/Temp/bare/home
DSH_HOME='C:\Windows\Temp\bare\home' DSH_WORKSPACE='C:\Windows\Temp\bare\ws' \
  node scripts/verify.mjs --only=00       # 应该报 3-4 项人工前置缺失

# 3. 确认没有回退成硬编码
grep -rn 'C:\\\\Software\\\\DSH' scripts/checks/    # 应该 0 处
node -e "const s=require('fs').readFileSync('scripts/bootstrap.ps1','utf8');console.log('非ASCII:',[...s].filter(c=>c.charCodeAt(0)>127).length)"
