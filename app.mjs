import { createWorldRenderer, drawSideView, fmtTop } from './render.mjs';

const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const sideCanvas = $('side-view'), sideCtx = sideCanvas.getContext('2d');
const replayCanvas = $('replay-canvas'), replayCtx = replayCanvas.getContext('2d');
const renderer = createWorldRenderer();
const storageKey = 'mountain-movers.v05.session';
const photoKey = 'mountain-movers.v05.photos';
const MISSIONS = {
  o6: { number: 'O6', title: '茶馆八仙桌', description: '教学单：六张八仙桌和一个高茶柜，从旧夜市广场的木器行送上山顶茶馆。第一次遇到发夹弯和垭口阵风。',
    note: '要推翻的习惯："主车装得越满越好"。茶馆巷口限宽 2.2 m：主车开不进去，只能停在垭口后停靠点、人手搬一段；伴行小车开得进去，但一车只装得下两张方桌。高茶柜是整面玻璃门，只能立着运，装着它过垭口要躲风或掐着间隙冲。' },
  b2: { number: 'B2', title: '夜市最后一车', description: '旧夜市搬上山顶前坪：四张折叠台既是装车的接驳面，也是新夜市的工作面。台和台上的货可以整组搬。',
    note: '整组过不了 3.0 m 的老山门就只能停西坪：一个人推要绕缓坡，两个人可以直接抬上两级台阶。接单卡：旧气象站待租，公司日后将从它的正门入驻。' },
  b3: { number: 'B3', title: '换季·公司上山', description: '终章：公司的五件东西从车库上山进旧气象站；夜市冬歇，下山进冬棚；冬棚里的货架和长椅上山进新址。三股货流共用前坪和冬棚那一扇门。',
    note: '夜市保持你们在 B2 摆好的样子。前侧摊位若开在气象站正门前，摊位前站着客人，搬着东西过不去：先撤这一摊，或者走后门步道（从观景台另一头进）。冬棚门只过得了折叠台。夜市送的灯笼架连着灯笼立着运就一路亮着。' },
};
const NEXT = { o6: 'b2', b2: 'b3', b3: 'o6' };
let session = null, stream = null, connected = false, pendingInput = false;
let world = null, run = 0, cur = null, prev = null, curAt = 0, prevAt = 0;
let camera = { x: 60, y: 120, scale: 4 }, zoom = 1, showMap = false, lastFrame = performance.now(), lastHud = 0;
let toastTimer = null, reviewShownRun = 0, confirmCallback = null, modalBusy = false, replay = null;
const incidents = new Map();
const input = { up: false, down: false, left: false, right: false, brake: false };
const keyMap = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
const actionKeys = { KeyE: 'interact', KeyG: 'grip', KeyQ: 'fold', KeyR: 'rotate', KeyT: 'tilt', KeyF: 'vehicle' };

const safeJSON = (key, fallback, store = localStorage) => { try { return JSON.parse(store.getItem(key)) ?? fallback; } catch { return fallback; } };
const storeJSON = (key, data, store = localStorage) => { try { store.setItem(key, JSON.stringify(data)); } catch {} };
const isOverlayOpen = () => [...document.querySelectorAll('.overlay')].some(el => !el.hidden);
const isPlaying = () => session && connected && !isOverlayOpen() && cur && !cur.paused;
const me = () => cur?.players?.find(p => p.id === session?.playerId);
const owner = () => session && (cur?.ownerId ?? session.ownerId) === session.playerId;
const myVehicle = () => { const p = me(); return p?.vehicle ? cur.vehicles.find(v => v.id === p.vehicle) : null; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function textEl(tag, str, className = '') { const el = document.createElement(tag); el.textContent = str; if (className) el.className = className; return el; }

function toast(message, duration = 4200) {
  if (!message) return;
  $('toast').textContent = String(message); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
}
function openOverlay(id) { releaseInput(); $(id).hidden = false; }
function closeOverlay(id) { $(id).hidden = true; }
function showGame() {
  for (const el of document.querySelectorAll('.overlay')) el.hidden = true;
  $('game-ui').hidden = false;
  const p = me(); if (p) { camera.x = p.x; camera.y = p.y; camera.scale = 22; }
  updateHud();
}
function showLanding() {
  releaseInput();
  for (const el of document.querySelectorAll('.overlay')) el.hidden = true;
  $('landing').hidden = false; $('resume-button').hidden = !session;
}

async function api(url, data) {
  const response = await fetch(url, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `暂时无法完成操作（${response.status}）`);
  return result;
}
const credentials = (extra = {}) => ({ playerId: session.playerId, token: session.token, ...extra });

function acceptWorld(data) {
  if (!data?.world) return;
  if (data.run && data.run !== run) { incidents.clear(); prev = null; }
  world = data.world; run = data.run ?? run;
}
function acceptState(next) {
  if (!next?.vehicles) return;
  if (next.run && run && next.run !== run) return; // wait for the matching world frame
  if (cur && next.time < cur.time - 1) prev = null;
  prev = cur; prevAt = curAt; cur = next; curAt = performance.now();
  if (next.complete && reviewShownRun !== (next.run ?? 1)) {
    reviewShownRun = next.run ?? 1;
    setTimeout(() => { if (!replay) showReview(); }, 900);
  }
}
function acceptIncident(data) {
  const inc = data?.incident; if (!inc || incidents.has(inc.id)) return;
  incidents.set(inc.id, inc);
  if (inc.type !== 'rollover' || !cur) return;
  const fresh = cur.time - inc.time < 4;
  const p = me();
  const mine = p && (p.vehicle === inc.vehicle || inc.driver === p.name);
  if (fresh && mine) openReplay(inc, true);
  else if (fresh) toast(`${inc.vehicleLabel}侧翻：${inc.text}`, 6000);
}

function connectSession(data) {
  stream?.close();
  session = { roomId: data.roomId, playerId: data.playerId, token: data.token, ownerId: data.ownerId ?? data.state?.ownerId };
  storeJSON(storageKey, session, sessionStorage);
  if (data.world) acceptWorld({ world: data.world, run: data.state?.run });
  if (data.state) acceptState(data.state);
  const url = `/api/rooms/${encodeURIComponent(session.roomId)}/events?${new URLSearchParams({ playerId: session.playerId, token: session.token })}`;
  stream = new EventSource(url);
  stream.onopen = () => { connected = true; updateConnection(); };
  stream.addEventListener('world', e => { try { acceptWorld(JSON.parse(e.data)); } catch {} });
  stream.addEventListener('state', e => { try { connected = true; acceptState(JSON.parse(e.data)); } catch (err) { console.warn('state', err.message); } updateConnection(); });
  stream.addEventListener('incident', e => { try { acceptIncident(JSON.parse(e.data)); } catch {} });
  stream.onerror = () => { connected = false; releaseInput(); updateConnection(); clearTimeout(probeTimer); probeTimer = setTimeout(checkSession, 1500); };
  $('room-code').textContent = session.roomId;
  showGame();
}
// After a dropped stream, ask once whether the room or this credential still exists; if not, go back to the start page.
let probeTimer = 0;
async function checkSession() {
  if (!session || connected) return;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(session.roomId)}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials({ input: {} })) });
    if (response.status === 404) endSession('公司已关闭，或服务已经重新启动。重新开一家公司，或者输入新的房间码。');
    else if (response.status === 401) endSession('这个连接已经失效：离开太久会被请出公司。请重新加入。');
  } catch { /* the server itself is unreachable: keep retrying the stream */ }
}
function endSession(message) {
  stream?.close(); stream = null; session = null; connected = false;
  cur = prev = null; world = null; run = 0; reviewShownRun = 0;
  try { sessionStorage.removeItem(storageKey); } catch {}
  showLanding();
  $('landing-error').textContent = message; $('landing-error').hidden = false;
  loadPreview(document.querySelector('[name=mission]:checked')?.value ?? 'b2');
}
function updateConnection() {
  $('connection-dot').classList.toggle('offline', !connected || !!cur?.paused);
  $('connection-label').textContent = cur?.paused ? '等房主回来' : connected ? '正在同行' : '正在重连';
}
async function sendAction(name, payload = {}) {
  if (!session || !connected) { toast('还没有连接到房间。'); return null; }
  try {
    const result = await api(`/api/rooms/${encodeURIComponent(session.roomId)}/action`, credentials({ action: name, payload }));
    if (result.world) acceptWorld({ world: result.world, run: result.state?.run });
    if (result.state) acceptState(result.state);
    if (result.ok === false) { toast(result.error ?? '靠近要操作的东西再试一次。', 3200); return null; }
    return result;
  } catch (error) { toast(error.message); return null; }
}
async function sendInput(force = false) {
  if (!session || pendingInput || (!connected && !force)) return;
  pendingInput = true;
  try { await api(`/api/rooms/${encodeURIComponent(session.roomId)}/input`, credentials({ input: { ...input } })); } catch {} finally { pendingInput = false; }
}
function releaseInput() { for (const k of Object.keys(input)) input[k] = false; document.querySelectorAll('.touch-controls .pressed').forEach(el => el.classList.remove('pressed')); if (session) sendInput(true); }
setInterval(() => { if (isPlaying()) sendInput(); }, 80);

// ---------------------------------------------------------------- landing

function selection() {
  return { name: $('player-name').value.trim() || '搬家伙伴', mission: document.querySelector('[name=mission]:checked').value, build: document.querySelector('[name=build]:checked').value };
}
async function createOrJoin(join = false) {
  if (modalBusy) return;
  const chosen = selection(), roomId = $('join-code').value.trim().toUpperCase();
  $('landing-error').hidden = true;
  if (join && !roomId) { $('landing-error').textContent = '先输入朋友的房间码。'; $('landing-error').hidden = false; return; }
  modalBusy = true; $('create-button').disabled = $('join-button').disabled = true;
  try {
    const result = await api(join ? `/api/rooms/${encodeURIComponent(roomId)}/join` : '/api/rooms', join ? { name: chosen.name } : chosen);
    storeJSON('mountain-movers.name', chosen.name);
    run = 0; reviewShownRun = 0;
    connectSession(result);
    toast(join ? '到齐了。看右侧稳度卡，再决定怎么装。' : '先看看货在哪里：E 搬起，到车尾 E 装车。F 上车。', 6500);
  } catch (error) { $('landing-error').textContent = error.message; $('landing-error').hidden = false; }
  finally { modalBusy = false; $('create-button').disabled = $('join-button').disabled = false; }
}
document.querySelectorAll('.choice input').forEach(el => el.addEventListener('change', () => {
  document.querySelectorAll('.choice').forEach(c => c.classList.toggle('selected', c.querySelector('input').checked));
  if (!session && el.name === 'mission') loadPreview(el.value);
}));
$('create-button').addEventListener('click', () => createOrJoin());
$('join-button').addEventListener('click', () => createOrJoin(true));
$('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') createOrJoin(true); });
$('resume-button').addEventListener('click', showGame);

// ---------------------------------------------------------------- menu and overlays

for (const id of ['menu-button', 'home-button']) $(id).addEventListener('click', e => { e.preventDefault(); updateMenu(); openOverlay('menu-overlay'); });
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeOverlay(el.dataset.close)));
$('continue-button').addEventListener('click', () => closeOverlay('menu-overlay'));
$('recover-button').addEventListener('click', async () => { closeOverlay('menu-overlay'); await sendAction('recover'); });
$('build-button').addEventListener('click', async () => {
  const next = cur?.build === 'lowbed' ? 'standard' : 'lowbed';
  if (await sendAction('build', { build: next })) { toast(next === 'lowbed' ? '主车换上低货台：前部低段 0.75 m 放一个整组，后段只放一件长件。' : '主车换回普通车床。'); updateMenu(); }
});
$('restart-button').addEventListener('click', () => { if (cur) confirmReset({ mission: cur.mission, build: cur.build }); else toast('还没有连接到房间。'); });
document.querySelectorAll('[data-order]').forEach(button => button.addEventListener('click', () => {
  const mission = button.dataset.order;
  if (!cur) return toast('还没有连接到房间。');
  confirmReset({ mission, build: cur.build }, mission === cur.mission ? '重开这趟委托？' : `换成 ${MISSIONS[mission].number} ${MISSIONS[mission].title}？`);
}));
$('new-company-button').addEventListener('click', showLanding);
$('photos-button').addEventListener('click', () => { closeOverlay('menu-overlay'); showPhotos(); });
$('review-photos').addEventListener('click', () => { closeOverlay('review-overlay'); showPhotos(); });
$('review-next').addEventListener('click', () => { closeOverlay('review-overlay'); if (cur) resetRun({ mission: NEXT[cur.mission], build: cur.build }); });
$('confirm-cancel').addEventListener('click', () => { closeOverlay('confirm-overlay'); confirmCallback = null; });
$('confirm-ok').addEventListener('click', async () => { const fn = confirmCallback; confirmCallback = null; closeOverlay('confirm-overlay'); await fn?.(); });
$('replay-close').addEventListener('click', closeReplay);
$('replay-save').addEventListener('click', () => { if (replay) savePhoto(replay.incident); $('replay-save').disabled = true; $('replay-save').textContent = '已存进照片墙'; });
$('map-button').addEventListener('click', toggleMap);
document.querySelector('#stability-card .card-heading').addEventListener('click', () => {
  const folded = $('stability-card').classList.toggle('folded');
  storeJSON('mountain-movers.cardFolded', folded);
});
if (safeJSON('mountain-movers.cardFolded', false) === true) $('stability-card').classList.add('folded');
$('room-button').addEventListener('click', async () => {
  if (!session) return;
  const url = new URL(location.href); url.search = ''; url.searchParams.set('room', session.roomId);
  try { await navigator.clipboard.writeText(url.href); toast(`邀请链接已复制 · 房间 ${session.roomId}`); }
  catch { toast(`房间码：${session.roomId}。让朋友打开同一个服务器地址，输入这个码。`, 7000); }
});
$('export-button').addEventListener('click', async () => {
  if (!session) return;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(session.roomId)}/export?${new URLSearchParams({ playerId: session.playerId, token: session.token })}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `mountain-movers-v05-${session.roomId}-${cur?.mission ?? 'trip'}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('行程记录已导出。');
  } catch (error) { toast(error.message); }
});
function updateMenu() {
  const lowbed = cur?.build === 'lowbed';
  $('build-button').textContent = lowbed ? '主车换回普通车床' : '主车换成低货台';
  $('build-button').disabled = !owner();
  $('build-button').title = owner() ? '主车要停在旧夜市广场、车床卸空。' : '由公司主人换配置。';
  $('restart-button').disabled = !owner();
  document.querySelectorAll('[data-order]').forEach(b => { b.disabled = !owner(); b.classList.toggle('current', b.dataset.order === cur?.mission); });
}
async function resetRun(options) {
  if (!owner()) { toast('下一单由公司主人开。'); return; }
  const result = await sendAction('reset', options);
  if (result) { reviewShownRun = 0; showGame(); toast('新的一单。先看货在哪里，再看稳度卡。'); }
}
function confirmReset(options, title = '重开这趟委托？') {
  if (cur?.complete) return resetRun(options);
  closeOverlay('menu-overlay'); $('confirm-title').textContent = title; openOverlay('confirm-overlay');
  confirmCallback = () => resetRun(options);
}
function toggleMap() { showMap = !showMap; $('game-ui').classList.toggle('map-mode', showMap); }
function togglePanels() { const hidden = $('game-ui').classList.toggle('panels-hidden'); storeJSON('mountain-movers.panelsHidden', hidden); toast(hidden ? '面板已收起：H 再打开。' : '面板回来了。', 1800); }
if (safeJSON('mountain-movers.panelsHidden', false) === true) $('game-ui').classList.add('panels-hidden');

// ---------------------------------------------------------------- keyboard and touch

window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (replay && !$('replay-overlay').hidden) {
    // A startled driver keeps braking and steering: those keys never close the replay. Enter or Esc do, after a beat.
    e.preventDefault();
    if (!e.repeat && ['Enter', 'NumpadEnter', 'Escape'].includes(e.code) && performance.now() - replay.start > 1200) closeReplay();
    return;
  }
  if (e.code === 'Escape') { if (!session) return; const open = [...document.querySelectorAll('.overlay')].find(el => !el.hidden && el.id !== 'landing'); if (open) closeOverlay(open.id); else { updateMenu(); openOverlay('menu-overlay'); } return; }
  if (!isPlaying()) return;
  if (keyMap[e.code]) { e.preventDefault(); input[keyMap[e.code]] = true; }
  if (e.repeat) return;
  if (actionKeys[e.code]) { e.preventDefault(); sendAction(actionKeys[e.code]); }
  if (e.code === 'KeyM') { e.preventDefault(); toggleMap(); }
  if (e.code === 'KeyH') { e.preventDefault(); togglePanels(); }
});
window.addEventListener('keyup', e => { if (keyMap[e.code]) { input[keyMap[e.code]] = false; if (!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) e.preventDefault(); } });
window.addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInput(); });
window.addEventListener('pagehide', () => { releaseInput(); stream?.close(); });
canvas.addEventListener('wheel', e => { if (!session) return; e.preventDefault(); zoom = Math.max(0.5, Math.min(2.2, zoom * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: false });
document.querySelectorAll('[data-hold]').forEach(button => {
  button.addEventListener('pointerdown', e => { if (!isPlaying()) return; e.preventDefault(); button.setPointerCapture(e.pointerId); input[button.dataset.hold] = true; button.classList.add('pressed'); });
  const release = () => { input[button.dataset.hold] = false; button.classList.remove('pressed'); };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(ev, release);
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('pointerdown', e => { if (isPlaying()) { e.preventDefault(); sendAction(button.dataset.action); } }));

// ---------------------------------------------------------------- HUD

const previewOf = p => p?.intents?.find(i => i.preview)?.preview ?? null;
function refVehicle() {
  if (!cur) return null;
  const mine = myVehicle(); if (mine) return mine;
  const p = me(), pv = previewOf(p);
  if (pv) return cur.vehicles.find(v => v.id === pv.vehicle);
  // A van driving past is not the truck you are loading: only a parked one close by takes the card.
  if (p) { const near = cur.vehicles.filter(v => Math.abs(v.kmh ?? 0) < 1 && !v.occupants?.length).sort((a, b) => dist(p, a) - dist(p, b))[0]; if (near && dist(p, near) < 9) return near; }
  return cur.vehicles.find(v => v.id === 'main');
}
function gustText(g, adv) {
  if (adv === null || adv === undefined) return ['几乎不受影响', 'good'];
  if (adv === 0) return ['只能在挡风墙后等', 'bad'];
  return [`≤ ${adv} km/h，或在挡风墙后等间隙`, 'warn'];
}
function updateCard() {
  const v = refVehicle(); if (!v?.profile) return;
  const pr = v.profile, a = pr.advisory, f = pr.flatAdvisory;
  $('card-vehicle').textContent = `${v.label}${myVehicle()?.id === v.id ? ' · 你在车上' : ''}`;
  drawSideView(sideCtx, sideCanvas.width, sideCanvas.height, { side: pr.side, vehicleType: v.type, top: pr.top, gate: pr.gate, showGate: cur.mission !== 'o6', roll: Math.min(1, (v.warn ?? 0) / 2) * 0.12 });
  const pv = previewOf(me());
  const lines = [
    ...(pv && pv.vehicle === v.id && pv.top !== undefined ? [[`装上后 ${fmtTop(pv.top)} m`, pv.insideGate ? '在近侧装不了：出不了老山门' : `${pv.passGate ? '能过老山门' : '过不了老山门'} · 发夹弯 ≤ ${pv.hairpin}${pv.gust === null ? '' : pv.gust === 0 ? ' · 阵风只能躲' : ` · 阵风 ≤ ${pv.gust}`}`, `preview ${pv.passGate ? 'good' : 'bad'}`]] : []),
    ...(cur.mission === 'o6' ? [
      // O6 goes to the tea house, not through the old gate: what decides the arrival is the lane's width.
      [`最高点 ${fmtTop(pr.top)} m`, '茶馆路不限高', ''],
      ['到场 · 茶馆巷口限宽 2.2 m', pr.width > 2.2 ? `车宽 ${pr.width.toFixed(1)} m：停垭口后，人手搬进去` : `车宽 ${pr.width.toFixed(1)} m：开进茶馆前院`, pr.width > 2.2 ? 'warn' : 'good'],
    ] : [
      [`最高点 ${fmtTop(pr.top)} m`, pr.passGate ? '能过老山门' : '过不了老山门（3.0 m）', pr.passGate ? 'good' : 'bad'],
      ['到场', pr.passGate ? '近侧卸货带（穿过老山门）' : '只能停西坪：一人绕缓坡，两人抬台阶', pr.passGate ? 'good' : 'warn'],
    ]),
    ['盘山短路 · 发夹弯', `≤ ${a.hairpin} km/h${a.hairpin < f.hairpin ? `（平装 ${f.hairpin}）` : ''}`, a.hairpin < 20 ? 'warn' : ''],
    ['环山长路 · 缓弯', `≤ ${a.gentle} km/h`, ''],
    ['垭口阵风', ...gustText(cur.gust, a.gust)],
    ['稳度 = 底宽一半 ÷ 重心', `${pr.stability.toFixed(2)} · 重心 ${pr.com.toFixed(2)} m`, ''],
  ];
  $('card-lines').replaceChildren(...lines.map(([k, val, cls]) => { const li = textEl('li', '', cls); li.append(textEl('span', k), textEl('strong', val)); return li; }));
  // Top view of the bed, tail on the left.
  const look = v.type === 'van' ? { cols: 5, rows: 3 } : { cols: 8, rows: 4 };
  const over = v.type === 'lowbed' ? 4 : 0, cols = look.cols + over;
  const grid = new Map();
  for (const o of cur.objects) {
    if (o.at?.kind === 'bed' && o.at.vehicle === v.id) {
      const cl = o.at.rot ? o.dims.w : o.dims.l, cw = o.at.rot ? o.dims.l : o.dims.w;
      for (let x = o.at.cx; x < o.at.cx + cl; x++) for (let y = o.at.cy; y < o.at.cy + cw; y++) grid.set(`${x},${y}`, o);
    }
  }
  for (const o of cur.objects) {
    if (o.at?.kind !== 'table') continue;
    const t = cur.objects.find(x => x.id === o.at.table);
    if (t?.at?.kind !== 'bed' || t.at.vehicle !== v.id || t.at.rot) continue;
    const cl = o.at.rot ? o.dims.w : o.dims.l, cw = o.at.rot ? o.dims.l : o.dims.w;
    for (let x = 0; x < cl; x++) for (let y = 0; y < cw; y++) grid.set(`${t.at.cx + o.at.cx + x},${t.at.cy + o.at.cy + y}`, o);
  }
  $('bed-grid').style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  const cells = [];
  for (let y = 0; y < look.rows; y++) for (let i = 0; i < cols; i++) {
    const c = cols - 1 - i; // column index from the cab
    const o = grid.get(`${c},${y}`);
    const cell = textEl('div', '', `bed-cell${c >= look.cols ? ' over' : v.type === 'lowbed' && c < 5 ? ' low' : ''}`);
    if (o) { cell.style.background = o.color; cell.title = o.label; }
    cells.push(cell);
  }
  $('bed-grid').replaceChildren(...cells);
  const p = me(), close = myVehicle() || pv || (p && cur.vehicles.some(x => dist(p, x) < 9));
  $('stability-card').classList.toggle('compact', !close);
  $('game-ui').classList.toggle('driving', Boolean(myVehicle()));
  $('bed-caption').textContent = v.type === 'lowbed' ? '浅色 = 低段 0.75 m · 虚线 = 可悬出车尾' : v.type === 'van' ? '小车床 2.5 × 1.5 m' : '车床 4.0 × 2.0 m';
}
function nextCurve(v) {
  let best = null;
  for (const c of world.curves) for (const z of c.zones) {
    const d = Math.hypot(z.x - v.x, z.y - v.y) - z.r;
    const ahead = Math.cos(Math.atan2(z.y - v.y, z.x - v.x) - v.angle) > 0.2;
    if (d < Math.max(35, Math.abs(v.speed) * 5) && (ahead || d < 0) && (!best || d < best.d)) best = { c, d };
  }
  return best;
}
let stuckSince = 0, stuckTold = false;
function updateDrive() {
  const v = myVehicle();
  $('drive-hud').hidden = !v;
  $('warning-banner').hidden = !(v && v.warn > 0);
  if (!v) return;
  const kmh = Math.round(v.kmh ?? 0);
  $('speed-value').textContent = kmh;
  const adviceBox = $('advice-label').parentElement;
  let limit = null;
  if (v.adv !== null && v.adv !== undefined) {
    const c = world.curves.find(x => x.id === v.curveId);
    limit = v.adv;
    $('advice-label').textContent = v.advReason === 'gust' ? '垭口阵风中' : `${c?.label ?? '弯道'}`;
    $('advice-value').textContent = v.adv === 0 ? '躲到挡风墙后！' : kmh > v.adv ? `减速到 ≤ ${v.adv}！` : `≤ ${v.adv} km/h`;
    adviceBox.classList.toggle('over', kmh > v.adv);
  } else {
    const n = nextCurve(v), g = v.profile.advisory.gust;
    // Before the old gate: say plainly whether this load fits under it.
    const towardsGate = v.x > 88 && v.x < 137 && v.y > 14 && v.y < 44 && !v.profile.passGate;
    if (towardsGate) { $('advice-label').textContent = `前方老山门 ${v.profile.gate.toFixed(1)} m · 你 ${fmtTop(v.profile.top)} m`; $('advice-value').textContent = '过不去，去西坪'; adviceBox.classList.add('over'); return void ($('lift-bar').style.width = '0%'); }
    // Before the tea house lane: say plainly whether this truck is narrow enough for it.
    const lane = (world.narrows ?? []).find(n => v.y > n.y - 2 && v.y < n.y + n.h + 2 && v.x > n.x - 24 && v.x < n.x && Math.cos(v.angle) > 0.5);
    if (lane && v.profile.width > lane.limit) { $('advice-label').textContent = `前方茶馆巷口限宽 ${lane.limit.toFixed(1)} m · 你 ${v.profile.width.toFixed(1)} m`; $('advice-value').textContent = '进不去，停垭口后停靠点'; adviceBox.classList.add('over'); return void ($('lift-bar').style.width = '0%'); }
    let over = false;
    const pz = world.pass.zone, nearPass = v.x > pz.x - 4 && v.x < pz.x + pz.w + 4 && v.y > pz.y - 10 && v.y < pz.y + pz.h + 10;
    if ((v.inPass || nearPass) && g !== null) {
      // The gust keeps a fixed rhythm: say where in it we are and what that means for this load.
      const gs = cur.gust, left = `${(gs.left ?? 0).toFixed(1)} s`;
      const phase = gs.state === 'gust' ? `阵风 · 还有 ${left}` : gs.state === 'warn' ? `风声变尖 · ${left} 后起风` : `静 · 还有 ${left}`;
      // A truck crawling in the next stretch would hold a hopping one up in the open: wait for it to clear.
      const up = Math.sin(v.angle) < 0, blocked = cur.vehicles.some(o => o.id !== v.id && Math.abs(o.x - (pz.x + pz.w / 2)) < 7
        && (up ? o.y < v.y - 1 && o.y > v.y - 24 : o.y > v.y + 1 && o.y < v.y + 24));
      const goNow = gs.state === 'calm' && gs.left > 1.4 && !blocked; // a hop takes 3.6-4.4 s; leaving in the first 1.5 s of calm is clean
      $('advice-label').textContent = `${v.inPass ? (v.sheltered ? '挡风墙后' : '垭口') : '垭口前'} · ${phase}`;
      // From a standstill at the mouth, a start in the last two seconds of a gust carries a shelter-only load through the whole pass.
      const dash = !v.inPass && gs.state === 'gust' && gs.left <= 2 && !blocked;
      $('advice-value').textContent = g > 0 ? `阵风时 ≤ ${g} km/h` : goNow ? '现在走 → 下一面挡风墙' : blocked ? '前面那一段有车：等它过去'
        : dash ? '阵风将尽：现在起步能一口气冲过（冲失败要重装）' : '等下一个静风再走';
    }
    else if (n) {
      limit = v.profile.advisory[n.c.grade]; over = kmh > limit;
      $('advice-label').textContent = `前方 ${Math.max(0, Math.round(n.d))} m · ${n.c.label}`;
      $('advice-value').textContent = over ? `减速到 ≤ ${limit}` : `≤ ${limit} km/h`;
    }
    else if (v.inPass) { $('advice-label').textContent = '垭口'; $('advice-value').textContent = '这一车几乎不受风'; }
    else { $('advice-label').textContent = '前方没有弯'; $('advice-value').textContent = ''; }
    adviceBox.classList.toggle('over', over);
  }
  $('speed-value').parentElement.classList.toggle('over', limit !== null && kmh > limit);
  // A truck pushed against the road edge for a few seconds: say how to get out.
  if (v.bump && Math.abs(v.speed) < 0.3 && (input.up || input.down)) {
    stuckSince ||= performance.now();
    if (performance.now() - stuckSince > 3000 && !stuckTold) { stuckTold = true; toast('卡住了？松开油门，S 倒一点再打方向。还出不来：Esc 菜单 → 叫救援（车上的货会卸在救援坪上）。', 7000); }
  } else if (!v.bump) { stuckSince = 0; stuckTold = false; }
  $('lift-bar').style.width = `${Math.min(100, (v.warn ?? 0) / 2 * 100)}%`;
  $('drive-hud').classList.toggle('creak', !!v.creak);
}
function updateHud() {
  if (!cur || !world) return;
  const info = MISSIONS[cur.mission] ?? MISSIONS.b2;
  $('mission-heading').textContent = info.title; $('mission-title').textContent = info.title;
  $('mission-number').textContent = info.number; $('mission-description').textContent = info.description; $('mission-note').textContent = info.note;
  const objectives = cur.objectives ?? [], done = objectives.filter(o => o.done).length;
  $('progress-bar').style.width = `${objectives.length ? 100 * done / objectives.length : 0}%`;
  $('objectives').replaceChildren(...objectives.map(o => { const li = textEl('li', '', o.done ? 'done' : ''); li.append(textEl('span', o.done ? '✓' : '', 'objective-check'), textEl('span', o.label)); return li; }));
  $('stat-moves').textContent = cur.stats.moves; $('stat-carried').textContent = Math.round(cur.stats.carried);
  const secs = Math.round(cur.stats.completedAt ?? cur.time); $('stat-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const g = cur.gust; $('gust-chip').className = `gust-chip ${g.state}`;
  $('gust-label').textContent = g.state === 'gust' ? '垭口阵风 · 正在刮' : g.state === 'warn' ? '垭口阵风 · 风声变尖' : '垭口阵风 · 静';
  $('gust-left').textContent = `${(g.left ?? 0).toFixed(1)}s`;
  const p = me(), held = cur.objects.find(o => o.id === p?.holding), gripped = cur.objects.find(o => o.id === p?.grip);
  let title = cur.complete ? '这一单完成了' : cur.paused ? '等房主回来' : p?.vehicle ? (myVehicle()?.occupants?.[0] === p.id ? `驾驶${myVehicle().label}` : `坐在${myVehicle().label}上`) : gripped ? (gripped.holders.length > 1 ? `两人抬着${gripped.label}` : `推着${gripped.label}`) : held ? `搬着${held.label}` : '下一件从哪里开始？';
  $('context-title').textContent = title;
  $('context-hint').textContent = cur.paused ? '房主重新连上后，车和货从原处继续。' : p?.hint || '靠近货物按 E 搬起；靠近车按 F 上车。';
  $('context-icon').textContent = p?.vehicle ? '⛟' : gripped ? '⇆' : held ? '▣' : cur.complete ? '✓' : '↟';
  updateCard(); updateDrive(); updateConnection();
}

// ---------------------------------------------------------------- what each key does right now

/** The prompts come with the state: the server works them out with the same rules the keys use. */
function affordances(state, p) {
  if (!p || !state) return [];
  return (p.intents ?? []).map(i => ({ key: i.key, label: i.label, main: i.main, refused: i.refused }));
}
function renderAffordances() {
  const list = affordances(cur, me());
  const key = JSON.stringify(list);
  if (key === renderAffordances.last) return;
  renderAffordances.last = key;
  $('affordances').replaceChildren(...list.map(a => { const s = textEl('span', '', `${a.main ? 'main' : ''}${a.refused ? ' refused' : ''}`); if (a.key) s.append(textEl('kbd', a.key)); s.append(document.createTextNode(a.label)); return s; }));
}

// ---------------------------------------------------------------- sound: wind, creak, wheel-lift alarm

const audio = { ctx: null, wind: null, windGain: null, filter: null, alarm: null, alarmGain: null, lastCreak: 0 };
function startAudio() {
  if (audio.ctx || !$('sound-toggle').checked) return;
  try {
    const ctx = new AudioContext(), len = ctx.sampleRate * 2, buffer = ctx.createBuffer(1, len, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 400; filter.Q.value = 0.8;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination); src.start();
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 880;
    const alarmGain = ctx.createGain(); alarmGain.gain.value = 0; osc.connect(alarmGain).connect(ctx.destination); osc.start();
    Object.assign(audio, { ctx, wind: src, windGain: gain, filter, alarm: osc, alarmGain });
  } catch { audio.ctx = null; }
}
function creak(ctx) {
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(140 + Math.random() * 40, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.32);
}
function updateAudio(now) {
  if (!audio.ctx || !cur || !world) return;
  if (!$('sound-toggle').checked || document.hidden) { audio.windGain.gain.value = 0; audio.alarmGain.gain.value = 0; return; }
  const p = me(), v = myVehicle(), pos = v ?? p;
  const z = world.pass.zone, dx = pos ? Math.max(z.x - pos.x, 0, pos.x - z.x - z.w) : 99, dy = pos ? Math.max(z.y - pos.y, 0, pos.y - z.y - z.h) : 99;
  const near = Math.max(0, 1 - Math.hypot(dx, dy) / 70);
  const g = cur.gust.state, sheltered = v?.sheltered;
  const level = (g === 'gust' ? 0.16 : g === 'warn' ? 0.08 : 0.025) * (0.25 + 0.75 * near) * (sheltered ? 0.35 : 1);
  const t = audio.ctx.currentTime;
  audio.windGain.gain.setTargetAtTime(level, t, 0.25);
  // The whistle sharpens two seconds before a gust (v0.5 §3.3).
  audio.filter.frequency.setTargetAtTime(g === 'warn' ? 1500 : g === 'gust' ? 900 : 380, t, 0.3);
  audio.alarmGain.gain.setTargetAtTime(v && v.warn > 0 ? (Math.sin(now / 90) > 0 ? 0.035 : 0) : 0, t, 0.01);
  if (v?.creak && now - audio.lastCreak > 650 - Math.min(400, (v.warn ?? 0) * 200)) { audio.lastCreak = now; creak(audio.ctx); }
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (session) startAudio(); audio.ctx?.resume?.(); });
$('sound-toggle').addEventListener('change', () => { storeJSON('mountain-movers.sound', $('sound-toggle').checked); });
$('sound-toggle').checked = safeJSON('mountain-movers.sound', true) !== false;

// ---------------------------------------------------------------- replay, review, photos

function openReplay(incident, auto = false) {
  replay = { incident, start: performance.now(), auto };
  $('replay-title').textContent = incident.type === 'rollover' ? `侧翻 · ${incident.place}` : `抬轮预警 · ${incident.place}`;
  $('replay-eyebrow').textContent = `三秒回放 · 侧面机位 · ${incident.vehicleLabel}${incident.driver ? ` · 司机 ${incident.driver}` : ''}`;
  $('replay-reason').textContent = incident.text;
  $('replay-rescue').textContent = incident.rescue ? `救援把车拖回${incident.rescue.stop}${incident.rescue.items ? `，车上的 ${incident.rescue.items} 件卸在旁边的救援坪上（整组保持锁定），要重新装车。` : '。'}` : '';
  $('replay-save').disabled = false; $('replay-save').textContent = '存进照片墙';
  openOverlay('replay-overlay');
}
function closeReplay() { replay = null; closeOverlay('replay-overlay'); if (cur?.complete && $('review-overlay').hidden && reviewShownRun) showReview(); }
function drawReplayFrame(c, w, h, incident, elapsed) {
  const frames = incident.frames ?? [];
  if (!frames.length) { drawSideView(c, w, h, { side: incident.side, vehicleType: incident.vehicleType, top: incident.top, caption: incident.text }); return; }
  // rAF timestamps can trail performance.now() by a frame; never index before the first frame.
  const dur = Math.max(1, frames.length * 0.1), t = Math.max(0, Math.min(elapsed, dur + 1.2));
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(t / 0.1))), f = frames[i];
  let roll = Math.min(1, f.w / 2) * 0.14;
  if (incident.type === 'rollover' && t > dur) roll = 0.14 + Math.min(1, (t - dur) / 0.7) * 0.86;
  const over = incident.type === 'rollover' && t > dur + 0.5;
  drawSideView(c, w, h, { side: incident.side, vehicleType: incident.vehicleType, top: incident.top, roll, gust: f.g, shake: f.w > 0 ? Math.sin(t * 50) * 2 : 0, rearInset: true, showGate: false,
    caption: over ? '翻倒 · 车回停靠点，货卸在救援坪上' : `${f.v} km/h${f.adv !== null && f.adv !== undefined ? ` · 建议 ≤ ${f.adv}` : ''}${f.g ? ' · 阵风' : ''}` });
  // Path trace in the lower left corner.
  const xs = frames.map(q => q.x), ys = frames.map(q => q.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const box = Math.min(90, h * 0.32), sc = (box - 12) / Math.max(4, maxX - minX, maxY - minY), ox = 16, oy = h - box - 34;
  c.save(); c.fillStyle = '#ffffffb0'; c.fillRect(ox - 6, oy - 6, box, box); c.strokeStyle = '#2e6860'; c.lineWidth = 2; c.beginPath();
  frames.slice(0, i + 1).forEach((q, k) => { const x = ox + (q.x - minX) * sc, y = oy + (q.y - minY) * sc; k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  c.fillStyle = f.w > 0 ? '#c9533f' : '#2e6860'; c.beginPath(); c.arc(ox + (f.x - minX) * sc, oy + (f.y - minY) * sc, 4, 0, Math.PI * 2); c.fill(); c.restore();
}
function showReview() {
  const r = cur?.review; if (!r) return;
  $('review-title').textContent = r.title;
  $('review-lines').replaceChildren(...r.lines.map(l => textEl('li', l)));
  const st = r.stats;
  const stats = [[`${st.minutes}`, '分钟（不计分）'], [`${st.moves}`, '搬移次数 H'], [`${st.carried} m`, '手搬距离 M'], [`${st.driven} m`, '行驶距离'],
    [`${st.rollovers}`, '侧翻'], [`${st.warnings}`, '抬轮预警'], [`${st.gustWaits}`, '墙后等风'], [`${st.liftSteps}`, '两人抬上台阶']];
  $('review-stats').replaceChildren(...stats.map(([a, b]) => { const d = textEl('div', ''); d.append(textEl('strong', a), textEl('span', b)); return d; }));
  $('review-crew').replaceChildren(...r.crew.map(c => { const s = textEl('span', `${c.name}：搬放 ${c.moves} 次 · 手搬 ${c.carried} m · 开车 ${c.driven} m`); s.style.borderLeft = `4px solid ${c.color}`; return s; }));
  const list = [...incidents.values()].filter(i => i.frames?.length).slice(-6);
  $('review-incidents').replaceChildren(...list.map(i => { const b = textEl('button', `${i.type === 'rollover' ? '侧翻' : '抬轮预警'} · ${i.place} · ${i.speed} km/h（建议 ${i.adv}）— 看回放`); b.addEventListener('click', () => { closeOverlay('review-overlay'); openReplay(i); }); return b; }));
  $('review-next').textContent = cur.mission === 'b2' ? '接终章：B3 换季·公司上山（保留这次的夜市摆法）→' : `接下一单：${MISSIONS[NEXT[cur.mission]].number} ${MISSIONS[NEXT[cur.mission]].title} →`;
  $('review-next').disabled = !owner();
  openOverlay('review-overlay');
}
function savePhoto(incident) {
  const wall = safeJSON(photoKey, []);
  if (wall.some(p => p.key === `${incident.time}-${incident.vehicle}`)) return;
  wall.unshift({ key: `${incident.time}-${incident.vehicle}`, savedAt: new Date().toISOString(), incident });
  storeJSON(photoKey, wall.slice(0, 12));
}
function showPhotos() {
  const wall = safeJSON(photoKey, []);
  if (!wall.length) { $('photo-wall').replaceChildren(textEl('p', '还没有照片。侧翻或抬轮预警的回放可以存进来。')); openOverlay('photos-overlay'); return; }
  $('photo-wall').replaceChildren(...wall.map(entry => {
    const fig = document.createElement('figure'), c = document.createElement('canvas'); c.width = 360; c.height = 150;
    drawReplayFrame(c.getContext('2d'), c.width, c.height, entry.incident, 99);
    c.addEventListener('click', () => { closeOverlay('photos-overlay'); openReplay(entry.incident); });
    fig.append(c, textEl('figcaption', entry.incident.text)); return fig;
  }));
  openOverlay('photos-overlay');
}

// ---------------------------------------------------------------- frame loop

function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
function interpolated(now) {
  if (!cur) return null;
  if (!prev || curAt === prevAt) return cur;
  const t = Math.max(0, Math.min(1, (now - curAt) / Math.max(30, curAt - prevAt)));
  const mix = (list, prevList) => list.map(o => { const p = prevList.find(x => x.id === o.id); return p && Number.isFinite(p.x) ? { ...o, x: p.x + (o.x - p.x) * t, y: p.y + (o.y - p.y) * t, angle: o.angle !== undefined ? lerpAngle(p.angle, o.angle, t) : o.angle } : o; });
  return { ...cur, vehicles: mix(cur.vehicles, prev.vehicles), players: mix(cur.players, prev.players), objects: mix(cur.objects, prev.objects) };
}
function highlightFor(state) {
  const p = state.players.find(x => x.id === session?.playerId);
  return p?.intents?.find(i => i.main && i.target)?.target ?? null;
}
function goalFor(state, p) {
  if (!p || state.complete) return null;
  const zones = world.zones ?? [], inside = (o, z) => o.x >= z.x && o.x <= z.x + z.w && o.y >= z.y && o.y <= z.y + z.h;
  if (p.goal) return p.goal;
  const busy = p.holding || p.grip || p.vehicle;
  // Just parked up the mountain with a load: the next thing is the truck's tail, not the goods left below.
  const loaded = !busy && state.vehicles.filter(v => v.y < 60 && !v.profile?.empty && Math.abs(v.kmh ?? 0) < 1 && dist(p, v) < 45).sort((a, b) => dist(p, a) - dist(p, b))[0];
  if (loaded) { const t = tailOf(loaded); return { x: t.x, y: t.y, label: `到${loaded.label}车尾卸货` }; }
  if (!busy) {
    const waiting = zones.filter(z => z.kind === 'staging' && state.objects.some(o => o.at?.kind === 'ground' && inside(o, z)))
      .sort((a, b) => dist(p, { x: a.x + a.w / 2, y: a.y + a.h / 2 }) - dist(p, { x: b.x + b.w / 2, y: b.y + b.h / 2 }))[0];
    if (waiting) return { x: waiting.x + waiting.w / 2, y: waiting.y + waiting.h / 2, label: `货在${waiting.label.split(' · ')[0]}` };
  }
  const next = (state.objectives ?? []).find(o => !o.done && Number.isFinite(o.x));
  return next ? { x: next.x, y: next.y, label: next.label.split('：')[0].split('（')[0] } : null;
}
function tailOf(v) { const len = v.type === 'van' ? 4.8 : 7.0; return { x: v.x - Math.cos(v.angle) * (len / 2 + 0.9), y: v.y - Math.sin(v.angle) * (len / 2 + 0.9) }; }

function render(now) {
  const dt = Math.min(0.06, (now - lastFrame) / 1000); lastFrame = now;
  const width = innerWidth, height = innerHeight, dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#9fb38c'; ctx.fillRect(0, 0, width, height);
  const state = interpolated(now);
  if (state && world) {
    const p = state.players.find(x => x.id === session?.playerId);
    const v = p?.vehicle ? state.vehicles.find(x => x.id === p.vehicle) : null;
    const overview = showMap || !session || !$('landing').hidden;
    const top = 80, bottom = showMap ? 56 : 130;
    const fit = Math.min(width / (world.bounds.width + 20), (height - top - bottom) / (world.bounds.height + 10));
    const speedZoom = v ? Math.max(9, 15 - (v.kmh ?? 0) * 0.14) : 18;
    const targetScale = overview ? fit : speedZoom * zoom * Math.min(1.2, Math.max(0.75, height / 900));
    const focus = overview ? { x: world.bounds.width / 2, y: world.bounds.height / 2 + (bottom - top) / 2 / fit } : v ? { x: v.x + Math.cos(v.angle) * 6, y: v.y + Math.sin(v.angle) * 6 } : p ?? { x: 70, y: 180 };
    const k = 1 - Math.exp(-dt * 6);
    camera.x += (focus.x - camera.x) * k; camera.y += (focus.y - 1.2 - camera.y) * k; camera.scale += (targetScale - camera.scale) * k;
    renderer.draw(ctx, { world, state, me: p, camera, ref: refVehicle(), highlight: highlightFor(state), goal: overview ? null : goalFor(state, p), t: now / 1000, width, height });
  }
  if (replay && !$('replay-overlay').hidden) drawReplayFrame(replayCtx, replayCanvas.width, replayCanvas.height, replay.incident, (now - replay.start) / 1000);
  if (cur && now - lastHud > 200) { updateHud(); lastHud = now; }
  if (cur) { renderAffordances(); updateAudio(now); }
  requestAnimationFrame(render);
}
function resize() { const dpr = devicePixelRatio || 1; canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`; }
window.addEventListener('resize', resize); resize(); requestAnimationFrame(render);

async function loadPreview(mission = 'b2') {
  try { const data = await api(`/api/preview?mission=${encodeURIComponent(mission)}`); if (!session) { world = data.world; cur = data.state; prev = null; } } catch {}
}
const rememberedName = safeJSON('mountain-movers.name', '搬家队长');
$('player-name').value = typeof rememberedName === 'string' ? rememberedName : '搬家队长';
const invitation = new URLSearchParams(location.search).get('room');
if (invitation) $('join-code').value = invitation.slice(0, 16);
const saved = safeJSON(storageKey, null, sessionStorage);
if (saved?.roomId && saved?.playerId && saved?.token && (!invitation || invitation.toUpperCase() === saved.roomId)) connectSession(saved);
else loadPreview();
