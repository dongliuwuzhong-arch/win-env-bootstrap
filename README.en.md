# dsh-env-bootstrap

**Stage 2 of a DSH machine migration: install the public toolchain + an 18-section self-check.**

> English · [中文](README.md)
> 🔧 **Maintaining or modifying this?** Read [MAINTAINING.md](MAINTAINING.md) — file map, three hard rules, past traps, known gaps.

An **environment completion & self-check** skill for the DSH (DeepSeek Harness) desktop app on Windows.
Whatever can be auto-installed is installed via winget / pip; missing PATH entries are appended;
everything else is report-only. 18 check sections, final report in Chinese.

## Two stages: who does what

| Stage | Who | What |
|---|---|---|
| **One (prerequisite)** | Human + official installer | Install the DSH host; copy the workspace and `~/.dsh\` (including `profiles\desktop\node_modules`); fill in `.credentials.yaml` |
| **Two (this skill)** | `bootstrap.ps1` + `verify.mjs` | Install the public toolchain, append missing PATH entries, repair G2 plugin load prerequisites, run the 18-section self-check |

Without stage one, stage two just prints red lines — it does not replace stage one.

## The problem it solves

Migrating machines is never about installing the app itself. It is the ring of public tools around it:

- Wrong Node version (DSH needs 24+)
- Python missing, or installed without its packages
- 7-Zip installed **but not on PATH** (the classic trap)
- PowerShell 5.1 mangling CJK paths
- `curl` actually being an alias of Invoke-WebRequest
- A VPN/accelerator silently stealing the system proxy
- **The five hand-placed packages under the profile that `pnpm install` never restores**

Every machine steps on these again. This skill freezes the fixes into two scripts.

## What it does NOT do

- **It does not install the DSH app itself.** That is the official installer's job; run this afterwards.
- **It does not create the `~/.dsh` tree.** Profiles and plugins are copied over; missing things are reported red. The only write is a comment-only `.credentials.yaml` template inside an existing directory.
- **It does not copy the workspace or `profiles\desktop\node_modules`.** Move those by hand.
- **It does not fill `.credentials.yaml`.** When missing, it writes a **comments-only** template; you fill in the keys.
- **G2 cannot repair what has no source.** Hand-placed packages are copied from the host `node_modules`, local plugins from `~/.dsh/plugins`; no source, red report only. The win-bash payload is guidance only; soul schemas are read-only.
- **Some gaps are report-only**: the G DSH-host section, ffprobe (ships with ffmpeg; missing = reinstall hint), curl.exe / winget itself, the N/O/P sections, G2 repair items without a source. Everything else `-Apply` installs (see the table below).
- **PATH entries are only appended, never pruned; duplicates are auto-deduped** (`-Apply` / `-DedupPath`, backed up to path-dedup-*.txt first).
- **Host data is untouched** (`~/.dsh/storages`, `~/.dsh/sessions`).
- **System proxy is never changed.** Only per-app proxy launchers are offered.
- **MSYS-missing which/df/du are not installed.** Use the substitute commands.

## Why the bootstrap layer is PowerShell

**Chicken-and-egg**: a fresh machine has no Node, so Node scripts cannot run.

PowerShell 5.1 ships with Windows 10/11, so the bootstrap layer must be it. Once Node is installed,
the detailed checks hand over to verify.mjs.

## Quick start

Probe first (read-only), then decide what to install:

```powershell
# 1. probe only, changes nothing
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Check

# 1.5 change preview (optional): -DryRun walks the -Apply logic, every write prints "plan:" only
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -DryRun

# 2. install what is missing + fix PATH
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply

# 3. plus proxy launcher + autostart (optional)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply -WithProxy

# 4. plus the dialog-archive scheduled task (optional)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -Apply -WithScheduledTasks

# 5. system tweaks (optional, opt-in per item, fully revertible - see below)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -List

# 6. export a migration inventory (winget + both pips + npm -> ~/.dsh/inventory-*.json)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -ExportInventory
```

After Node is in place, run the detailed self-check:

```bash
node scripts/verify.mjs
```

Exit codes: 0 all pass / 1 hard gaps / 2 runs fine but with warnings.

## The 18 check sections

`config/manifest.json`'s `categories` is the single source of truth; this table mirrors the one in [SKILL.md](SKILL.md) line by line. The "when missing" column describes what the scripts actually do.

| Section | What it checks | When missing |
|---|---|---|
| 00 Manual prerequisites (stage one) | install DSH host / copy `~/.dsh` / copy workspace / fill credentials / set DSH_WORKSPACE | Report + guidance only — stage one is human work, the scripts never do it |
| A Core runtimes | Node 24+ / Python 3.12+ / Git / curl.exe / winget / pnpm | winget installs Node, Python, Git; pnpm prefers the DSH-bundled one, then `npm i -g`; curl.exe / winget report only |
| B Archive tools | 7-Zip + PATH presence (User and Machine) | winget install; appends to PATH when installed but not on PATH (backup first, never moves if backup fails) |
| C Media tools | ffmpeg / ffprobe / yt-dlp / ImageMagick | winget for ffmpeg, yt-dlp, ImageMagick (invoke as `magick` — `convert` collides with a system tool); ffprobe ships with ffmpeg, reinstall Gyan.FFmpeg if it is missing |
| D Browser automation | Chrome / puppeteer | Chrome via winget; puppeteer auto `npm i` inside `_tools\browser` (report-only when the directory is missing) |
| E Reverse engineering (optional) | frida | pip-installs frida + frida-tools when missing, then re-probes |
| F Python packages | system packages + wechat-forensics packages + DSH-bundled python core (lists come from `manifest.pythonPackages`) | pip-installs whatever is missing (two interpreters handled separately) |
| G DSH host | host exe / unpacked tree / .dsh / profile bundles / credentials content / CLI shim | **Report only** — the official installer's job |
| G2 Plugin load prerequisites | junction / hand-placed packages / local plugins / node:sqlite / host writability / profile name / win-bash / uv / Steam / PS 5.1 | **Repairs** (`-RepairG2`, implied by `-Apply`): copies the 5 hand-placed packages (`dsh-compaction-basic` becomes a junction), copies local plugins per the manifest's `g2.localPlugins` list (4 on the author's machine; empty by default in the public repo), writes a comment-only credentials template; win-bash payload, soul schema and missing host are report-only |
| H Workspace | seven directories / persona set / skill library / pyb-pys hardcoding | `-Apply` creates missing directories; persona and skill library report-only |
| I System config | duplicate PATH / effective execution policy / scheduled task actions / code page | Execution policy Restricted\|AllSigned auto-fixed to CurrentUser RemoteSigned; duplicate PATH entries auto-deduped (`-Apply`/`-DedupPath`, backed up to path-dedup-*.txt first); tasks registered only with `-WithScheduledTasks`; code page report-only |
| J Network | local proxy port 7897 | Report only |
| K Proxy & autostart | launcher vbs / Run key | Generated with `-WithProxy` |
| L Script runnability | check-paths / check-skills / persona-lint / check-persona-context | Reports which one broke |
| M Final check | runs `dsh-selfcheck`, judges by exit code not wording | Report only |
| N Skill-level optional deps | exiftool / dotnet / youtube-transcript node_modules / osint deps / playwright / agent-reach / ChatTrace / TTS endpoint | All info-level, never blocking, never installed |
| O System environment | Defender / w32time / CJK fonts / LongPaths / disk headroom | Report only |
| P Integrity & migration | ports / single instance / root CA / workspace ACL / DSH_WE_DATA_DIR / AGENTS.md / autostart vbs | Report only |

## What really gets installed

`bootstrap.ps1 -Apply` really installs: Node, Python, Git (optional), pnpm (`npm -g`), 7-Zip (+PATH),
ffmpeg, yt-dlp, ImageMagick, Chrome, rg, jq, exiftool, dotnet (winget); puppeteer (`npm i` in the workspace);
pip packages for both interpreters (system python: pillow/pyyaml/frida/frida-tools/wechat-forensics packages;
DSH-bundled python: numpy/pandas/openpyxl/pillow/lxml — the manifest's `pythonPackages` is the authority).

Single-point auto-fixes: missing PATH entries (backup first), execution policy Restricted/AllSigned → CurrentUser RemoteSigned,
`-WithProxy` writes the launcher + Run key, `-WithScheduledTasks` registers the task,
and G2 repair (`-RepairG2`): junction for `dsh-compaction-basic`, copies of 4 hand-placed packages + 4 local plugins,
comment-only credentials template. **Only gaps are filled; anything already present is skipped.**

Everything else is report-only. `verify.mjs` never changes a byte of the system — it writes one temporary probe file to test writability, then deletes it.

## The migration traps (the G2 section exists for these)

These are not "missing features" — they **throw at load time** and DSH starts with all three presets broken.
verify.mjs checks this section read-only; bootstrap.ps1's G2 section repairs it (`-RepairG2`, implied by `-Apply`).
**Repairs need the source files present**: the host `node_modules` and `~/.dsh/plugins` must have been copied over first.

1. **@deepseek-ai/dsh-compaction-basic must match the host version.** A mismatch can silently remove compactNow. A junction to the host is safest; a same-version copy also works — the script flags "version mismatch" red and records "not a junction" as info.
2. **The 5 packages under the profile's @deepseek-ai/ are hand-placed**, not in dependencies — `pnpm install` never restores them.
3. **Local plugins are copies, not symlinks** (list lives in manifest.g2.localPlugins — 4 on the author's machine, empty by default in the public repo). Copying `~/.dsh` without `node_modules` loses everything on that list.
4. **Plugins that patch host files need write access to the host install directory.** Under Program Files without admin, not a single patch lands.
5. **SQLite-backed plugins have a schema version hard gate.** A `user_version` above what the plugin supports throws outright.

## Past traps

24 machine-tested traps live in [SKILL.md](SKILL.md). The two nastiest:

- **`-split` returns a String, not an array, for a single entry** — `($parts + $dir)` becomes string concatenation and the whole PATH turns into `C:\AAAC:\BBB`, getting worse with every run.
- **`Set-Content -Encoding ASCII` turns CJK into `?`** — VBS paths with CJK silently break; the autostart dies without a sound.

## Two ways to use it

The tool is two-layered (`manifest.modules` is the single source of truth):

| Profile | Who | What | How to enable |
|---|---|---|---|
| **core migration kernel** | anyone rebuilding a Windows machine | public tool install/repair (A-F), PATH repair, Windows config checks (I/J/K/O), inventory export, tweaks, MCP resolve | auto: runs alone when no DSH is detected |
| **dsh pack** | DSH users | stage-one prerequisites (00), DSH host (G), plugin prereqs (G2), workspace/persona/skills (H), dsh-selfcheck (M), credentials | auto: joins in when a DSH install or ~/.dsh exists |

```powershell
# Explicit (overrides detection):
node scripts\verify.mjs --profile=core
powershell -File .\scripts\bootstrap.ps1 -Check -Profile Core
# or env: DSH_MODULES=core / core,dsh
```

DSH users see no change (all 18 segments by default). Non-DSH users no longer get
flooded by G/G2 red lines, and exit codes only count enabled segments. An explicit
`--only=` segment list always wins over module filtering.

## Supported environments

| Environment | Status |
|---|---|
| Windows 11 x64 + winget + online | ✅ tested (this machine + CI on windows-latest / windows-2022) |
| Windows 10 1809+ x64 | ⚠️ not tested (ConPTY build check backs it up), expected to work |
| ARM64 / offline / old Win10 SKUs without winget | ❌ untested. Without winget, auto-install degrades to install-manually hints |
| macOS / Linux | ❌ unsupported |

The bare-machine end-to-end checklist lives in [docs/裸机验证清单.md](docs/裸机验证清单.md) —
one archived real-machine run turns out-of-box readiness from a promise into evidence; until then
the honest label is semi-automatic migration assistant.

## System tweaks (optional)

Windows tuning beyond environment completion: **opt-in per item, fully revertible**. The catalog lives in `config/manifest.json` under `tweaks[]`.

| id | what | revert | rights |
|---|---|---|---|
| longpaths | LongPathsEnabled=1 (no Win32 path truncation) | set back to 0 | admin |
| power-highperf | activate the high-performance power plan | switch back to Balanced | normal |
| gamebar-off | turn off Game Bar background capture (HKCU) | set back to 1 | normal |
| defender-exclusions | add Defender exclusions for the workspace / DSH dirs | remove the exclusions | admin |
| hiberfil-off | disable hibernation, free hiberfil.sys | powercfg /hibernate on | admin |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -List          # probe only, changes nothing
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -Apply gamebar-off
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tweaks.ps1 -Revert gamebar-off
```

When the real state cannot be probed it reports `unknown` and never guesses (e.g. Defender taken over by third-party AV). Admin items stop with FAIL in a non-admin shell instead of forcing the write.

## Migration inventory export

`bootstrap.ps1 -ExportInventory` dumps winget export + pip list for both
python interpreters + global npm packages into `~/.dsh/inventory-<timestamp>.json` (the winget part goes to a separate
`inventory-<timestamp>-winget.json`, Microsoft's own migration format). `-InventoryPath` changes the output directory.
Check a new machine against the list instead of relying on memory.

## Pending-reboot detection

`-Check` / `-Apply` probe three pending-reboot sources (PendingFileRenameOperations / CBS / Windows Update)
up front and tell you to reboot and re-run — driver-level packages interrupted mid-install are half-broken otherwise.

## How to undo

| Change | How to revert |
|---|---|
| User PATH additions | every `-Apply` backs up to `~/.dsh/path-backup-*.txt` first — copy it back |
| User PATH dedupe | every dedupe backs up to `~/.dsh/path-dedup-*.txt` first — copy it back |
| `HKCU\...\Run\DSH` | `Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name DSH` |
| Scheduled task `DSH-DialogArchive` | `Unregister-ScheduledTask -TaskName DSH-DialogArchive -Confirm:$false` |
| G2 repair artifacts | delete the junction / copied packages under `profiles\desktop\node_modules`; every `-Apply` prints a G2 change list with paired rollback commands; gaps-only means nothing else was touched |

## Install as a DSH skill

Drop the whole directory into your workspace's skill library; DSH registers it from the SKILL.md frontmatter automatically:

```
<workspace>\.agents\skills\dsh-env-bootstrap\
```

Then say "装环境" / "换电脑" / "bootstrap" to trigger it.

## First use: point it at your workspace

The scripts **do not depend on the author's workspace path** — the built-in fallback `C:\DSH空间` is overridden by any of the following. Tell it where your workspace is, once:

```powershell
# Option 1: environment variable (recommended)
[Environment]::SetEnvironmentVariable('DSH_WORKSPACE', 'D:\YourWorkspace', 'User')

# Option 2: per-run parameter
.\scripts\bootstrap.ps1 -Check -Workspace 'D:\YourWorkspace'
```

Precedence: `-Workspace` parameter > `DSH_WORKSPACE` env var > `config/manifest.json`'s `workspace.default`.
Without any of these it falls back to the built-in default `C:\DSH空间` (same as bootstrap); when that path does not exist, section H reports "工作区不存在: …" — that is a hint, not a bug.

Maintenance history and review archives: [MAINTAINING.md](MAINTAINING.md), [docs/](docs/) (review reports + [maintenance log](docs/维护日志.md)).

## License

MIT
