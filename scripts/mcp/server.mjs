#!/usr/bin/env node
/**
 * dsh-env-bootstrap / MCP server（只读三件套）
 *
 * 让 agent 直接发现「这台机器有什么工具、在哪、什么版本、缺什么会坏什么」，
 * 而不是靠人转述路径或自己 which。
 *
 * 传输：stdio，JSON-RPC 2.0，一行一条消息。
 * 只读：本 server 不安装、不修改、不写 PATH。写操作留给 bootstrap -Apply。
 *
 * 工具：
 *   env_status     全量体检结果（等价 verify.mjs --json）
 *   tool_discover  按 capability 查工具（如 media:probe -> ffprobe）
 *   tool_resolve   给工具名返回绝对路径 + 版本 + 是否在 PATH
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const VERIFY = join(SCRIPTS, 'verify.mjs');

let manifest = null;
async function getManifest() {
  if (manifest) return manifest;
  const { loadManifest } = await import('../lib/paths.js');
  manifest = loadManifest();
  return manifest;
}

// 跑 verify --json 拿结构化体检结果。不传 --only 就是全量。
function runVerify(only) {
  const args = [VERIFY, '--json'];
  if (only) args.push('--only=' + only);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: 'verify 输出不是合法 JSON', exitCode: r.status, stderr: (r.stderr || '').slice(0, 400) };
  }
}

const TOOLS = [
  {
    name: 'env_status',
    description: '这台机器的环境体检结果：18 段（含人工前置）逐条状态、缺口计数、退出码。等价 verify.mjs --json。',
    inputSchema: {
      type: 'object',
      properties: {
        only: { type: 'string', description: '只跑指定段，逗号分隔，如 A,G2,00' },
      },
    },
  },
  {
    name: 'tool_discover',
    description: '按 capability 查工具。比如媒体探信息给 "media:probe"，文本搜索给 "text:search"。返回匹配的工具名、消费方、缺失后果。',
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: '能力标识，支持子串匹配' },
        keyword: { type: 'string', description: '按工具名/消费方/能力做模糊匹配' },
      },
    },
  },
  {
    name: 'tool_resolve',
    description: '给工具名返回绝对路径、版本、是否在 PATH。用 where/Get-Command 实测，不靠猜。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '工具名，如 ffmpeg / magick / rg' } },
      required: ['name'],
    },
  },
];

// isError 让 agent 按 MCP 规范把坏参数当失败调用，而不是成功返回了一个 error 对象（审查一般 #6）。
function text(s, isError) {
  const r = { content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] };
  if (isError) r.isError = true;
  return r;
}

async function callTool(name, args) {
  const mf = await getManifest();
  if (name === 'env_status') {
    const only = args && args.only ? String(args.only) : '';
    if (only && !/^[A-Za-z0-9,]+$/.test(only)) return text({ error: 'only 只能是段 id，逗号分隔（如 A,G2,00）' }, true);
    const out = runVerify(only || undefined);
    return text(out, Boolean(out && out.error));
  }
  if (name === 'tool_discover') {
    const cap = (args && args.capability) ? String(args.capability).toLowerCase() : '';
    const kw = (args && args.keyword) ? String(args.keyword).toLowerCase() : '';
    const all = (mf && mf.tools) || [];
    const hit = all.filter((t) => {
      const capHit = cap && String(t.capability || '').toLowerCase().includes(cap);
      const kwHit = kw && [t.name, t.consumer, t.capability, t.degradedBehavior].some((x) => String(x || '').toLowerCase().includes(kw));
      return capHit || kwHit;
    });
    return text({
      matched: hit.length,
      tools: hit.map((t) => ({ name: t.name, capability: t.capability, consumer: t.consumer, degradedBehavior: t.degradedBehavior, install: t.winget || (t.pip && ('pip ' + t.pip)) || (t.npm && ('npm ' + t.npm)) || null })),
    });
  }
  if (name === 'tool_resolve') {
    const n = String((args && args.name) || '').trim();
    if (!n) return text({ error: 'name 必填' }, true);
    // 注入面收口：name 会进 cmd /c。字符白名单 + 只执行 where / manifest pathDirs
    // 解析出的路径，绝不执行原始输入（审查一般 #5）。
    if (!/^[A-Za-z0-9._-]+$/.test(n)) return text({ error: 'name 含非法字符（只允许字母数字 . _ -）' }, true);
    const tool = ((mf && mf.tools) || []).find((t) => t.name === n);
    const probeCmd = (tool && (tool.probeCmd || tool.name)) || n;
    const probeArgs = (tool && (tool.probeArgs !== undefined ? tool.probeArgs : tool.versionArgs)) || ['--version'];
    // 不用 shell+args（DEP0190：参数不转义）。where 是 exe，直接调。
    const r = spawnSync('where', [probeCmd], { encoding: 'utf8', timeout: 15000 });
    const inPathPath = (r.stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
    // 「装了但不在 PATH」是本工具存在的头号理由：where 没命中就回退查 manifest 的
    // pathDirs（7-Zip 经典坑），否则已安装会被误报成未安装（审查一般 #4）。
    let found = inPathPath;
    let installedNotInPath = false;
    if (!found && tool && Array.isArray(tool.pathDirs)) {
      const exeName = tool.exeName || (probeCmd + '.exe');
      for (const d of tool.pathDirs) {
        const cand = join(d, exeName);
        try { if (existsSync(cand)) { found = cand; installedNotInPath = true; break; } } catch { /* keep probing */ }
      }
    }
    let version = null;
    // versionArgs: [] 表示没有安全的版本探针（7z 把帮助首行当版本）——跳过（建议 #10）。
    if (found && Array.isArray(probeArgs) && probeArgs.length > 0) {
      // 走 cmd /c 是为了让 .cmd 也能跑（node 直接 spawn 不了批处理）。执行的是
      // where / pathDirs 解析出的绝对路径，不是用户输入。
      const v = spawnSync('cmd', ['/c', found, ...probeArgs], { encoding: 'utf8', timeout: 15000 });
      version = ((v.stdout || '') + (v.stderr || '')).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
    }
    return text({
      name: n,
      resolved: Boolean(found),
      inPath: Boolean(inPathPath),
      installedNotInPath,
      path: found,
      version,
      capability: tool ? tool.capability : null,
      consumer: tool ? tool.consumer : null,
      degradedBehavior: tool ? tool.degradedBehavior : null,
      installHint: tool ? (tool.winget || (tool.pip && ('pip install ' + tool.pip)) || (tool.npm && ('npm i ' + tool.npm)) || null) : null,
    });
  }
  return text({ error: 'unknown tool: ' + name }, true);
}

// ---------- JSON-RPC over stdio ----------
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

let buf = '';
process.stdin.on('data', async (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    try {
      if (msg.method === 'initialize') {
        reply(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'dsh-env-bootstrap', version: '1.0.0' },
        });
      } else if (msg.method === 'tools/list') {
        reply(msg.id, { tools: TOOLS });
      } else if (msg.method === 'tools/call') {
        const out = await callTool(msg.params && msg.params.name, (msg.params && msg.params.arguments) || {});
        reply(msg.id, out);
      } else if (msg.method === 'notifications/initialized') {
        // no reply for notifications
      } else if (msg.id !== undefined) {
        replyErr(msg.id, -32601, 'method not found: ' + msg.method);
      }
    } catch (e) {
      if (msg.id !== undefined) replyErr(msg.id, -32603, String(e && e.message || e));
    }
  }
});
process.stdin.on('end', () => process.exit(0));
