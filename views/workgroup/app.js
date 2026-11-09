const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
const STATUS_TEXT = { planning: "规划中", active: "进行中", blocked: "受阻", review: "待验收", done: "已完成", archived: "已归档", partial: "部分完成", running: "执行中", discussion: "讨论中", pending: "等待中", failed: "失败" };
const ASSIGNMENTS = ["辅助协调", "画图", "编程 1", "编程 2", "资料检索", "文案写作", "数据分析", "测试复核"];
const VIEW_META = {
  team: ["团队工位", "成员、任务与执行证据"],
  overview: ["总览", "多 Bot 协作中枢"], scenes: ["场景", "各司其职，不互相踩线"], projects: ["项目", "从需求到证据的推进台账"],
  memory: ["记忆与交接", "换会话，也不会换掉上下文"], collaboration: ["协作记录", "派单、执行、回执、验收"],
  commands: ["命令手册", "查找并复制群命令"], settings: ["设置", "连接工作群与成员实例"],
};
const COMMANDS = [
  ["工作与控制", [
    ["/工作", "进入工作模式"], ["/聊天", "切换至休闲模式"],
    ["@Bot /工作", "点名切换；@ 请在 QQ 中选择"], ["@Bot /聊天", "点名切换；协调 Bot 工作时成员跟随"],
    ["/协作 开", "开启多 Bot 文本分工"], ["/协作 关", "关闭多 Bot 文本分工"], ["/协作 状态", "查询协作状态"],
    ["/work start", "恢复"], ["/work stop", "暂停"], ["/work status", "查询模式及通道"], ["/work tasks", "查看近期任务"],
  ]],
  ["任务与产物", [
    ["/任务 具体需求", "普通需求走文本分工；明确本机制作自动转协调 Bot 工具执行"], ["/本机任务 具体需求", "协调 Bot 调用原生本机工具"],
    ["@Bot /本机任务 具体需求", "只点名一个成员，需启用本机执行且调用者为实例管理员"],
    ["/自动制作 列表", "列出协调实例已登记的顺序制作流程"], ["/自动制作 memory-build", "按已登记的规则跨 Bot 顺序执行，最后尝试发 ZIP"],
    ["/制作 列表", "列出协调实例的单步制作流程"], ["/制作 流程名", "协调实例执行已登记流程"],
    ["/制作 1000000002 流程名", "指定成员代跑，成员流程须允许远程调用"],
    ["/制作文档 md 具体需求", "生成 Markdown 文件"], ["/制作文档 txt 具体需求", "生成纯文本文件"],
    ["/制作插件 具体需求", "生成 AstrBot 插件源码 ZIP"],
  ]],
  ["场景、项目与知识", [
    ["/场景 列表", "查看场景"], ["/项目 列表", "查看项目"], ["/交接 场景ID 交接说明", "更新交接"],
    ["/体检", "检查工作台配置和状态"],
    ["/黑话 列表", "列出术语"], ["/黑话 添加 术语=含义", "添加术语"], ["/黑话 删除 术语", "删除术语"],
    ["/知识库 列表", "列出知识"], ["/知识库 查询 关键词", "查询知识"],
    ["/知识库 添加 标题=内容", "添加知识"], ["/知识库 删除 编号", "删除知识"],
  ]],
  ["电脑沙箱", [
    ["/电脑 状态", "查看 CUA 会话状态"], ["/电脑 授权 10", "申请临时 CUA 会话"],
    ["/电脑任务 具体操作", "调用已授权的 CUA 工具"], ["/电脑 关闭", "关闭 CUA 会话"],
  ]],
];

function renderCommandReference() {
  const grid = $("command-reference");
  for (const [title, entries] of COMMANDS) {
    const card = el("section", "card");
    card.append(el("h2", "", title));
    for (const [command, description] of entries) {
      const row = el("div", "timeline-item");
      const copy = el("button", "mini-button", "复制");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(command);
          copy.textContent = "已复制";
        } catch {
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          copy.textContent = "请手动复制";
        }
      });
      const code = el("code", "", command);
      row.append(code, copy, el("small", "", description));
      card.append(row);
    }
    grid.append(card);
  }
}

renderCommandReference();
let bridge = null;
let overview = {};
let workbench = { scenes: [], projects: [], receipts: [], audit: [], health: { issues: [], counts: {} }, integrations: {} };
let projectFilter = "open";
let editorMode = null;
let editorId = "";
let editorAgentId = "";
let loading = false;
const renderedSections = new Map();
let settingsLoaded = false;
let downloadSettingsLoaded = false;
function renderChanged(key, value, render) {
  const signature = JSON.stringify(value);
  if (renderedSections.get(key) === signature) return;
  render(); renderedSections.set(key, signature);
}

function time(ts) {
  if (!Number(ts)) return "—";
  return new Date(Number(ts) * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function empty(text) { return el("div", "empty", text); }
function showNotice(text, kind = "") { const n = $("notice"); n.textContent = text; n.className = "notice" + (text ? " show" : "") + (kind ? " " + kind : ""); }
function status(value) { const n = el("span", "status " + value, STATUS_TEXT[value] || value || "未知"); return n; }

function go(view) {
  for (const page of document.querySelectorAll("[data-page]")) page.classList.toggle("active", page.dataset.page === view);
  for (const item of document.querySelectorAll("[data-view]")) item.classList.toggle("active", item.dataset.view === view);
  $("view-title").textContent = VIEW_META[view][0]; $("page-title").textContent = VIEW_META[view][1];
}

function renderSceneCard(scene, editable = false) {
  const card = el("article", "scene-card " + (scene.status || "active"));
  const top = el("div", "scene-top"); const copy = el("div"); copy.append(el("h3", "", scene.name), el("div", "role", scene.role || "未设置角色")); top.append(copy, status(scene.status));
  card.append(top, el("p", "", scene.mission || "尚未填写职责。"));
  const foot = el("footer"); foot.append(el("span", "", scene.bot_id ? `Bot ${scene.bot_id}` : "自定义场景"), el("span", "", scene.boundaries ? "边界已设置" : "边界待补")); card.append(foot);
  const lane = el("div", "agent-lane");
  for (const agent of scene.agents || []) lane.append(renderAgentRow(scene, agent, editable));
  if (!lane.children.length) lane.append(empty("暂无代理栏。编辑场景可添加子代理。"));
  card.append(lane);
  if (editable) { const button = el("button", "mini-button", "编辑场景"); button.type = "button"; button.addEventListener("click", () => openSceneEditor(scene)); card.append(button); }
  return card;
}

function agentOnline(scene, agent) {
  if (scene.status === "paused" || agent.status === "paused") return "暂停";
  const bot = (overview.bots || []).find((item) => item.id === scene.bot_id);
  const prefix = agent.kind === "subagent" ? "随主 Bot · " : "";
  if (bot?.online === true || bot?.online_state === "online") return prefix + "QQ 在线";
  if (bot?.online === false || bot?.online_state === "offline") return prefix + "QQ 离线";
  if (bot?.online_state === "unmapped") return prefix + "连接未确认";
  return "待检测";
}
function effortName(value) { return value < 20 ? "快速" : value < 40 ? "精简" : value < 60 ? "标准" : value < 80 ? "深入" : "复核"; }
function isCoordinator() { return Boolean(overview.self_bot_id && overview.self_bot_id === overview.coordinator_id); }
function canControlScene(scene) { return isCoordinator() || (overview.self_bot_id && overview.self_bot_id === scene.bot_id); }
function effortControl(scene, agent, mode) {
  const key = mode === "work" ? "work_effort" : "leisure_effort"; const box = el("label", "effort-box"); box.title = agent.kind === "subagent" && mode === "leisure" ? "子代理休闲强度作为休闲链路调用时的预设" : "";
  box.append(el("span", "", mode === "work" ? "工作" : "休闲")); const range = el("input"); range.type = "range"; range.min = "1"; range.max = "5"; range.step = "1"; const levels = [10, 30, 50, 70, 90]; const value = Number(agent[key] ?? 50); range.value = String(value < 20 ? 1 : value < 40 ? 2 : value < 60 ? 3 : value < 80 ? 4 : 5); const output = el("output", "", effortName(value));
  range.addEventListener("input", () => { output.textContent = effortName(levels[Number(range.value) - 1]); });
  range.addEventListener("change", async () => { const level = levels[Number(range.value) - 1]; range.disabled = true; try { const result = await bridge.apiPost("workbench/action", { action: "agent.effort", data: { scene_id: scene.id, agent_id: agent.id, mode, level } }); if (!result?.saved) throw new Error("未保存"); workbench = result.workbench; output.textContent = effortName(level); } catch (error) { showNotice("思考强度保存失败：" + (error?.message || "未知错误"), "error"); } finally { range.disabled = false; } });
  box.append(range, output); return box;
}
function renderAgentRow(scene, agent, editable) {
  const row = el("div", "agent-row"); const head = el("div", "agent-head"); const name = el("div"); name.append(el("strong", "", agent.name || agent.id), el("small", "", ` · ${agent.kind === "primary" ? "主代理" : "子代理"} · ${agent.role || "未设置职责"}`)); head.append(name, el("small", "agent-status", agentOnline(scene, agent))); row.append(head);
  if (editable) {
    const controls = el("div", "agent-controls"); const select = el("select");
    const roles = ASSIGNMENTS.includes(agent.role) ? ASSIGNMENTS : [...ASSIGNMENTS, agent.role].filter(Boolean);
    for (const role of roles) { const option = el("option", "", role); option.value = role; option.selected = role === agent.role; select.append(option); }
    const custom = el("option", "", "自定义…"); custom.value = "__custom__"; select.append(custom);
    select.title = "任务分工"; select.addEventListener("change", async () => { let role = select.value; if (role === "__custom__") role = window.prompt("输入自定义任务分工", agent.role || "")?.trim(); if (!role) { select.value = agent.role || ASSIGNMENTS[0]; return; } try { const result = await bridge.apiPost("workbench/action", { action: "agent.assignment", data: { scene_id: scene.id, agent_id: agent.id, role } }); workbench = result.workbench; renderAll(); } catch (error) { showNotice("分工保存失败：" + (error?.message || "未知错误"), "error"); } });
    const model = el("button", "", "更换模型"); model.type = "button"; model.addEventListener("click", () => openModelEditor(scene, agent)); controls.append(select, model); row.append(controls, el("div", "agent-model", `模型 · ${agent.provider_id || "跟随当前会话"}`));
    const pair = el("div", "effort-pair"); pair.append(effortControl(scene, agent, "work"), effortControl(scene, agent, "leisure")); row.append(pair);
  } else row.append(el("div", "agent-model", `模型 · ${agent.provider_id || "跟随当前会话"}`));
  return row;
}

function renderProjectCard(project, editable = false) {
  const scenes = new Map(workbench.scenes.map((x) => [x.id, x.name]));
  const card = el("article", "project-card"); const copy = el("div");
  const title = el("div", ""); title.append(el("h3", "", project.name)); copy.append(title);
  copy.append(el("p", "", project.summary || project.next_step || "暂无项目摘要。"));
  const meta = el("div", "project-meta"); meta.append(status(project.status), el("span", "", `Owner · ${scenes.get(project.owner_scene_id) || "未指定"}`), el("span", "", `更新 · ${time(project.updated_at)}`)); copy.append(meta); card.append(copy);
  if (editable && project.status !== "archived") {
    const actions = el("div", "project-actions"); const edit = el("button", "mini-button", "编辑"); edit.type = "button"; edit.addEventListener("click", () => openProjectEditor(project)); actions.append(edit);
    if (["done", "blocked", "review"].includes(project.status)) { const archive = el("button", "mini-button", "归档"); archive.type = "button"; archive.addEventListener("click", () => archiveProject(project)); actions.append(archive); }
    card.append(actions);
  }
  return card;
}

function renderHealth() {
  const health = workbench.health || { status: "warning", issues: [], counts: {} }; const issues = health.issues || [];
  const badge = $("health-badge"); badge.textContent = health.status === "healthy" ? "健康" : health.status === "error" ? "需处理" : "有提醒"; badge.className = "badge " + health.status;
  const summary = $("health-summary"); summary.replaceChildren(el("strong", "", issues.length), el("span", "", issues.length ? "项差异需要关注" : "项差异，当前闭环完整"));
  const list = $("health-issues"); list.replaceChildren(); for (const item of issues.slice(0, 6)) list.append(el("div", "issue " + item.level, `${item.title} · ${item.detail}`)); if (!issues.length) list.append(el("div", "empty", "配置、场景、项目 owner、验收与证据检查通过。"));
  $("system-status").textContent = !overview.configured ? "等待完成配置" : health.status === "error" ? "工作台有阻断项" : "工作台正在运行";
  $("system-detail").textContent = issues.length ? `体检发现 ${issues.length} 项差异` : "场景、项目、派单与回执链路正常";
}
function renderDiagnostics(report) { const target = $("diagnostic-results"); target.replaceChildren(); for (const item of report?.checks || []) { const card = el("article", `diagnostic-item ${item.status || "warn"}`); const label = item.status === "pass" ? "通过" : item.status === "fail" ? "失败" : "提醒"; card.append(el("strong", "", `${label} · ${item.title}`), el("span", "", item.detail || "—")); if (item.suggestion) card.append(el("small", "", `建议：${item.suggestion}`)); target.append(card); } target.classList.toggle("show", Boolean(target.children.length)); }

function renderOverview() {
  const activeScenes = workbench.scenes.filter((x) => x.status === "active"); const openProjects = workbench.projects.filter((x) => !["done", "archived"].includes(x.status));
  $("metric-scenes").textContent = activeScenes.length; $("metric-projects").textContent = openProjects.length; $("metric-running").textContent = (overview.counts?.running || 0) + (overview.counts?.discussion || 0); $("metric-receipts").textContent = workbench.receipts.length;
  $("mode-chip").textContent = overview.mode === "chat" ? "聊天模式" : overview.collaboration_enabled ? "工作模式 · 协作开" : "工作模式 · 独立";
  const scenePreview = $("scene-preview"); scenePreview.replaceChildren(); for (const scene of activeScenes.slice(0, 4)) scenePreview.append(renderSceneCard(scene)); if (!scenePreview.children.length) scenePreview.append(empty("暂无场景。"));
  const projects = $("project-preview"); projects.replaceChildren(); for (const project of openProjects.slice(0, 5)) projects.append(renderProjectCard(project)); if (!projects.children.length) projects.append(empty("暂无进行中项目。群内发送 /任务 即可自动建项目。"));
  const audit = $("audit-preview"); audit.replaceChildren(); for (const item of workbench.audit.slice(0, 7)) { const row = el("div", "timeline-item", `${item.detail || item.action}`); row.append(el("small", "", `${item.actor || "system"} · ${time(item.ts)}`)); audit.append(row); } if (!audit.children.length) audit.append(empty("暂无动态。"));
  const integration = $("integration-status"); integration.replaceChildren(); const links = workbench.integrations || {};
  integration.append(el("span", "integration-chip " + (links.persona?.detected ? "ok" : ""), `人格读取 · ${links.persona?.detected ? (links.persona.mode === "preserve" ? "已联动" : "已检测") : "未检测"}`));
  integration.append(el("span", "integration-chip " + (links.diary?.linked ? "ok" : ""), `日记联动 · ${links.diary?.linked ? "本机共享工作" : links.diary?.detected ? "仅检测" : "未检测"}`));
  integration.append(el("span", "integration-chip " + (links.companion?.detected ? "ok" : ""), `Private Companion · ${links.companion?.linked ? "工作活动联动" : links.companion?.detected ? "已检测" : "未检测"}`));
  integration.append(el("span", "integration-chip " + (links.master_aware?.detected ? "ok" : ""), `Master Aware · ${links.master_aware?.linked ? "公开接口联动" : links.master_aware?.detected ? "已检测" : "未检测"}`));
  integration.append(el("span", "integration-chip ok", "检测方式 · 仅本机、不联网"));
  renderHealth();
  renderDiagnostics(workbench.diagnostics);
}

function renderScenes() { const target = $("scene-list"); target.replaceChildren(); for (const scene of workbench.scenes) target.append(renderSceneCard(scene, canControlScene(scene))); if (!target.children.length) target.append(empty("暂无场景。")); }
function projectVisible(project) { if (projectFilter === "all") return true; if (projectFilter === "open") return !["done", "archived"].includes(project.status); return project.status === projectFilter; }
function renderProjects() { const target = $("project-list"); target.replaceChildren(); for (const project of workbench.projects.filter(projectVisible)) target.append(renderProjectCard(project, true)); if (!target.children.length) target.append(empty("此分类下暂无项目。")); }

function renderMemory() {
  const target = $("memory-list"); target.replaceChildren();
  for (const scene of workbench.scenes) { const card = el("article", "memory-card"); card.append(el("h3", "", scene.name)); const handoff = scene.memory?.handoff || "尚未写交接。建议记录：当前项目、最近变化、下一步和卡点。"; card.append(el("div", "handoff", handoff)); const foot = el("footer"); foot.append(el("span", "", `更新 · ${time(scene.memory?.updated_at)}`)); const edit = el("button", "mini-button", "更新交接"); edit.type = "button"; edit.addEventListener("click", () => openMemoryEditor(scene)); foot.append(edit); card.append(foot); target.append(card); }
  if (!target.children.length) target.append(empty("请先建立场景。"));
}

function renderCollaboration(logs) {
  const bots = overview.bots || []; $("collab-bots").textContent = bots.length; $("collab-peers").textContent = bots.filter((bot) => bot.online === true).length; $("collab-tasks").textContent = (overview.tasks || []).length; $("collab-calls").textContent = bots.reduce((sum, bot) => sum + Number(bot.usage?.calls || 0), 0);
  const tasks = $("task-list"); tasks.replaceChildren(); for (const task of overview.tasks || []) { const card = el("article", "task"); const head = el("header"); head.append(el("strong", "", task.summary), status(task.status)); card.append(head, el("p", "", task.acceptance ? `验收：${task.acceptance}` : task.id)); for (const step of task.steps || []) card.append(el("div", "step", `${step.bot_id} / ${step.agent_id || "primary"} · ${step.work} · ${STATUS_TEXT[step.status] || step.status}`)); card.append(el("small", "", `${task.project_id || "未关联项目"} · ${time(task.created_at)}`)); tasks.append(card); } if (!tasks.children.length) tasks.append(empty("暂无任务。"));
  const receipts = $("receipt-list"); receipts.replaceChildren(); for (const receipt of workbench.receipts.slice(0, 30)) { const card = el("article", "receipt"); const head = el("header"); head.append(el("strong", "", receipt.conclusion?.slice(0, 90) || receipt.task_id), status(receipt.status)); card.append(head, el("p", "", `证据：${receipt.evidence || "未记录"}`), el("small", "", `${receipt.scene_id || "未知场景"} · ${time(receipt.ts)}`)); receipts.append(card); } if (!receipts.children.length) receipts.append(empty("暂无回执。"));
  const knowledge = $("knowledge-list"); knowledge.replaceChildren(); for (const item of [...(overview.knowledge || [])].reverse().slice(0, 20)) { const card = el("article", "plain-item"); card.append(el("strong", "", item.title), el("p", "", item.content), el("small", "", `${item.source_bot || "—"} · ${time(item.created_at)}`)); knowledge.append(card); } if (!knowledge.children.length) knowledge.append(empty("暂无共享知识。"));
  const logList = $("log-list"); logList.replaceChildren(); for (const item of [...(logs || [])].reverse().slice(0, 50)) { const card = el("article", "plain-item"); card.append(el("p", "", item.message), el("small", "", `${item.kind} · ${time(item.ts)}`)); logList.append(card); } if (!logList.children.length) logList.append(empty("暂无日志。"));
}

function renderControlDock() {
  const coordinator = isCoordinator();
  $("control-sync").textContent = "一键同步全部";
  $("control-role-note").textContent = coordinator ? "协调 Bot · 可控制全工作区" : "成员实例 · 只读全局控制";
  for (const id of ["control-mode-work", "control-mode-chat", "control-collab-on", "control-collab-off", "control-sync"]) $(id).disabled = !coordinator;
  $("control-persona").disabled = !coordinator;
  $("control-mode-work").classList.toggle("active", overview.mode !== "chat"); $("control-mode-chat").classList.toggle("active", overview.mode === "chat");
  $("control-collab-on").classList.toggle("active", Boolean(overview.collaboration_enabled)); $("control-collab-off").classList.toggle("active", !overview.collaboration_enabled);
  const settings = (workbench.instance_settings || []).find((item) => item.bot_id === overview.coordinator_id); $("control-persona").value = settings?.work_persona_mode || workbench.persona_mode || "clean";
}

function renderInstanceSettings() {
  const target = $("instance-settings-list"); target.replaceChildren(); const byId = new Map((workbench.instance_settings || []).map((item) => [item.bot_id, item]));
  for (const bot of overview.bots || []) { const item = byId.get(bot.id) || { bot_id: bot.id }; const card = el("article", "instance-setting"); const copy = el("div"); const qqState = bot.online === true || bot.online_state === "online" ? "QQ 在线" : bot.online === false || bot.online_state === "offline" ? "QQ 离线" : bot.online_state === "unmapped" ? "未接入平台机器人" : "QQ 待检测"; const channelState = bot.channel_connected ? "协作通道已连接" : "协作通道未连接"; copy.append(el("h3", "", `${bot.name || bot.id}${bot.id === overview.coordinator_id ? " · 协调 Bot" : ""}`), el("p", "", `${qqState} · ${channelState} · ${item.routing_mode === "model_auto" ? "模型能力自动协调" : "按岗位栏分工"} · ${item.work_persona_mode === "preserve" ? "保留人格" : "去人格"} · 超时 ${item.task_timeout_sec || 120}s · 尝试 ${item.max_attempts || 3} 次`)); card.append(copy); const allowed = isCoordinator() || bot.id === overview.self_bot_id; const button = el("button", "mini-button", allowed ? "调整设置" : "只读"); button.type = "button"; button.disabled = !allowed; if (allowed) button.addEventListener("click", () => openBotSettingsEditor(item)); card.append(button); target.append(card); }
  if (!target.children.length) target.append(empty("实例连接后会显示公开运行设置。"));
}

function renderComputerControl() {
  const status = workbench.computer_control || {}; const note = $("computer-status");
  const authorize = $("computer-authorize"); const disable = $("computer-disable");
  if (status.active) { const remain = Math.max(1, Math.ceil((Number(status.expires_at || 0) - Date.now() / 1000) / 60)); note.textContent = `已授权，约剩 ${remain} 分钟；仅开放 ${status.runtime || "CUA 沙箱"}。`; }
  else note.textContent = status.enabled ? "功能已开启，当前等待主要管理员临时授权。" : "功能未开启；请先在设置中开启。";
  authorize.disabled = !status.enabled || !isCoordinator(); disable.disabled = !status.active || !isCoordinator();
  const native = workbench.native_execution || {};
  const toggle = $("native-execution-toggle");
  toggle.textContent = native.enabled ? "关闭新任务" : "一键启用";
  toggle.disabled = !overview.self_bot_id;
  $("native-execution-status").textContent = native.enabled
    ? "已启用 · 使用当前实例的 AstrBot 管理员权限"
    : "已关闭 · 启用后管理员可从工作群调用本机工具";
  $("native-execution-status").textContent += native.local_runtime
    ? " · Local 已配置" : " · 请核对当前会话的 Local 配置";
  $("native-execution-status").textContent += native.owner_listed
    ? " · 群管理员已列入实例管理员名单" : " · 请核对 AstrBot 管理员名单";
  $("native-execution-status").textContent += " · AstrBot 会话模型（账号由模型供应商插件管理）";
  const timeline = $("native-execution-runs");
  timeline.replaceChildren();
  for (const run of native.runs || []) {
    const row = el("div", "timeline-item", `${run.status} · ${run.id} · ${run.files} 个目录文件（含参考资料）`);
    if (run.error) row.append(el("small", "", run.error));
    for (const tool of (run.tools || []).slice(-20)) {
      row.append(el("small", "", `${tool.name} · ${tool.status}${tool.ms == null ? "" : ` · ${tool.ms} ms`}`));
    }
    timeline.append(row);
  }
  if (!timeline.children.length) timeline.append(empty("暂无本机执行记录。"));
}

function renderAll(logs = []) {
  $("instance-label").textContent = `当前实例 · ${overview.self_bot_id || "尚无群消息"}`; $("connection-text").textContent = overview.configured ? "工作台已连接" : "等待配置"; $("connection-dot").className = "dot " + (overview.configured ? "ok" : "error"); $("updated").textContent = `${time(Date.now() / 1000)} 更新`;
  window.WorkgroupHalo?.update(overview, workbench);
  window.WorkgroupTeam?.update(overview, workbench, () => go("scenes"));
  if (!downloadSettingsLoaded) {
    const downloadForm = $("download-settings-form");
    downloadForm.elements.mode.value = workbench.download_settings?.mode || 'direct';
    downloadForm.elements.proxy_url.value = workbench.download_settings?.proxy_url || '';
    downloadSettingsLoaded = true;
  }
  const detectedProxy = workbench.download_settings?.detected_proxy_url || '';
  const downloadMode = workbench.download_settings?.mode || 'direct';
  $("download-settings-status").textContent = detectedProxy
    ? `实时识别：${detectedProxy} · 当前模式：${downloadMode}`
    : `未识别到本机 HTTP/HTTPS 代理 · 当前模式：${downloadMode}`;
  renderChanged('overview', [workbench.health, workbench.scenes, workbench.projects, workbench.receipts, workbench.integrations, workbench.audit, workbench.diagnostics, overview.bots, overview.counts, overview.mode, overview.collaboration_enabled, overview.configured], renderOverview);
  renderChanged('control', [overview, workbench.persona_mode, workbench.instance_settings], renderControlDock);
  renderChanged('computer', [workbench.native_execution, workbench.computer_control, overview.self_bot_id, overview.coordinator_id], renderComputerControl);
  const editingScene = document.activeElement?.closest('.agent-row');
  if (!editingScene) renderChanged('scenes', [workbench.scenes, overview.bots, overview.self_bot_id, overview.coordinator_id], renderScenes);
  renderChanged('projects', [workbench.projects, workbench.scenes, projectFilter], renderProjects);
  renderChanged('memory', [workbench.memory, workbench.scenes, workbench.receipts], renderMemory);
  renderChanged('collaboration', [logs, overview.tasks, overview.bots, overview.knowledge, workbench.audit, workbench.receipts], () => renderCollaboration(logs));
  renderChanged('settings', [workbench.instance_settings, overview.bots, overview.self_bot_id], renderInstanceSettings);
  if (!overview.configured) showNotice("请先在“设置”中补齐群号、管理员、协调 Bot 和共享密钥。", "error"); else if ((workbench.health?.issues || []).length) showNotice("工作台可用，但体检发现待处理项。打开总览查看差异。", ""); else showNotice("", "ok");
}

function fillSettings(values) {
  const form = $("settings-form"); for (const [key, value] of Object.entries(values || {})) { const input = form.elements.namedItem(key); if (!input) continue; if (input.type === "checkbox") input.checked = Boolean(value); else input.value = value ?? ""; }
  form.elements.namedItem("protocol_secret").value = ""; $("secret-state").textContent = values?.protocol_secret_set ? "已配置；留空保持不变。" : "尚未配置，至少 16 个字符。";
}

async function saveSettings(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const feedback = $("settings-feedback"); const button = $("save-settings");
  try {
    const roster = String(form.get("bot_roster") || "{}").trim() || "{}"; const parsed = JSON.parse(roster); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("能力表须为 JSON 对象");
    const data = { work_group_id: String(form.get("work_group_id") || "").trim(), owner_qq_id: String(form.get("owner_qq_id") || "").trim(), coordinator_bot_id: String(form.get("coordinator_bot_id") || "").trim(), bot_ids: String(form.get("bot_ids") || "").trim(), transport_mode: String(form.get("transport_mode") || "auto"), local_channel_dir: String(form.get("local_channel_dir") || "").trim(), workstation_dir: String(form.get("workstation_dir") || "").trim(), computer_control_enabled: String(form.get("computer_control_enabled") || "false") === "true", computer_session_max_minutes: Number(form.get("computer_session_max_minutes") || 10), bot_roster: roster, task_store: String(form.get("task_store") || "").trim() };
    const secret = String(form.get("protocol_secret") || "").trim(); if (secret) data.protocol_secret = secret; button.disabled = true; feedback.textContent = "正在保存…"; const result = await bridge.apiPost("settings/save", data); if (!result?.saved) throw new Error("服务器未确认保存"); fillSettings(result.settings); feedback.textContent = result.settings?.task_store_restart_required ? "已保存；任务记录路径需重载插件后生效。" : "已保存并应用。"; await refresh();
  } catch (error) { feedback.textContent = "保存失败：" + (error?.message || "请检查输入"); } finally { button.disabled = false; }
}

function field(name, label, value = "", options = {}) {
  const wrap = el("label", options.wide ? "wide" : ""); wrap.append(document.createTextNode(label)); let input;
  if (options.select) { input = el("select"); for (const [v, title] of options.select) { const o = el("option", "", title); o.value = v; o.selected = v === value; input.append(o); } }
  else if (options.textarea) { input = el("textarea"); input.rows = options.rows || 4; input.value = value || ""; }
  else { input = el("input"); input.value = value || ""; }
  input.name = name; if (options.placeholder) input.placeholder = options.placeholder; wrap.append(input); return wrap;
}
function openEditor(mode, id, title, kicker, fields) { editorMode = mode; editorId = id || ""; $("editor-title").textContent = title; $("editor-kicker").textContent = kicker; $("editor-feedback").textContent = ""; const target = $("editor-fields"); target.replaceChildren(...fields); $("editor-dialog").showModal(); }
function openSceneEditor(scene = {}) { const tone = scene.tone || {}; const manualAgents = (scene.agents || []).filter((item) => item.kind === "subagent" && item.source !== "astrbot").map((item) => `${item.name}|${item.role || "子代理"}|${item.description || ""}|${item.status || "ready"}`).join("\n"); openEditor("scene", scene.id, scene.id ? "编辑场景" : "新建场景", "SCENE", [field("name", "场景名称", scene.name), field("bot_id", "绑定 Bot QQ", scene.bot_id), field("role", "角色", scene.role), field("status", "状态", scene.status || "active", { select: [["active", "启用"], ["paused", "暂停"]] }), field("mission", "职责 / 负责什么", scene.mission, { textarea: true, wide: true }), field("boundaries", "边界 / 不碰什么", scene.boundaries, { textarea: true, wide: true }), field("manual_agents", "手动子代理栏（每行：名称|角色|说明|ready 或 paused）", manualAgents, { textarea: true, rows: 5, wide: true, placeholder: "research|研究员|检索并核对资料|ready" }), field("expression", "表达风格", tone.expression), field("structure", "内容结构", tone.structure), field("interaction", "互动方式", tone.interaction), field("avoid", "避免事项", tone.avoid)]); }
function openProjectEditor(project = {}) { const owners = [["", "未指定"], ...workbench.scenes.map((x) => [x.id, x.name])]; openEditor("project", project.id, project.id ? "编辑项目" : "新建项目", "PROJECT", [field("name", "项目名称", project.name, { wide: true }), field("owner_scene_id", "Owner 场景", project.owner_scene_id, { select: owners }), field("status", "状态", project.status || "planning", { select: [["planning", "规划中"], ["active", "进行中"], ["blocked", "受阻"], ["review", "待验收"], ["done", "已完成"]] }), field("summary", "一句话说明", project.summary, { textarea: true, wide: true }), field("acceptance", "验收判据", project.acceptance, { textarea: true, wide: true }), field("next_step", "下一步", project.next_step, { textarea: true, wide: true })]); }
function openMemoryEditor(scene) { const memory = scene.memory || {}; openEditor("memory", scene.id, `更新交接 · ${scene.name}`, "HANDOFF", [field("handoff", "当前交接（不超过 4 KB）", memory.handoff, { textarea: true, rows: 8, wide: true }), field("decisions", "关键决策（每行一条）", (memory.decisions || []).join("\n"), { textarea: true, wide: true }), field("pitfalls", "踩坑与提醒（每行一条）", (memory.pitfalls || []).join("\n"), { textarea: true, wide: true })]); }
function openModelEditor(scene, agent) { const bot = (overview.bots || []).find((item) => item.id === scene.bot_id); const providers = Array.isArray(bot?.providers) ? bot.providers : []; const known = providers.some((item) => item.id === agent.provider_id); const selected = !agent.provider_id ? "" : known ? agent.provider_id : "__custom__"; const options = [["", "跟随当前会话模型"], ...providers.map((item) => [item.id, item.label || item.id]), ["__custom__", "自定义 Provider ID…"]]; editorAgentId = agent.id; openEditor("agent-model", scene.id, `更换模型 · ${agent.name || agent.id}`, "MODEL PROVIDER", [field("provider_id", "已启用的模型供应商", selected, { select: options, wide: true }), field("custom_provider_id", "自定义 Provider ID（仅列表没有时使用）", known ? "" : agent.provider_id || "", { wide: true, placeholder: "例如 opencode-go/deepseek-v4.1-flash" })]); }
function openBotSettingsEditor(item) { openEditor("bot-settings", item.bot_id, `运行设置 · Bot ${item.bot_id}`, "INSTANCE", [field("routing_mode", "任务分配", item.routing_mode || "manual", { select: [["manual", "按岗位栏与计划分工"], ["model_auto", "协调 Bot 联网按公开模型能力自动协调"]], wide: true }), field("proactive_mode", "回复范围", item.proactive_mode || "relevant", { select: [["off", "只处理命令"], ["mention_only", "仅被唤醒"], ["relevant", "识别工作任务"], ["always", "所有消息"]] }), field("work_persona_mode", "工作人格", item.work_persona_mode || "clean", { select: [["clean", "去掉人格工作"], ["preserve", "保留人格工作"]] }), field("discussion_enabled", "任务前讨论", String(Boolean(item.discussion_enabled)), { select: [["true", "开启"], ["false", "关闭"]] }), field("share_task_knowledge", "共享任务结论", String(item.share_task_knowledge !== false), { select: [["true", "开启"], ["false", "关闭"]] }), field("work_ethics_enabled", "管理员任务审核", String(item.work_ethics_enabled !== false), { select: [["true", "开启"], ["false", "关闭"]] }), field("task_timeout_sec", "子任务超时（20–900 秒）", String(item.task_timeout_sec || 120)), field("max_attempts", "最多尝试（1–5 次）", String(item.max_attempts || 3))]); }

async function submitEditor(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); let action;
  if (editorMode === "scene") { action = "scene.upsert"; data.id = editorId; data.tone = { expression: data.expression, structure: data.structure, interaction: data.interaction, avoid: data.avoid }; data.agents = String(data.manual_agents || "").split(/\r?\n/).filter(Boolean).map((line) => { const [name, role, description, status] = line.split("|"); return { name: String(name || "").trim(), role: String(role || "子代理").trim(), description: String(description || "").trim(), status: String(status || "ready").trim(), source: "workgroup" }; }); delete data.manual_agents; delete data.expression; delete data.structure; delete data.interaction; delete data.avoid; }
  else if (editorMode === "project") { action = "project.upsert"; data.id = editorId; }
  else if (editorMode === "agent-model") { action = "agent.model"; data.scene_id = editorId; data.agent_id = editorAgentId; data.provider_id = data.provider_id === "__custom__" ? String(data.custom_provider_id || "").trim() : data.provider_id; }
  else if (editorMode === "bot-settings") { action = "bot.settings"; data.bot_id = editorId; data.settings = { routing_mode: data.routing_mode, proactive_mode: data.proactive_mode, work_persona_mode: data.work_persona_mode, discussion_enabled: data.discussion_enabled === "true", share_task_knowledge: data.share_task_knowledge === "true", work_ethics_enabled: data.work_ethics_enabled === "true", task_timeout_sec: Number(data.task_timeout_sec), max_attempts: Number(data.max_attempts) }; }
  else { action = "memory.update"; data.scene_id = editorId; data.decisions = String(data.decisions || "").split(/\r?\n/).filter(Boolean); data.pitfalls = String(data.pitfalls || "").split(/\r?\n/).filter(Boolean); }
  try { $("editor-feedback").textContent = "保存中…"; const result = await bridge.apiPost("workbench/action", { action, data }); if (!result?.saved) throw new Error("服务器未确认保存"); workbench = result.workbench; $("editor-dialog").close(); renderAll(); } catch (error) { $("editor-feedback").textContent = error?.message || "保存失败"; }
}
async function archiveProject(project) { if (!window.confirm(`将“${project.name}”移入归档？`)) return; try { const result = await bridge.apiPost("workbench/action", { action: "project.archive", data: { project_id: project.id } }); workbench = result.workbench; renderAll(); } catch (error) { showNotice("归档失败：" + (error?.message || "未知错误"), "error"); } }

async function refresh() {
  if (!bridge || loading) return; loading = true; $("refresh").disabled = true;
  try { const [overviewData, workbenchData, logs, settings] = await Promise.all([bridge.apiGet("overview"), bridge.apiGet("workbench"), bridge.apiGet("logs"), bridge.apiGet("settings")]); overview = overviewData || {}; workbench = workbenchData || workbench; if (!settingsLoaded) { fillSettings(settings || {}); settingsLoaded = true; } renderAll(logs?.items || []); }
  catch (error) { window.WorkgroupHalo?.disconnect(); showNotice("读取工作台失败：" + (error?.message || "未知错误"), "error"); $("connection-dot").className = "dot error"; }
  finally { loading = false; $("refresh").disabled = false; }
}

for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => go(button.dataset.view));
for (const button of document.querySelectorAll("[data-go]")) button.addEventListener("click", () => go(button.dataset.go));
for (const button of document.querySelectorAll("[data-project-filter]")) button.addEventListener("click", () => { projectFilter = button.dataset.projectFilter; for (const other of document.querySelectorAll("[data-project-filter]")) other.classList.toggle("active", other === button); renderProjects(); });
$("new-scene").addEventListener("click", () => openSceneEditor()); $("new-project").addEventListener("click", () => openProjectEditor()); $("editor-close").addEventListener("click", () => $("editor-dialog").close()); $("editor-cancel").addEventListener("click", () => $("editor-dialog").close()); $("editor-form").addEventListener("submit", submitEditor); $("settings-form").addEventListener("submit", saveSettings); $("refresh").addEventListener("click", refresh);
$("diagnostics-run").addEventListener("click", async () => { const button = $("diagnostics-run"); button.disabled = true; button.textContent = "检测中…"; showNotice("正在检测模型、QQ 登录和内部通道；最多约 45 秒。", ""); try { const response = await bridge.apiPost("workbench/action", { action: "diagnostics.run", data: {} }); if (!response?.saved) throw new Error("服务器未确认"); workbench = response.workbench || workbench; await refresh(); renderDiagnostics(response.result); const failed = Number(response.result?.failed || 0); const warnings = Number(response.result?.warnings || 0); showNotice(`完整检测结束：${failed} 项失败，${warnings} 项提醒。`, failed ? "error" : warnings ? "" : "ok"); } catch (error) { showNotice("完整检测失败：" + (error?.message || "未知错误"), "error"); } finally { button.disabled = false; button.textContent = "一键完成检测"; } });
async function controlAction(action, data, message) { try { const result = await bridge.apiPost("workbench/action", { action, data }); if (!result?.saved) throw new Error("服务器未确认"); workbench = result.workbench; await refresh(); showNotice(message, "ok"); } catch (error) { showNotice("操作失败：" + (error?.message || "未知错误"), "error"); } }
$("control-mode-work").addEventListener("click", () => controlAction("control.mode", { mode: "work" }, "已切换全群到工作模式。"));
$("control-mode-chat").addEventListener("click", () => controlAction("control.mode", { mode: "chat" }, "已切换全群到休闲模式。"));
$("control-collab-on").addEventListener("click", () => controlAction("control.collaboration", { enabled: true }, "多 Bot 协作已开启。"));
$("control-collab-off").addEventListener("click", () => controlAction("control.collaboration", { enabled: false }, "多 Bot 协作已关闭。"));
$("control-sync").addEventListener("click", () => controlAction("control.sync", {}, "场景、子代理、模型、强度、设置与在线状态已发起全量同步。"));
$("channel-repair").addEventListener("click", () => controlAction("channel.repair", {}, "内部通道已自动修复；WG 协议不会发送到 QQ 群。"));
$("computer-authorize").addEventListener("click", () => { if (!window.confirm("授权主要管理员在 10 分钟内使用 AstrBot CUA 沙箱？不会开放宿主机终端、Python 或任意路径写入。")) return; controlAction("computer.authorize", { minutes: 10 }, "安全电脑会话已授权 10 分钟。群内请使用 /电脑任务 具体操作。" ); });
$("computer-disable").addEventListener("click", () => controlAction("computer.disable", {}, "安全电脑会话已立即关闭。"));
$("native-execution-toggle").addEventListener("click", () => {
  const enabled = !workbench.native_execution?.enabled;
  if (enabled && !window.confirm("允许工作群管理员使用当前实例的 AstrBot 本机工具？")) return;
  controlAction("native.execution", { enabled }, enabled ? "本机任务入口已启用。" : "已关闭新的本机任务。");
});
$("control-persona").addEventListener("change", () => { const current = (workbench.instance_settings || []).find((item) => item.bot_id === overview.coordinator_id) || {}; controlAction("bot.settings", { bot_id: overview.coordinator_id, settings: { ...current, work_persona_mode: $("control-persona").value } }, "协调人格设置已更新。" ); });

async function start() { bridge = window.AstrBotPluginView; if (!bridge) { showNotice("请从 AstrBot 管理面板的插件详情打开此视图。", "error"); return; } try { await bridge.ready(); await refresh(); window.setInterval(() => { if (!document.hidden) refresh(); }, 2500); } catch (error) { showNotice("插件视图连接失败：" + (error?.message || "未知错误"), "error"); } }
start();

$("download-settings-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
  try {
    const result = await bridge.apiPost('workbench/action', {action:'native.download',data:{mode:form.elements.mode.value,proxy_url:form.elements.proxy_url.value.trim()}});
    if (!result?.saved) throw Error('服务器未确认保存');
    workbench = result.workbench; downloadSettingsLoaded = false; renderAll();
  } catch(error) { $("download-settings-status").textContent='保存失败：'+error.message; }
  finally { button.disabled = false; }
});
