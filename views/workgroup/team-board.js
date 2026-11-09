/* 团队工位：只映射服务器事实，不从聊天措辞推断完成或权限。 */
(function (root) {
  const lanes = { waiting: '待分派', running: '进行中', blocked: '需处理', review: '待验收', done: '记录已完成' };
  function phase(value, native = false) {
    const s = String(value || '').toLowerCase();
    if (/blocked|failed|error|timeout|cancel|受阻|失败|超时|取消|中断/.test(s)) return 'blocked';
    if (native && /已执行|完成|done|success/.test(s)) return 'review';
    if (/review|验收/.test(s)) return 'review';
    if (/done|completed|archived/.test(s)) return 'done';
    if (/running|active|执行中|inprogress/.test(s)) return 'running';
    return 'waiting';
  }
  function records(overview, workbench) {
    const tasks = (overview.tasks || []).map(t => ({ key: 'task:' + t.id, id: t.id, title: t.summary || t.id,
      source: '协作任务', phase: phase(t.status), status: t.status, steps: t.steps || [], acceptance: t.acceptance,
      receipts: (workbench.receipts || []).filter(r => r.task_id === t.id), at: t.created_at }));
    const runs = (workbench.native_execution?.runs || []).map(r => ({ key: 'native:' + r.id, id: r.id,
      title: r.task || r.summary || r.id, source: '本机工具执行', phase: phase(r.status, true), status: r.status, error: r.error,
      bot: r.bot_id || overview.self_bot_id, tools: r.tools || [], files: r.files || 0, at: r.started_at || r.created_at,
      evidence: `artifacts/${r.id}/execution-evidence.json` }));
    return [...runs, ...tasks];
  }
  const api = { phase, records };
  if (typeof module !== 'undefined') module.exports = api;
  if (!root.document) return;
  let current = [], snapshot = {}, signature = '', filter = '';
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = String(text); return n; };
  const byId = id => document.getElementById(id);
  function detail(item) {
    const body = byId('team-detail-body'); body.replaceChildren();
    byId('team-detail-title').textContent = item.title;
    body.append(node('p', '', `${item.source} · ${item.id} · ${item.status || '未知'}`));
    if (item.error) body.append(node("p", "", "受阻原因：" + item.error));
    if (item.acceptance) body.append(node('p', '', '验收要求：' + item.acceptance));
    if (item.evidence) body.append(node('p', '', '证据预期相对路径（是否存在须核对）：' + item.evidence), node('p', '', `${item.files} 个默认目录文件（含参考资料）；数量不代表通过验收。`));
    for (const s of item.steps || []) body.append(node('p', 'team-detail-row', `${s.bot_id} / ${s.agent_id || 'primary'} · ${s.status}\n${s.work || ''}`));
    for (const t of item.tools || []) body.append(node('p', 'team-detail-row', `${t.name} · ${t.status} · ${t.ms == null ? '耗时未知' : t.ms + ' ms'}\n${t.file || ''}`));
    for (const r of item.receipts || []) body.append(node('p', 'team-detail-row', `回执：${r.conclusion || r.status}\n证据：${r.evidence || '未记录'}`));
    if (!(item.tools?.length || item.receipts?.length)) body.append(node('p', '', '当前记录未提供工具调用或验收证据。'));
    byId('team-detail').showModal();
  }
  function drawBoard() {
    const board = byId('team-kanban'); board.replaceChildren();
    const visible = current.filter(r => !filter || JSON.stringify(r).toLowerCase().includes(filter));
    for (const [key, label] of Object.entries(lanes)) {
      const rows = visible.filter(r => r.phase === key), col = node('section', 'team-column ' + key);
      col.append(node('h3', '', `${label} · ${rows.length}`));
      for (const item of rows.slice(0, 50)) {
        const card = node('button', 'team-task'); card.type = 'button';
        card.append(node('small', '', item.source), node('strong', '', item.title), node('small', '', item.status || '状态未知'));
        if (item.bot) card.append(node('small', '', 'Bot ' + item.bot));
        card.addEventListener('click', () => detail(item)); col.append(card);
      }
      if (!rows.length) col.append(node('p', 'team-empty', '暂无记录'));
      if (rows.length > 50) col.append(node('small', '', '显示前 50 条，请搜索缩小范围。'));
      board.append(col);
    }
    byId('team-attention').textContent = `${current.filter(r => r.phase === 'blocked').length} 项需处理 · ${current.filter(r => r.phase === 'review').length} 项待验收`;
  }
  api.update = function (overview, workbench, edit) {
    snapshot = { overview, workbench }; current = records(overview, workbench);
    const next = JSON.stringify([current, workbench.scenes, overview.bots]);
    if (next === signature) return; signature = next;
    drawBoard();
    const desks = byId('team-desks'); desks.replaceChildren();
    for (const scene of workbench.scenes || []) for (const agent of scene.agents || []) {
      const card = node('article', 'team-desk');
      const assigned = current.flatMap(r => (r.steps || []).filter(s => s.bot_id === scene.bot_id && (s.agent_id || 'primary') === agent.id && phase(s.status) === 'running'));
      const native = agent.kind === 'primary' ? current.filter(r => r.bot === scene.bot_id && r.phase === 'running') : [];
      const count = assigned.length + native.length;
      card.classList.toggle('working', count > 0);
      card.append(node('span', 'team-avatar', (agent.name || agent.id || '?').slice(0, 2)), node('h3', '', agent.name || agent.id),
        node('p', '', `${scene.bot_id} · ${agent.kind === 'primary' ? '主代理' : '子代理'}`), node('strong', '', agent.role || '职责待填写'),
        node('p', '', agent.description || '适用任务说明待填写'), node('small', '', `配置模型：${agent.provider_id || '跟随会话'}`),
        node('p', '', count ? `${count} 项执行记录` : '未观测到执行任务'));
      const bot = (overview.bots || []).find(b => b.id === scene.bot_id);
      card.append(node('small', '', `QQ ${bot?.online === true ? '在线' : bot?.online === false ? '离线' : '待检测'} · 子代理不单独判定 QQ 在线`));
      const button = node('button', 'mini-button', '查看场景 / 调整模型'); button.type = 'button'; button.onclick = () => edit(scene); card.append(button); desks.append(card);
    }
    if (!desks.children.length) desks.append(node('p', '', '建立场景后显示成员工位。'));
  };
  document.addEventListener('DOMContentLoaded', () => {
    byId('team-search').addEventListener('input', e => { filter = e.target.value.trim().toLowerCase(); drawBoard(); });
    byId('team-detail-close').onclick = () => byId('team-detail').close();
    byId('team-export').onclick = () => {
      // 用户主动下载当前可见记录，不包含连接设置和密钥。
      const report = { exported_at: new Date().toISOString(), instance: snapshot.overview?.self_bot_id, note: '状态快照不等于独立验收报告', records: current };
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type:'application/json'}));
      const a = node('a'); a.href = url; a.download = 'workgroup-team-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  });
  root.WorkgroupTeam = api;
})(typeof window !== 'undefined' ? window : globalThis);
