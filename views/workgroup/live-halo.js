/* Live telemetry only. File content and shell arguments never enter this view. */
(() => {
  const seen = new Map();
  let freshAt = 0, lastActive = false, visible = true, connectionAlive = true;
  let paused = false;
  const fpsOptions = [30, 45, 60, 90, 120];
  let targetFps = 60;
  const defaultTheme = {preset:'mint', background:'#08111d', text:'#f1f7fc', glow:'#99e3d0', accent:'#67a7ff', strength:100, fade:700, volume:55, tempo:0.6, ringSpeed:0.6, camera:true, camZoom:1, beamGlow:2.6, scan:true};
  const themePresets = {
    mint: {...defaultTheme},
    ocean: {...defaultTheme, preset:'ocean', background:'#050b18', text:'#e8f4ff', glow:'#5edbff', accent:'#4080ff'},
    neon: {...defaultTheme, preset:'neon', background:'#0b0616', text:'#f7ecff', glow:'#d78cff', accent:'#ff4fc8', strength:125},
    gold: {...defaultTheme, preset:'gold', background:'#120d06', text:'#fff5dc', glow:'#f4c86a', accent:'#ff8d45', strength:110}
  };
  const hex = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : null;
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  let theme = {...defaultTheme};
  try {
    const saved = JSON.parse(localStorage.getItem('workgroup.visual.theme') || 'null');
    if (saved) theme = {...theme, ...saved, background:hex(saved.background)||theme.background, text:hex(saved.text)||theme.text, glow:hex(saved.glow)||theme.glow, accent:hex(saved.accent)||theme.accent};
  } catch (_) {}
  theme.strength = clamp(theme.strength, 0, 200, 100); theme.fade = clamp(theme.fade, 0, 2000, 700); theme.volume = clamp(theme.volume, 0, 100, 55);
  theme.tempo = clamp(theme.tempo, .4, 2.5, .6); theme.ringSpeed = clamp(theme.ringSpeed, 0, 3, .6); theme.camZoom = clamp(theme.camZoom, 0, 2, 1); theme.beamGlow = clamp(theme.beamGlow, 0, 6, 2.6); theme.camera = theme.camera !== false; theme.scan = theme.scan !== false;
  let musicWanted = false;
  const music = new Audio('./audio/sw421k.mp3'); music.loop = true; music.preload = 'none';
  // 嵌入页可能禁止存储；不能因此中断整个实时面板初始化。
  try { paused = localStorage.getItem('workgroup.visual.paused') === 'true'; } catch (_) {}
  try { const saved = Number(localStorage.getItem('workgroup.visual.fps')); if (fpsOptions.includes(saved)) targetFps = saved; } catch (_) {}
  const consoleElement = document.querySelector('.halo-console');
  if (typeof IntersectionObserver === 'function') new IntersectionObserver(entries => { visible = entries[0].isIntersecting; post(lastActive); }).observe(consoleElement);
  const visualButton = document.getElementById('halo-visual-toggle');
  const fpsSelect = document.getElementById('halo-fps');
  const fpsReadout = document.getElementById('halo-fps-readout');
  fpsSelect.value = String(targetFps);
  fpsSelect.addEventListener('change', () => {
    const value = Number(fpsSelect.value);
    targetFps = fpsOptions.includes(value) ? value : 60;
    try { localStorage.setItem('workgroup.visual.fps', String(targetFps)); } catch (_) {}
    fpsReadout.textContent = `目标 ${targetFps} FPS`;
    post(lastActive);
  });
  const stylePanel = document.getElementById('halo-style-panel');
  const styleToggle = document.getElementById('halo-style-toggle');
  const styleClose = document.getElementById('halo-style-close');
  const presetSelect = document.getElementById('halo-theme-preset');
  const themeInputs = {
    background:document.getElementById('halo-bg-color'), text:document.getElementById('halo-text-color'),
    glow:document.getElementById('halo-glow-color'), accent:document.getElementById('halo-accent-color'),
    strength:document.getElementById('halo-glow-strength'), fade:document.getElementById('halo-fade-speed')
  };
  const musicButton = document.getElementById('halo-music-toggle');
  const volumeInput = document.getElementById('halo-music-volume');
  const volumeValue = document.getElementById('halo-volume-value');
  const motion = document.createElement('div');
  motion.className = 'halo-motion-settings';
  motion.innerHTML = '<div class="halo-setting-title"><b>动态与光束</b><small>沿用 HALOFLUX 正式调节项</small></div><label>节拍速度 <output data-value="tempo"></output><input data-motion="tempo" type="range" min="0.4" max="2.5" step="0.05"></label><label>圆环转速 <output data-value="ringSpeed"></output><input data-motion="ringSpeed" type="range" min="0" max="3" step="0.05"></label><label class="halo-check">自动运镜 <input data-motion="camera" type="checkbox"></label><label>运镜幅度 <output data-value="camZoom"></output><input data-motion="camZoom" type="range" min="0" max="2" step="0.05"></label><label>光束辉光 <output data-value="beamGlow"></output><input data-motion="beamGlow" type="range" min="0" max="6" step="0.1"></label><label class="halo-check">扫描线质感 <input data-motion="scan" type="checkbox"></label>';
  stylePanel.querySelector('.halo-music-settings')?.before(motion);
  const thanks = document.createElement('div');
  thanks.className = 'halo-attribution';
  thanks.innerHTML = '<b>原作与音乐致谢</b><p>视觉原作：<a href="https://github.com/Ryder191/haloflux" target="_blank" rel="noopener">HALOFLUX by Ryder191（RYDER CODE / Ms MAIKEBAIs CAT）</a><br>本工作台为修改版，仅限非商业使用，遵循 PolyForm Noncommercial 1.0.0。<br>背景音乐：<i>Synthwave 421k</i>，The Cynic Project（cynicmusic），CC0。</p>';
  document.getElementById('halo-style-reset')?.before(thanks);
  const saveTheme = () => { try { localStorage.setItem('workgroup.visual.theme', JSON.stringify(theme)); } catch (_) {} };
  const syncThemeControls = () => {
    presetSelect.value = themePresets[theme.preset] ? theme.preset : 'custom';
    Object.entries(themeInputs).forEach(([key,input]) => { input.value = String(theme[key]); });
    document.getElementById('halo-glow-value').textContent = `${theme.strength}%`;
    volumeInput.value = String(theme.volume); volumeValue.textContent = `${theme.volume}%`;
    motion.querySelectorAll('[data-motion]').forEach(input => { input.type === 'checkbox' ? input.checked = Boolean(theme[input.dataset.motion]) : input.value = String(theme[input.dataset.motion]); });
    motion.querySelectorAll('[data-value]').forEach(output => { output.textContent = Number(theme[output.dataset.value]).toFixed(2).replace(/0+$/,'').replace(/\.$/,''); });
  };
  const applyTheme = (persist=true) => {
    consoleElement.style.setProperty('--halo-bg', theme.background); consoleElement.style.setProperty('--halo-text', theme.text);
    consoleElement.style.setProperty('--halo-glow', theme.glow); consoleElement.style.setProperty('--halo-accent', theme.accent);
    const frame = document.getElementById('halo-visual');
    frame.style.transitionDuration = `${theme.fade}ms`; frame.style.filter = `drop-shadow(0 0 ${Math.round(theme.strength/8)}px ${theme.glow})`;
    music.volume = theme.volume / 100; syncThemeControls(); if (persist) saveTheme(); post(lastActive);
  };
  const markCustom = () => { theme.preset = 'custom'; };
  presetSelect.addEventListener('change', () => {
    if (themePresets[presetSelect.value]) theme = {...theme, ...themePresets[presetSelect.value], volume:theme.volume, fade:theme.fade, tempo:theme.tempo, ringSpeed:theme.ringSpeed, camera:theme.camera, camZoom:theme.camZoom, beamGlow:theme.beamGlow, scan:theme.scan};
    applyTheme();
  });
  Object.entries(themeInputs).forEach(([key,input]) => input.addEventListener('input', () => {
    theme[key] = input.type === 'color' ? (hex(input.value) || defaultTheme[key]) : clamp(input.value, key === 'strength' ? 0 : 0, key === 'strength' ? 200 : 2000, defaultTheme[key]);
    markCustom(); applyTheme();
  }));
  motion.addEventListener('input', event => {
    const input = event.target.closest('[data-motion]'); if (!input) return;
    const key = input.dataset.motion; theme[key] = input.type === 'checkbox' ? input.checked : clamp(input.value, Number(input.min), Number(input.max), defaultTheme[key]);
    syncThemeControls(); saveTheme(); post(lastActive);
  });
  document.getElementById('halo-style-reset').addEventListener('click', () => { const volume=theme.volume; theme={...defaultTheme,volume}; applyTheme(); });
  const setPanel = open => { stylePanel.hidden = !open; styleToggle.setAttribute('aria-expanded', String(open)); };
  styleToggle.addEventListener('click', () => setPanel(stylePanel.hidden)); styleClose.addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setPanel(false); });
  const syncMusic = (error=false) => { musicButton.textContent = error ? '音乐加载失败' : musicWanted && !music.paused ? '暂停音乐' : '播放音乐'; musicButton.setAttribute('aria-pressed', String(musicWanted && !music.paused)); };
  musicButton.addEventListener('click', async () => {
    if (musicWanted && !music.paused) { musicWanted=false; music.pause(); syncMusic(); return; }
    musicWanted=true; try { await music.play(); syncMusic(); } catch (_) { musicWanted=false; syncMusic(true); }
  });
  volumeInput.addEventListener('input', () => { theme.volume=clamp(volumeInput.value,0,100,55); music.volume=theme.volume/100; volumeValue.textContent=`${theme.volume}%`; saveTheme(); });
  music.addEventListener('error', () => syncMusic(true));
  const syncButton = () => { visualButton.textContent = paused ? '恢复光场' : '暂停光场'; visualButton.setAttribute('aria-pressed', String(paused)); };
  visualButton.addEventListener('click', () => { paused = !paused; try { localStorage.setItem('workgroup.visual.paused',String(paused)); } catch (_) {} syncButton(); post(lastActive); });
  syncButton();
  const node = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
  const post = (active, forceEnabled = null) => {
    const available = connectionAlive && !paused && visible && !document.hidden && document.querySelector('[data-page="overview"]')?.classList.contains('active');
    const enabled = forceEnabled === null ? available : available && forceEnabled;
    consoleElement.classList.toggle('halo-running', Boolean(active && enabled));
    consoleElement.classList.toggle('halo-idle', !active || !enabled);
    // 动画控制失败不能阻断工具记录渲染；沙箱页面可能使用 opaque origin。
    try { document.getElementById('halo-visual')?.contentWindow?.postMessage({type:'workgroup-live', enabled, active:active && enabled, fps:targetFps, theme:{background:theme.background, glow:theme.glow, accent:theme.accent, strength:theme.strength, tempo:theme.tempo, ringSpeed:theme.ringSpeed, camera:theme.camera, camZoom:theme.camZoom, beamGlow:theme.beamGlow, scan:theme.scan}}, location.origin === 'null' ? '*' : location.origin); } catch (_) {}
  };
  window.addEventListener('message', event => {
    const frame = document.getElementById('halo-visual');
    if (event.source !== frame?.contentWindow || (event.origin !== location.origin && location.origin !== 'null') || event.data?.type !== 'workgroup-fps') return;
    const actual = Number(event.data.actual);
    if (Number.isFinite(actual)) fpsReadout.textContent = `实际 ${actual.toFixed(0)} / ${targetFps} FPS`;
  });
  document.getElementById('halo-visual')?.addEventListener('load', () => { applyTheme(false); post(lastActive); });
  document.addEventListener('visibilitychange', () => { post(lastActive); if (document.hidden && !music.paused) music.pause(); else if (!document.hidden && musicWanted) music.play().then(syncMusic).catch(()=>syncMusic(true)); });
  const running = r => !r.ended_at && r.status === '执行中';
  function update(overview, workbench) {
    connectionAlive = true;
    freshAt = Date.now();
    const runs = workbench.native_execution?.runs || [];
    const events = runs.flatMap(r => (r.tools || []).map((t,i) => ({...t, key:t.id || `${r.id}:${i}`, run:r.id}))).sort((a,b) => (a.at || 0) - (b.at || 0));
    const active = runs.some(running);
    lastActive = active; post(active);
    document.getElementById('halo-live-status').textContent = `${overview.self_bot_id || '当前实例'} · ${paused ? '手动暂停' : active ? '执行中 · 节拍与光束跟随事件' : '待机 · 光场低速呼吸'} · ${new Date().toLocaleTimeString()} 同步`;
    const stats = document.getElementById('halo-stats'); stats.replaceChildren();
    for (const [label,value] of [['执行中',runs.filter(running).length],['工具调用',events.length],['文件 I/O',events.filter(e=>e.file).length]]) { const n=node('div',''); n.append(node('strong',String(value)),node('small',label)); stats.append(n); }
    const feed = document.getElementById('halo-event-feed'); feed.replaceChildren();
    for (const e of events.slice(-12).reverse()) feed.append(node('div', `${e.at ? new Date(e.at*1000).toLocaleTimeString() : '历史'} · ${e.name} · ${e.status}${e.ms != null ? ` / ${e.ms}ms` : ''}`, 'halo-event'));
    if (!events.length) feed.append(node('div','暂无真实工具事件','halo-event'));
    const flow = document.getElementById('halo-file-flow');
    const files = events.filter(e=>e.file && e.direction).slice(-6);
    // Preserve DOM during polling: each observed I/O pulses once, with no fabricated traffic.
    const sig = JSON.stringify(files.map(e=>[e.key,e.status]));
    if (flow.dataset.signature !== sig) {
      flow.dataset.signature = sig; flow.replaceChildren();
      for (const e of files) {
        const row=node('div','', 'io-row'); const name=e.file.split(/[\\/]/).pop();
        const filename=node('span',name,'io-name'); filename.title=e.file;
        const track=node('span','',`io-track ${e.direction}`);
        const recent=e.at && Date.now()/1000-e.at<8;
        if (recent && !seen.has(e.key)) { track.classList.add('io-live'); seen.set(e.key, Date.now()); }
        const agent=node('span','执行器','io-name');
        row.title=`${e.run} · ${e.status}`;
        row.append(...(e.direction==='read' ? [filename,track,agent] : [agent,track,filename]));
        row.append(node('small', e.direction==='read'?'读取 →':'写入 →')); flow.append(row);
      }
      if (!files.length) flow.append(node('div','暂无文件级读写记录。终端内部读写不作推测。','halo-event'));
    }
    for (const [id,at] of seen) if(Date.now()-at>600000) seen.delete(id);
  }
  function disconnect() { connectionAlive=false; lastActive=false; post(false, false); document.getElementById('halo-live-status').textContent='连接中断 · 已暂停光场'; }
  setInterval(()=>{ if(Date.now()-freshAt>7000 || document.hidden || !document.querySelector('[data-page="overview"]')?.classList.contains('active')) post(false); else post(lastActive); },2000);
  window.WorkgroupHalo={update,disconnect};
  applyTheme(false);
  update({}, {});
})();
