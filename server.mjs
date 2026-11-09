import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { createGame, addPlayer, removePlayer, setInput, action, step, snapshot, worldView, summerLayout, note } from './sim.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = '0.5.0';
const MAX_BODY = 8192;
const ALLOWED_ACTIONS = new Set(['interact', 'grip', 'fold', 'rotate', 'tilt', 'vehicle', 'recover', 'build', 'reset']);
const OWNER_ACTIONS = new Set(['build', 'reset']);
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/render.mjs', ['render.mjs', 'text/javascript; charset=utf-8']],
  ['/geom.mjs', ['geom.mjs', 'text/javascript; charset=utf-8']],
]);
const EMPTY_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, brake: false });
const options = data => ({ mission: ['o6', 'b3'].includes(data.mission) ? data.mission : 'b2', build: data.build === 'lowbed' ? 'lowbed' : 'standard' });
const displayName = name => String(name ?? '搬家伙伴').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) || '搬家伙伴';
const error = (status, message) => Object.assign(new Error(message), { status });

async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw error(415, '请使用 JSON 请求。');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw error(413, '请求过大。');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw error(400, '请求格式不正确。'); }
}

function send(res, status, value, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(value));
}

/**
 * The HTTP boundary owns credentials and permissions; none enter game state or exports.
 * ownerGrace: how long an owner may be gone before a connected member takes over.
 * unopenedRoomMs: rooms nobody ever connected to are dropped after this.
 * roomsPerAddress: rooms one address may create in ten minutes.
 * liveRoomsPerAddress: rooms one address may keep open at once.
 * memberGrace: how long a member who lost their connection keeps their place.
 */
export async function startServer({ host = '127.0.0.1', port = 4175, ownerGrace = 20_000, unopenedRoomMs = 120_000, roomsPerAddress = 8, liveRoomsPerAddress = 4, memberGrace = 15_000, trustProxy = false } = {}) {
  const rooms = new Map();
  const creations = new Map();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  for (const nets of Object.values(networkInterfaces())) for (const net of nets ?? []) allowedHosts.add(net.address);
  if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host);

  function record(room, type, details = {}) {
    room.events.push({ at: new Date().toISOString(), gameTime: Math.round(room.state.time * 10) / 10, type, ...details });
    if (room.events.length > 4000) { room.events.shift(); room.eventsTruncated = true; }
  }
  function view(room) {
    return { ...snapshot(room.state), roomId: room.id, ownerId: room.ownerId, run: room.run,
      paused: !room.clients.get(room.ownerId)?.streams.size, gameVersion: VERSION,
      connections: [...room.clients.values()].map(p => ({ id: p.id, online: p.streams.size > 0 })) };
  }
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  function write(stream, data) {
    if (!stream.destroyed && stream.writableLength < 1024 * 1024) stream.write(data);
    else stream.destroy();
  }
  function broadcast(room, data = frame('state', view(room))) {
    for (const client of room.clients.values()) for (const stream of client.streams) write(stream, data);
  }
  function sendWorld(room, stream) {
    const data = frame('world', { run: room.run, world: worldView(room.state) });
    if (stream) write(stream, data); else broadcast(room, data);
  }
  function sendIncidents(room, stream) {
    for (const incident of room.state.incidents) {
      if (!stream && incident.id <= room.sentIncident) continue;
      const data = frame('incident', { run: room.run, incident });
      if (stream) write(stream, data); else broadcast(room, data);
    }
    if (!stream) room.sentIncident = room.state.incidents.at(-1)?.id ?? room.sentIncident;
  }
  function register(room, name) {
    if (room.clients.size >= 4) throw error(409, '公司里已经有四位伙伴了。');
    const id = randomBytes(6).toString('hex');
    const token = randomBytes(24).toString('hex');
    const client = { id, token, name: displayName(name), streams: new Set(), lastInput: 0,
      inputWindow: 0, inputCount: 0, actionWindow: 0, actionCount: 0, disconnectedAt: Date.now() };
    addPlayer(room.state, id, client.name);
    room.clients.set(id, client);
    record(room, 'player_joined', { playerId: id, name: client.name });
    return client;
  }
  function authenticate(room, data) {
    const client = room.clients.get(data.playerId);
    const token = String(data.token ?? '');
    if (!client || !/^[a-f0-9]{48}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(client.token))) {
      throw error(401, '连接凭据已失效，请重新加入公司。');
    }
    room.lastSeen = Date.now();
    return client;
  }
  function limit(client, type, max) {
    const now = Date.now();
    if (now - client[`${type}Window`] > 1000) { client[`${type}Window`] = now; client[`${type}Count`] = 0; }
    if (++client[`${type}Count`] > max) throw error(429, '操作太快，请稍候。');
  }
  function credentialResult(room, client) {
    return { roomId: room.id, playerId: client.id, token: client.token, ownerId: room.ownerId, state: view(room), world: worldView(room.state) };
  }
  function resetRoom(room, selected) {
    // A finished night market carries its summer layout into the finale (v0.5 §8.2).
    if (room.state.mission === 'b2' && room.state.complete) room.summer = summerLayout(room.state);
    const carry = selected.mission === 'b3' ? room.summer ?? null : null;
    room.state = createGame({ ...selected, carry });
    room.run++; room.sentIncident = 0;
    for (const member of room.clients.values()) { addPlayer(room.state, member.id, member.name); member.lastInput = 0; }
    record(room, 'session_reset', { ...selected, ...(selected.mission === 'b3' ? { summerLayout: carry ? 'carried from B2' : 'default' } : {}) });
    sendWorld(room);
    broadcast(room);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const base = new URL(`http://${req.headers.host ?? 'invalid'}`);
      if (!allowedHosts.has(base.hostname)) throw error(403, '不接受这个访问地址。');
      if (req.headers.origin && req.headers.origin !== base.origin) throw error(403, '不接受跨站操作。');
      const url = new URL(req.url, base);
      if (req.method === 'GET' && STATIC.has(url.pathname)) {
        const [file, type] = STATIC.get(url.pathname);
        const content = await readFile(path.join(ROOT, file)).catch(e => { throw e.code === 'ENOENT' ? error(404, '没有这个页面。') : e; });
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(content); return;
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && url.pathname === '/api/health') { send(res, 200, { ok: true, version: VERSION, rooms: rooms.size }); return; }
      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const s = createGame(options(Object.fromEntries(url.searchParams)));
        send(res, 200, { state: snapshot(s), world: worldView(s) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const body = await jsonBody(req);
        // Behind a reverse proxy every player shares its address; start the server with trustProxy to use X-Forwarded-For.
        const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
        const address = forwarded || req.socket.remoteAddress || 'unknown', now = Date.now();
        for (const [a, list] of creations) { const kept = list.filter(t => now - t < 10 * 60_000); if (kept.length) creations.set(a, kept); else creations.delete(a); }
        const recent = creations.get(address) ?? [];
        if (recent.length >= roomsPerAddress) throw error(429, '这台设备开公司太频繁了，请稍后再试。');
        if ([...rooms.values()].filter(r => r.address === address).length >= liveRoomsPerAddress) throw error(429, '这台设备开着的公司太多了：先关掉一家再开。');
        if (rooms.size >= 20) throw error(503, '这次会话的公司已满，请重启服务或稍后再试。');
        recent.push(now); creations.set(address, recent);
        let id;
        do { id = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(id));
        const room = { id, state: createGame(options(body)), clients: new Map(), ownerId: null, run: 1, sentIncident: 0,
          startedAt: new Date().toISOString(), createdAt: now, opened: false, lastSeen: now, events: [], eventsTruncated: false, address };
        const client = register(room, body.name);
        room.ownerId = client.id;
        record(room, 'session_created', options(body));
        rooms.set(id, room);
        send(res, 201, credentialResult(room, client)); return;
      }
      const match = /^\/api\/rooms\/([A-Fa-f0-9]{6})\/(join|events|input|action|export)$/.exec(url.pathname);
      if (!match) throw error(404, '没有这个页面。');
      const room = rooms.get(match[1].toUpperCase());
      if (!room) throw error(404, '公司已关闭，或服务已经重新启动。');
      const command = match[2];
      if (command === 'join' && req.method === 'POST') {
        const body = await jsonBody(req);
        const client = register(room, body.name);
        room.lastSeen = Date.now();
        send(res, 201, credentialResult(room, client));
        broadcast(room); return;
      }
      if (command === 'events' && req.method === 'GET') {
        const client = authenticate(room, Object.fromEntries(url.searchParams));
        // One credential is one player; a new stream replaces the old one (a reconnect, not a second driver).
        for (const old of client.streams) old.end();
        client.streams.clear();
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        client.streams.add(res);
        client.disconnectedAt = null;
        room.opened = true;
        record(room, 'connected', { playerId: client.id });
        res.on('close', () => {
          client.streams.delete(res);
          if (client.streams.size === 0) {
            client.disconnectedAt = Date.now();
            setInput(room.state, client.id, EMPTY_INPUT);
            record(room, 'disconnected', { playerId: client.id });
          }
        });
        sendWorld(room, res);
        sendIncidents(room, res);
        broadcast(room); return;
      }
      if (command === 'export' && req.method === 'GET') {
        authenticate(room, Object.fromEntries(url.searchParams));
        send(res, 200, { schemaVersion: 2, gameVersion: VERSION, startedAt: room.startedAt, exportedAt: new Date().toISOString(),
          mission: room.state.mission, build: room.state.build, snapshot: view(room), incidents: room.state.incidents,
          events: room.events, eventsTruncated: room.eventsTruncated,
          evidence: 'Gray-box observations only. Automated completion does not show that the game is fun, and it is not an MM-v2 score.' },
        { 'Content-Disposition': `attachment; filename="mountain-movers-v05-${room.id}.json"` }); return;
      }
      if (req.method !== 'POST' || !['input', 'action'].includes(command)) throw error(405, '这个操作不支持该请求方式。');
      const body = await jsonBody(req);
      const client = authenticate(room, body);
      if (command === 'input') {
        limit(client, 'input', 24);
        const input = {};
        for (const key of Object.keys(EMPTY_INPUT)) input[key] = body.input?.[key] === true;
        setInput(room.state, client.id, input);
        client.lastInput = Date.now();
        send(res, 200, { ok: true }); return;
      }
      limit(client, 'action', 12);
      if (!ALLOWED_ACTIONS.has(body.action)) throw error(400, '未知操作。');
      if (!room.clients.get(room.ownerId)?.streams.size) throw error(409, '等待公司主人重新连接。');
      if (OWNER_ACTIONS.has(body.action) && client.id !== room.ownerId) throw error(403, '请由公司主人确认。');
      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
      if (body.action === 'reset') {
        const selected = options({ mission: room.state.mission, build: room.state.build, ...payload });
        resetRoom(room, selected);
        send(res, 200, { ok: true, state: view(room), world: worldView(room.state) }); return;
      }
      const result = action(room.state, client.id, body.action, body.action === 'build' ? { build: payload.build } : {});
      record(room, 'action', { playerId: client.id, action: body.action, ok: result?.ok === true });
      sendIncidents(room);
      broadcast(room);
      send(res, 200, { ok: result?.ok === true, ...(result?.error ? { error: result.error } : {}), state: view(room) });
    } catch (e) {
      if (!res.headersSent) send(res, e.status ?? 500, { ok: false, error: e.status ? e.message : '服务发生错误，请重试。' });
      else res.end();
      if (!e.status) console.error(e);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  let tickCount = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      const hasConnection = [...room.clients.values()].some(p => p.streams.size);
      if (hasConnection) room.lastSeen = now;
      if (!hasConnection && now - room.lastSeen > 30 * 60_000) { rooms.delete(id); continue; }
      if (!room.opened && now - room.createdAt > unopenedRoomMs) { rooms.delete(id); continue; }
      // An owner who has been gone a while hands the company to someone still here, so nobody is stuck waiting.
      const owner = room.clients.get(room.ownerId);
      if (owner && !owner.streams.size && now - (owner.disconnectedAt ?? now) > ownerGrace) {
        const next = [...room.clients.values()].find(c => c !== owner && c.streams.size);
        if (next) {
          room.ownerId = next.id;
          owner.disconnectedAt = now; // the old owner gets the usual grace to come back as a member
          record(room, 'owner_changed', { from: owner.id, to: next.id });
          note(room.state, `${owner.name} 离开了一会儿，由 ${next.name} 接手做公司主人。`);
          broadcast(room);
        }
      }
      for (const client of room.clients.values()) {
        if (now - client.lastInput > 350) setInput(room.state, client.id, EMPTY_INPUT);
        if (client.id !== room.ownerId && client.disconnectedAt && now - client.disconnectedAt > memberGrace) {
          removePlayer(room.state, client.id);
          room.clients.delete(client.id);
          record(room, 'player_released', { playerId: client.id });
        }
      }
      if (room.clients.get(room.ownerId)?.streams.size) {
        const before = room.state.stats.rollovers, wasComplete = room.state.complete;
        step(room.state, 1 / 30);
        if (room.state.stats.rollovers !== before) record(room, 'rollover', { incident: room.state.incidents.at(-1)?.text });
        if (room.state.complete && !wasComplete) record(room, 'mission_complete', { stats: room.state.stats, review: room.state.review });
        sendIncidents(room);
      }
      if (tickCount % 3 === 0 && hasConnection) broadcast(room);
    }
    tickCount++;
  }, 1000 / 30);
  timer.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return { server, rooms, address: server.address(), close: async () => {
    clearInterval(timer);
    for (const room of rooms.values()) for (const client of room.clients.values()) for (const stream of client.streams) stream.end();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const value = (flag, fallback) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : fallback; };
  const host = value('--host', '127.0.0.1');
  const port = Number(value('--port', '4175'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  const running = await startServer({ host, port, trustProxy: process.argv.includes('--trust-proxy') });
  console.log(`Mountain Movers ${VERSION} gray box — http://127.0.0.1:${running.address.port}`);
  if (host === '0.0.0.0') console.log('LAN mode: share this computer\'s LAN address and port, then the room code. There is no public hosting or account service.');
  console.log('Ctrl+C closes the session. Export a playtest record from the menu before stopping.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await running.close(); process.exit(0); });
}
