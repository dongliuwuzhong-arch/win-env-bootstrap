import fs from 'node:fs';
import path from 'node:path';
import { ok, warn, bad, info } from '../lib/report.js';

export const id = 'P';
export const title = '环境完整性与迁移';

export async function check(ctx) {
  const out = [];
  const join = ctx.pathJoin;
  const sys = ctx.sys();

  // Web GUI 端口：监听失败会让插件初始化被拒，进程不退、日志无红字
  const nl = ctx.netstat();
  if (nl) {
    const listen = nl.split('\n').filter((l) => /LISTENING/.test(l) && /127\.0\.0\.1:/.test(l));
    if (listen.length) out.push(ok('本机 LISTENING 端口 ' + listen.length + ' 个'));
    else out.push(warn('没有任何本地 LISTENING 端口 —— web GUI 可能没起来'));
  } else out.push(info('netstat 跑不了'));

  // 单实例锁：第二次启动静默退出（app 级锁，profiles/web 和 desktop 不能同时开）
  if (!sys.ok) out.push(info('进程数读不到'));
  else if (sys.dshProcs >= 1) out.push(ok('DSH 进程数 ' + sys.dshProcs + '（单实例锁：第二次启动会静默退出）'));
  else out.push(info('当前没有 DSH 进程在跑'));

  // 根证书：第三方 CA（加速器会装 MITM 根证书）。Node 不读系统根，所以现在是潜伏项
  const caLines = sys.rootCA.filter((l) => l && l.trim());
  if (caLines.length) {
    out.push(warn('根证书里有 ' + caLines.length + ' 个非主流 CA（可能是加速器 MITM）: ' + caLines.slice(0, 2).join(' / ')));
  } else out.push(ok('根证书里没有可疑的第三方 CA'));

  // 工作区 ACL：robocopy /COPYALL 会把 DENY 和孤儿 SID 一起带到新机
  if (sys.aclOk && sys.acl) {
    const acl = sys.acl;
    const hasDeny = /\(DENY\)/i.test(acl);
    const hasLabel = /Mandatory Label/i.test(acl);
    // Everyone:(CI)(DENY)(DC) 只拒「删除子项」，不拒写 —— 不能一律报问题
    const denyWrite = /\(DENY\)[^\n]*(?:\bW\b|\bM\b|\bF\b)/i.test(acl);
    if (denyWrite) out.push(warn('工作区 ACL 有拒绝写入的 DENY 条目 —— 迁移时会被一起拷走'));
    else if (hasDeny) out.push(info('工作区 ACL 有 DENY 条目（只拒删除子项，不挡写入）'));
    else out.push(ok('工作区 ACL 无 DENY 条目'));
    if (hasLabel) out.push(info('工作区带完整性标签（低 IL 进程可能写不进去）'));
    // 实写测试才是真判据（accessSync 不看 ACL）
    const probe = join(ctx.WS, '.dsh-write-probe-' + process.pid);
    let wsWritable = false;
    try { fs.writeFileSync(probe, 'x', { flag: 'wx' }); wsWritable = true; }
    catch { wsWritable = false; }
    finally { try { fs.unlinkSync(probe); } catch { } }
    if (wsWritable) out.push(ok('工作区实测可写'));
    else out.push(bad('工作区实测不可写'));
  }

  // DSH_WE_DATA_DIR：AGENTS.md 明写「不随目录走，要手工补」
  const weEnv = sys.env.weDataDir;
  if (weEnv && weEnv.trim()) out.push(ok('DSH_WE_DATA_DIR = ' + weEnv.trim()));
  else out.push(info('DSH_WE_DATA_DIR 未设（wallpaper-engine 换机后壁纸库会空）'));

  // 人格注入产物：AGENTS.md 必须比 persona 源新
  try {
    const personaDir = join(ctx.WS, 'knowledge', 'persona');
    const agentsMd = join(ctx.HOME, '.dsh', 'AGENTS.md');
    if (ctx.exists(personaDir) && ctx.exists(agentsMd)) {
      const genTime = fs.statSync(agentsMd).mtimeMs;
      const srcs = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md']
        .map((f) => join(personaDir, f))
        .filter((f) => ctx.exists(f))
        .map((f) => ({ f, t: fs.statSync(f).mtimeMs }));
      const newer = srcs.filter((x) => x.t > genTime);
      if (newer.length === 0) out.push(ok('AGENTS.md 比 persona 源新（已同步）'));
      else out.push(warn('persona 源比 AGENTS.md 新: ' + newer.map((x) => path.basename(x.f)).join(', ') + ' —— 要重跑 build-agents-md.ps1'));
    }
  } catch { out.push(info('人格产物时间比对不了')); }

  // Run 键里的启动器路径是否还在
  const runOut = ctx.runKey();
  if (runOut) {
    // 原正则里 \s 在旧文件里丢了（wscript.exes+），实际从不匹配 —— 保持一致，不擅自修
    const m = runOut.match(/wscript.exes+"([^"]+)"/i);
    if (m) {
      if (ctx.exists(m[1])) out.push(ok('开机自启的启动器在: ' + path.basename(m[1])));
      else out.push(bad('开机自启指向的 vbs 不存在: ' + m[1]));
    }
  } else out.push(info('Run 键里没有 DSH 项'));
  return out;
}