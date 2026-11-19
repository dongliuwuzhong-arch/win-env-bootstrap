import os from 'node:os';
import path from 'node:path';
import { ok, warn, bad, info } from '../lib/report.js';

export const id = 'I';
export const title = '系统配置';

export async function check(ctx) {
  const out = [];

  // node-pty 走 ConPTY，要 Win10 1809 / build 17763+
  const osRel = os.release();
  const buildNo = parseInt((osRel.split('.')[2] || '0'), 10);
  if (buildNo >= 17763) out.push(ok('Windows build ' + buildNo + '（≥17763，ConPTY 可用）'));
  else out.push(bad('Windows build ' + buildNo + ' 低于 17763 —— node-pty/ConPTY 跑不起来'));

  const userPath = process.env.Path || process.env.PATH || '';
  const entries = userPath.split(';').filter(Boolean);
  out.push(info('当前进程 PATH 条目: ' + entries.length));
  const seen = new Map();
  for (const e of entries) {
    const k = e.trim().replace(/[\\/]+$/, '').toLowerCase();
    if (!k) continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, c]) => c > 1);
  if (dups.length) {
    for (const [k, c] of dups) out.push(warn('PATH 重复 ' + c + ' 次: ' + k + '（此处统计进程合并 PATH；用户 PATH 重复 bootstrap -Apply/-DedupPath 会自动去重并备份，Machine 侧重复需手工清理）'));
  } else out.push(ok('进程 PATH 无重复项'));

  // CurrentUser 常是 Undefined（继承），必须看生效值，否则 LocalMachine=Restricted 时报 OK。
  // 不能用 Get-ExecutionPolicy：脚本通常带 -ExecutionPolicy Bypass 启动，
  // Process 作用域优先级最高，生效值永远是 Bypass，这条检查就永远不可能失败。
  // 直接读注册表里的持久化值（快照里已经查好，见 lib/winsys.js）。
  const sys = ctx.sys();
  const epCU = sys.execPolicy.cu;
  const epLM = sys.execPolicy.lm;
  const epPolicy = sys.execPolicy.gpo;
  // 空串也会顶掉下一级（组策略是空串时不该盖住机器级的 Restricted）
  const norm = (v) => (v === undefined || v === null || v === '' || v === 'Undefined' ? 'Undefined' : v);
  const pGpo = norm(epPolicy), pLM = norm(epLM), pCU = norm(epCU);
  const epEff = pGpo !== 'Undefined' ? pGpo : (pLM !== 'Undefined' ? pLM : pCU);
  if (epEff === 'Restricted' || epEff === 'AllSigned') out.push(bad('执行策略生效值 = ' + epEff + '（挡脚本；CU=' + epCU + ' LM=' + epLM + '）'));
  else if (epEff === 'Undefined') out.push(info('执行策略未持久化（CU=' + epCU + ' LM=' + epLM + '）—— 本技能全程用 -ExecutionPolicy Bypass'));
  else out.push(ok('执行策略生效值 = ' + epEff + '（CU=' + epCU + ' LM=' + epLM + '）'));

  // 计划任务：只报「名字=状态」会漏掉「动作指向的文件已经被删」这种静默失效
  if (sys.tasks.length) {
    for (const t of sys.tasks) {
      const line = t.name + '=' + t.state;
      let actionOk = true;
      let actionPath = '';
      const m = t.actions.match(/([A-Za-z]:\\[^\s"]+\.[a-z]{2,4})/i);
      if (m) { actionPath = m[1]; actionOk = ctx.exists(actionPath); }
      if (actionOk) out.push(ok('计划任务: ' + line + (actionPath ? '（动作 ' + path.basename(actionPath) + ' 在）' : '')));
      else out.push(warn('计划任务 ' + t.name + ' 的动作文件不存在: ' + actionPath + '（该任务已失效，可 Unregister）'));
    }
  } else out.push(warn('没有 DSH 相关计划任务（对话存档不会自动跑）'));
  return out;
}