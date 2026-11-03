const $ = (id) => document.getElementById(id);
const labels = { running: "进行中", discussion: "讨论分工", done: "已完成", partial: "部分完成", failed: "失败", pending: "等待中" };
const EFFORT_VALUES = [10, 30, 50, 70, 90];
let bridge = null;
let snapshot = null;
let activeFilter = "all";
let loading = false;
const settingsForm = $("settings-form");

function fillSettings(values) {
  for (const [key, value] of Object.entries(values || {})) {
    const input = settingsForm.elements.namedItem(key);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  }
  settingsForm.elements.namedItem("protocol_secret").value = "";
  $("secret-state").textContent = values?.protocol_secret_set
    ? "已配置密钥。留空保持不变；多个实例须使用相同密钥。"
    : "尚未配置密钥。请输入至少 16 个字符。";
  if (values?.task_store_restart_required) $("settings-feedback").textContent = "任务记录路径已保存；重载插件后生效。";
}

async function loadSettings() {
  const values = await bridge.apiGet("settings");
  fillSettings(values);
  if (!values?.work_group_id || !values?.protocol_secret_set) $("settings-panel").open = true;
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("save-settings");
  const feedback = $("settings-feedback");
  const form = new FormData(settingsForm);
  const roster = String(form.get("bot_roster") || "{}").trim() || "{}";
  try {
    const parsed = JSON.parse(roster);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("能力表须为 JSON 对象");
    const values = {
      work_group_id: String(form.get("work_group_id") || "").trim(),
      owner_qq_id: String(form.get("owner_qq_id") || "").trim(),
      coordinator_bot_id: String(form.get("coordinator_bot_id") || "").trim(),
      bot_ids: String(form.get("bot_ids") || "").trim(),
      bot_roster: roster,
      proactive_mode: String(form.get("proactive_mode") || "relevant"),
      transport_mode: String(form.get("transport_mode") || "local"),
      local_channel_dir: String(form.get("local_channel_dir") || "").trim(),
      task_timeout_sec: Number(form.get("task_timeout_sec")),
      max_attempts: Number(form.get("max_attempts")),
      task_store: String(form.get("task_store") || "").trim(),
      discussion_enabled: form.has("discussion_enabled"),
      share_task_knowledge: form.has("share_task_knowledge"),
    };
    const secret = String(form.get("protocol_secret") || "").trim();
    if (secret) values.protocol_secret = secret;
    button.disabled = true;
    feedback.textContent = "正在保存…";
    const result = await bridge.apiPost("settings/save", values);
    if (!result?.saved) throw new Error("服务器未确认保存");
    fillSettings(result.settings);
    feedback.textContent = result.settings?.task_store_restart_required
      ? "已保存。任务记录路径将在重载插件后生效；其他选项已应用。"
      : "已保存并应用到当前实例。其他实例请分别保存相同群号和密钥。";
    await refresh();
  } catch (error) {
    feedback.textContent = "保存失败：" + (error?.message || "请检查输入");
  } finally {
    button.disabled = false;
  }
});

function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = String(value);
  return el;
}

function notice(message, kind = "") {
  $("notice").textContent = message;
  $("notice").className = "notice " + kind;
}

function timestamp(seconds) {
  if (!Number.isFinite(Number(seconds)) || !seconds) return "—";
  return new Date(Number(seconds) * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderBots(bots) {
  const target = $("bots");
  target.replaceChildren();
  if (!bots.length) {
    target.append(node("div", "empty", "尚未发现 Bot。可在上方工作群配置中添加允许加入的账号。"));
    return;
  }
  for (const bot of bots) {
    const card = node("article", "bot");
    const head = node("div", "bot-head");
    const info = node("div");
    info.append(node("div", "bot-name", bot.name || bot.id));
    info.append(node("div", "bot-id", bot.id));
    head.append(info);
    if (bot.coordinator) head.append(node("span", "bot-role", "协调 Bot"));
    card.append(head);
    const tags = node("div", "skills");
    for (const skill of bot.strengths || []) tags.append(node("span", "skill", skill));
    for (const skill of bot.weaknesses || []) tags.append(node("span", "skill weak", "弱项 · " + skill));
    if (!tags.childNodes.length) tags.append(node("span", "bot-id", "自动评估能力"));
    card.append(tags);
    const rating = Object.values(bot.ratings || {}).find((value) => value && value.rank);
    const usage = bot.usage || {};
    card.append(node("div", "bot-extra", `模型 ${bot.model || "未报告"} · 榜单 ${rating ? "#" + rating.rank : "未匹配"}`));
    card.append(node("div", "bot-extra", `Token 输入 ${usage.input ?? 0} / 输出 ${usage.output ?? 0} · 子代理 ${bot.subagents ?? "未知"}`));
    card.append(makeEffortControl(bot, "work", Number.isInteger(bot.effort) ? bot.effort : 50, true));
    target.append(card);
  }
}

function makeEffortControl(bot, mode, initialLevel, initialActive) {
  let savedLevel = initialLevel;
  let active = initialActive;
  const wrap = node("div", "effort-control");
  const label = node("label", "effort-heading", mode === "work" ? "任务思考强度" : "日常聊天思考强度");
  const output = node("output", "", active ? stageText(savedLevel) : "未启用 · 保持原样");
  const slider = node("input", "effort-slider");
  slider.type = "range";
  slider.min = "1";
  slider.max = "5";
  slider.step = "1";
  slider.value = String(stageFor(savedLevel));
  slider.setAttribute("aria-label", `${bot.name || bot.id} 的${mode === "work" ? "工作" : "常态"}模式思考强度`);
  slider.addEventListener("input", () => { output.textContent = stageText(EFFORT_VALUES[Number(slider.value) - 1]); });
  const feedback = node("small", "effort-feedback", mode === "work" ? "新任务生效" : "普通聊天使用；复核档增加一次模型调用");
  slider.addEventListener("change", async () => {
    slider.disabled = true;
    feedback.textContent = "保存中…";
    try {
      const value = EFFORT_VALUES[Number(slider.value) - 1];
      const result = await bridge.apiPost("effort/save", { bot_id: bot.id, level: value, mode });
      if (!result?.saved) throw new Error("服务器未确认保存");
      savedLevel = value;
      active = true;
      output.textContent = stageText(value);
      feedback.textContent = mode === "work" ? "已保存，下个任务生效" :
        result.synced ? "已保存并同步" : "已保存，等待工作群消息同步";
    } catch (error) {
      slider.value = String(stageFor(savedLevel));
      output.textContent = active ? stageText(savedLevel) : "未启用 · 保持原样";
      feedback.textContent = "保存失败：" + (error?.message || "未知错误");
    } finally {
      slider.disabled = false;
    }
  });
  label.append(output);
  const marks = node("div", "effort-marks");
  for (const name of ["快速", "精简", "标准", "深入", "复核"]) marks.append(node("span", "", name));
  wrap.append(label, slider, marks, feedback);
  if (mode === "normal") {
    const reset = node("button", "effort-reset", "恢复原样");
    reset.type = "button";
    reset.addEventListener("click", async () => {
      reset.disabled = true;
      try {
        const result = await bridge.apiPost("effort/save", { bot_id: bot.id, level: null, mode: "normal" });
        if (!result?.saved) throw new Error("服务器未确认保存");
        active = false;
        savedLevel = 50;
        slider.value = "3";
        output.textContent = "未启用 · 保持原样";
        feedback.textContent = result.synced ? "已恢复原样" : "已保存，等待工作群消息同步";
      } catch (error) {
        feedback.textContent = "恢复失败：" + (error?.message || "未知错误");
      } finally {
        reset.disabled = false;
      }
    });
    wrap.append(reset);
  }
  return wrap;
}

function renderNormalBots(bots) {
  const target = $("normal-bots");
  target.replaceChildren();
  for (const bot of bots) {
    const card = node("article", "bot");
    card.append(node("div", "bot-name", bot.name || bot.id));
    card.append(node("div", "bot-id", `${bot.id} · ${bot.model || "模型未报告"}`));
    card.append(makeEffortControl(bot, "normal", Number.isInteger(bot.normal_effort) ? bot.normal_effort : 50, Boolean(bot.normal_active)));
    target.append(card);
  }
  if (!target.childNodes.length) target.append(node("div", "empty", "尚未发现 Bot。请先完成工作群配置。"));
}

function effortLabel(level) {
  return level < 20 ? "快速" : level < 40 ? "精简" : level < 60 ? "标准" : level < 80 ? "深入" : "复核";
}

function stageFor(level) {
  return level < 20 ? 1 : level < 40 ? 2 : level < 60 ? 3 : level < 80 ? 4 : 5;
}

function stageText(level) {
  return `第${stageFor(level)}档 · ${effortLabel(level)}`;
}

function renderTasks(tasks, bots) {
  const target = $("tasks");
  target.replaceChildren();
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));
  const visible = tasks.filter((task) => activeFilter === "all" || task.status === activeFilter);
  if (!visible.length) {
    target.append(node("div", "empty", tasks.length ? "此筛选下暂无任务。" : "暂无任务。向工作群发送一个需求即可开始。"));
    return;
  }
  for (const task of visible) {
    const card = node("article", "task");
    const top = node("div", "task-top");
    const copy = node("div");
    copy.append(node("div", "task-id", task.id));
    copy.append(node("h3", "", task.summary || "未命名任务"));
    copy.append(node("div", "task-time", timestamp(task.created_at)));
    top.append(copy);
    top.append(node("span", "status " + (labels[task.status] ? task.status : ""), labels[task.status] || task.status));
    card.append(top);
    const steps = node("div", "steps");
    for (const step of task.steps || []) {
      const row = node("div", "step");
      row.append(node("span", "step-dot " + (labels[step.status] ? step.status : "")));
      const info = node("div");
      info.append(node("span", "", `${names.get(step.bot_id) || step.bot_id} · ${step.work} · ${labels[step.status] || step.status} · ${stageText(step.effort ?? 50)}`));
      if (step.result) info.append(node("span", "step-result", step.result));
      row.append(info);
      steps.append(row);
    }
    card.append(steps);
    target.append(card);
  }
}

function render(data) {
  snapshot = data;
  const bots = Array.isArray(data.bots) ? data.bots : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  $("bot-count").textContent = bots.length;
  $("running-count").textContent = (data.counts?.running ?? 0) + (data.counts?.discussion ?? 0);
  $("done-count").textContent = data.counts?.done ?? 0;
  $("partial-count").textContent = data.counts?.partial ?? 0;
  $("group-meta").textContent = "群号 · " + (data.group_id || "未配置");
  $("self-meta").textContent = "当前实例 · " + (data.self_bot_id || "尚无群消息");
  $("owner-id").textContent = data.owner_id || "未配置";
  $("mode").textContent = data.mode === "chat" ? "聊天群模式" : "工作群模式";
  const pill = $("status-pill");
  pill.className = "pill " + (!data.configured ? "off" : data.paused ? "paused" : "");
  pill.textContent = !data.configured ? "等待配置" : data.mode === "chat" ? "聊天群模式" : data.paused ? "已暂停" : "协作运行中";
  $("updated").textContent = timestamp(Date.now() / 1000) + " 更新";
  renderBots(bots);
  renderNormalBots(bots);
  $("normal-review-count").textContent = `常态复核 ${data.normal_review_calls || 0} 次`;
  renderTasks(tasks, bots);
  renderDetails(data);
  if (!data.configured) notice("配置尚未完成：请在本页工作群配置中填写群号、主要管理员、协调 Bot 和共享密钥。", "");
  else if (data.transport?.mode !== "local") notice("当前内部通道允许使用群消息，[WG] 可能出现在群里。要隐藏，请在所有实例的工作群配置中选择“本机后台”。", "");
  else if (data.transport?.error) notice("本机后台通道异常：" + data.transport.error + "。内部消息不会退回群里，请检查共享目录。", "error");
  else if (data.mode === "chat") notice("当前为聊天群模式。管理员发送 /工作 可恢复整个工作群；@单个 Bot 后发送 /工作 仅切换该 Bot。", "");
  else if (data.paused) notice("工作群已暂停。主要管理员可在群里发送 /work start 恢复。", "");
  else if (!data.peer_count && bots.length > 1) notice("尚未收到其他 Bot 的协作心跳。请核对各实例的协调 Bot QQ、群号、共享密钥和后台共享目录。", "");
  else notice("", "ok");
}

function renderDetails(data) {
  const knowledge = $("knowledge");
  knowledge.replaceChildren();
  for (const item of [...(data.knowledge || [])].reverse().slice(0, 20)) {
    const card = node("article", "detail-item");
    card.append(node("strong", "", item.title));
    card.append(node("p", "", item.content));
    card.append(node("small", "", `${item.id} · Bot ${item.source_bot || "—"} · ${timestamp(item.created_at)}`));
    knowledge.append(card);
  }
  if (!knowledge.childNodes.length) knowledge.append(node("div", "empty", "暂无共享知识。"));
  $("knowledge-count").textContent = `${(data.knowledge || []).length} 条`;
  const glossary = $("glossary");
  glossary.replaceChildren();
  for (const item of data.glossary || []) glossary.append(node("div", "glossary-item", `${item.term} · ${item.meaning}`));
  if (!glossary.childNodes.length) glossary.append(node("div", "empty", "暂无群内黑话。"));
  $("log-count").textContent = `${data.log_count || 0} 条`;
  $("source-note").textContent = `自动分工来源：${data.benchmark?.source || "尚未获取榜单"} · companion ${data.companion_connected ? "已连接" : "未连接"}`;
}

async function refresh() {
  if (!bridge || loading) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    const data = await bridge.apiGet("overview");
    if (!data || typeof data !== "object") throw new Error("返回的数据格式不正确");
    render(data);
    const logs = await bridge.apiGet("logs");
    const target = $("logs");
    target.replaceChildren();
    for (const item of [...(logs.items || [])].reverse().slice(0, 60)) {
      target.append(node("div", "log-item", `${timestamp(item.ts)} · ${item.kind} · ${item.message}`));
    }
    if (!target.childNodes.length) target.append(node("div", "empty", "暂无工作日志。"));
  } catch (error) {
    notice("读取工作群数据失败：" + (error?.message || "未知错误"), "error");
  } finally {
    loading = false;
    $("refresh").disabled = false;
  }
}

for (const button of document.querySelectorAll("[data-filter]")) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    for (const other of document.querySelectorAll("[data-filter]")) other.classList.toggle("active", other === button);
    if (snapshot) renderTasks(snapshot.tasks || [], snapshot.bots || []);
  });
}
$("refresh").addEventListener("click", refresh);

async function start() {
  bridge = window.AstrBotPluginView;
  if (!bridge) {
    notice("请从 AstrBot 管理面板的插件详情打开此视图。", "error");
    return;
  }
  try {
    await bridge.ready();
    await loadSettings();
    await refresh();
    window.setInterval(() => { if (!document.hidden) refresh(); }, 8000);
  } catch (error) {
    notice("插件视图连接失败：" + (error?.message || "未知错误"), "error");
  }
}
start();
