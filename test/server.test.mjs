// The HTTP boundary of the v0.5 gray box, exercised against the real server on an
// ephemeral port: rooms and credentials, the SSE stream, ownership, input leases,
// rate limits, failed actions, exports, the static whitelist and request validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';

const HEX48 = /^[a-f0-9]{48}$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Polls `check` until it returns something truthy; fails after `ms` instead of hanging. */
async function waitFor(check, label, ms = 3000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out after ${ms} ms waiting for ${label}`);
    await sleep(10);
  }
}

/** One SSE block: an optional ": comment", "event: name" and "data: json". */
function parseFrame(block) {
  const frame = { event: 'message', data: '', comment: null };
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
    else if (line.startsWith('data:')) frame.data += line.slice(5).trimStart();
  }
  return frame;
}

function httpClient(running) {
  const base = `http://127.0.0.1:${running.address.port}`;
  const call = async (path, init) => {
    const response = await fetch(base + path, init);
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, headers: response.headers, text, body };
  };
  const post = (path, body, headers = {}) =>
    call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  /** Status only, body discarded unread: an event stream that should have been refused cannot hang the test. */
  const peek = async path => {
    const response = await fetch(base + path);
    await response.body?.cancel();
    return response.status;
  };
  return { base, call, post, peek };
}

test('rooms enforce options, streams, capacity, credentials, ownership, input leases, rate limits, failed actions and export', { timeout: 15_000 }, async () => {
  const running = await startServer({ port: 0 });
  const { base, call, post, peek } = httpClient(running);
  const streams = [];
  /** Opens a player's event stream and keeps reading it in the background, so it never backs up. */
  const openEvents = async (roomId, { playerId, token }) => {
    const controller = new AbortController();
    streams.push(controller);
    const response = await fetch(`${base}/api/rooms/${roomId}/events?playerId=${playerId}&token=${token}`, { signal: controller.signal });
    const frames = [];
    const reader = response.body.getReader();
    const reading = (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            frames.push(parseFrame(buffer.slice(0, end)));
            buffer = buffer.slice(end + 2);
          }
        }
      } catch { /* aborted by the test */ }
    })();
    const parsed = event => frames.filter(f => f.event === event).map(f => JSON.parse(f.data));
    return { response, frames, parsed, reading, close: () => controller.abort() };
  };
  const room = id => running.rooms.get(id);
  // Look the player up on every call: a reset replaces room.state.
  const player = (roomId, playerId) => room(roomId).state.players.find(p => p.id === playerId);

  try {
    // 1. Creating a room: credentials, ownership, a state without the map, the map on its own, option fallbacks.
    const create = await post('/api/rooms', { name: '测试司机', mission: 'b2', build: 'standard' });
    assert.equal(create.status, 201);
    const host = create.body;
    assert.match(host.roomId, /^[A-F0-9]{6}$/);
    assert.match(host.token, HEX48);
    assert.equal(host.ownerId, host.playerId);
    assert.equal(host.state.ownerId, host.playerId);
    assert.equal(host.state.roomId, host.roomId);
    assert.equal(host.state.run, 1);
    assert.equal(host.state.gameVersion, '0.5.0');
    assert.equal(host.state.paused, true, 'nothing runs before the owner opens a stream');
    assert.equal(host.state.mission, 'b2');
    assert.equal(host.state.build, 'standard');
    assert.deepEqual(host.state.players.map(p => [p.id, p.name]), [[host.playerId, '测试司机']]);
    assert.equal(Object.hasOwn(host.state, 'world'), false, 'static map data travels apart from the state');
    assert.equal(host.world.mission, 'b2');
    assert.ok(Array.isArray(host.world.roads) && host.world.roads.length > 0);
    assert.ok(!JSON.stringify(host.state).includes(host.token), 'the token never enters game state');

    const chosen = await post('/api/rooms', { name: ' 低\u0007货台 ', mission: 'o6', build: 'lowbed' });
    assert.equal(chosen.status, 201);
    assert.equal(chosen.body.state.mission, 'o6');
    assert.equal(chosen.body.state.build, 'lowbed');
    assert.equal(chosen.body.world.mission, 'o6');
    assert.equal(chosen.body.state.players[0].name, '低货台', 'control characters and padding are stripped from names');
    const fallback = await post('/api/rooms', { mission: 'delivery', build: 'side' });
    assert.equal(fallback.status, 201);
    assert.equal(fallback.body.state.mission, 'b2', 'an unknown mission falls back to b2');
    assert.equal(fallback.body.state.build, 'standard', 'an unknown build falls back to standard');
    assert.equal(fallback.body.state.players[0].name, '搬家伙伴');
    assert.equal(new Set([host.roomId, chosen.body.roomId, fallback.body.roomId]).size, 3);

    const root = `/api/rooms/${host.roomId}`;
    const hostCreds = { playerId: host.playerId, token: host.token };
    assert.equal((await post(`${root}/action`, { ...hostCreds, action: 'interact' })).status, 409, 'actions wait for the owner stream');

    // 2. The owner's event stream: a comment, then the map, then the state.
    const hostEvents = await openEvents(host.roomId, host);
    assert.equal(hostEvents.response.status, 200);
    assert.match(hostEvents.response.headers.get('content-type'), /^text\/event-stream/);
    await waitFor(() => hostEvents.frames.some(f => f.event === 'world') && hostEvents.frames.some(f => f.event === 'state'),
      'a world frame and a state frame on the owner stream');
    const kinds = hostEvents.frames.map(f => f.event);
    assert.equal(hostEvents.frames[0].comment, 'connected');
    assert.ok(kinds.indexOf('world') < kinds.indexOf('state'), 'the map arrives before the first state');
    const [firstWorld] = hostEvents.parsed('world');
    assert.equal(firstWorld.run, 1);
    assert.equal(firstWorld.world.mission, 'b2');
    assert.ok(Array.isArray(firstWorld.world.roads) && firstWorld.world.roads.length > 0);
    const firstState = JSON.parse(hostEvents.frames.find(f => f.event === 'state').data);
    assert.equal(firstState.roomId, host.roomId);
    assert.equal(firstState.paused, false, 'the owner stream unpauses the room');
    assert.deepEqual(firstState.connections, [{ id: host.playerId, online: true }]);
    assert.equal(Object.hasOwn(firstState, 'world'), false);

    // 3. Four players at most; unknown rooms are 404.
    const guests = [];
    for (let i = 1; i <= 3; i++) {
      const joined = await post(`${root}/join`, { name: `伙伴${i}` });
      assert.equal(joined.status, 201);
      assert.match(joined.body.token, HEX48);
      assert.equal(joined.body.roomId, host.roomId);
      assert.equal(joined.body.ownerId, host.playerId);
      assert.ok(Array.isArray(joined.body.world.roads));
      guests.push(joined.body);
    }
    const fifth = await post(`${root}/join`, { name: '第五位' });
    assert.equal(fifth.status, 409);
    assert.equal(fifth.body.ok, false);
    const everyone = [host, ...guests];
    assert.equal(new Set(everyone.map(p => p.playerId)).size, 4);
    assert.equal(new Set(everyone.map(p => p.token)).size, 4);
    assert.equal(room(host.roomId).state.players.length, 4);
    const missing = ['000000', '111111', '222222', '333333'].find(id => !running.rooms.has(id));
    assert.equal((await post(`/api/rooms/${missing}/join`, { name: '迷路' })).status, 404, 'an unknown room id is 404');

    // 4. Credentials and origin.
    const [guest, flooder] = guests;
    const guestCreds = { playerId: guest.playerId, token: guest.token };
    const probe = (creds, headers) => post(`${root}/input`, { ...creds, input: {} }, headers);
    assert.equal((await probe({ playerId: host.playerId, token: 'wrong' })).status, 401);
    assert.equal((await probe({ playerId: host.playerId, token: '中'.repeat(48) })).status, 401, '48 non-hex characters are refused, not handed to timingSafeEqual');
    assert.equal((await probe({ playerId: host.playerId, token: '0'.repeat(48) })).status, 401);
    assert.equal((await probe({ playerId: host.playerId, token: guest.token })).status, 401, "another player's token is not this player's");
    assert.equal((await probe({ playerId: 'nobody', token: host.token })).status, 401);
    assert.equal((await probe(hostCreds, { Origin: 'https://elsewhere.example' })).status, 403, 'cross-origin requests are refused');
    assert.equal((await probe(hostCreds, { Origin: base })).status, 200, 'same-origin requests pass');
    assert.equal(await peek(`${root}/events?playerId=${host.playerId}&token=${guest.token}`), 401, 'streams need credentials too');
    assert.equal((await call('/api/health')).body?.ok, true, 'the server survives malformed credentials');

    // 5. Unknown actions, owner-only actions, and the owner's reset.
    assert.equal((await post(`${root}/action`, { ...hostCreds, action: 'teleport', payload: { x: 10 } })).status, 400);
    for (const action of ['reset', 'build']) {
      const denied = await post(`${root}/action`, { ...guestCreds, action, payload: { mission: 'o6', build: 'lowbed' } });
      assert.equal(denied.status, 403, `a guest may not ${action}`);
    }
    assert.equal(room(host.roomId).run, 1);
    assert.equal(room(host.roomId).state.build, 'standard');
    // Positive control for (8): the main truck starts empty in the old plaza, so the owner may change its build.
    const build = await post(`${root}/action`, { ...hostCreds, action: 'build', payload: { build: 'lowbed' } });
    assert.equal(build.status, 200);
    assert.equal(build.body.ok, true, 'a successful engine action is reported as successful');
    assert.equal(build.body.state.build, 'lowbed');
    const reset = await post(`${root}/action`, { ...hostCreds, action: 'reset', payload: { mission: 'o6' } });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.ok, true);
    assert.equal(reset.body.state.mission, 'o6');
    assert.equal(reset.body.state.build, 'lowbed', 'a reset keeps the options its payload leaves out');
    assert.equal(reset.body.state.players.length, 4);
    assert.deepEqual(reset.body.state.players.map(p => p.id).sort(), everyone.map(p => p.playerId).sort());
    assert.equal(reset.body.state.run, 2);
    assert.equal(room(host.roomId).run, 2, 'a reset starts a new run');
    assert.equal(reset.body.world.mission, 'o6');
    const secondWorld = await waitFor(() => hostEvents.parsed('world').find(w => w.run === 2), 'the run 2 map on the owner stream');
    assert.equal(secondWorld.world.mission, 'o6');

    // 6. Input leases. Only a literal true presses a key; held keys are released ~350 ms after the
    //    last input. The release runs on every tick whether or not a room steps: the o6 room's owner
    //    never connected, so that room stays paused throughout.
    const paused = chosen.body;
    const statesBefore = hostEvents.frames.filter(f => f.event === 'state').length;
    const leaseStart = Date.now();
    assert.equal((await post(`${root}/input`, { ...hostCreds, input: { up: true, down: 'true', left: 1 } })).status, 200);
    assert.equal((await post(`/api/rooms/${paused.roomId}/input`, { playerId: paused.playerId, token: paused.token, input: { right: true, brake: 'yes' } })).status, 200);
    assert.deepEqual(player(host.roomId, host.playerId).input, { up: true, down: false, left: false, right: false, brake: false });
    assert.deepEqual(player(paused.roomId, paused.playerId).input, { up: false, down: false, left: false, right: true, brake: false });
    await waitFor(() => !player(host.roomId, host.playerId).input.up && !player(paused.roomId, paused.playerId).input.right,
      'held keys to be released', 1500);
    assert.ok(Date.now() - leaseStart > 350, 'keys stay held for the length of the lease');
    assert.equal(room(paused.roomId).state.time, 0, 'a room whose owner is offline does not step');
    assert.ok(room(host.roomId).state.time > 0, 'a room whose owner is online steps');
    // Input posts broadcast nothing, so new state frames here come from the tick's periodic broadcast.
    await waitFor(() => hostEvents.frames.filter(f => f.event === 'state').length >= statesBefore + 2, 'periodic state frames', 1500);
    const ticked = hostEvents.frames.filter(f => f.event === 'state').slice(statesBefore).map(f => JSON.parse(f.data));
    assert.ok(ticked.at(-1).time > ticked[0].time, 'each broadcast carries the advancing room clock');

    // 7. Rate limiting: more than 24 inputs a second from one client.
    let accepted = 0, refused = null;
    const floodStart = Date.now();
    while (!refused && accepted < 100) {
      const sent = await post(`${root}/input`, { playerId: flooder.playerId, token: flooder.token, input: { right: true } });
      if (sent.status === 200) accepted++; else refused = sent;
    }
    assert.equal(refused?.status, 429, 'an input flood is refused');
    assert.equal(refused.body.ok, false);
    assert.ok(accepted >= 24, `up to 24 inputs a second are accepted (accepted ${accepted})`);
    // When the whole flood fits in one one-second window, exactly 24 get through; a very slow run may straddle two.
    if (Date.now() - floodStart <= 1000) assert.equal(accepted, 24, 'the 25th input inside a second is refused');

    // 8. A failed engine action is reported as failed: rotating while holding nothing.
    const rotate = await post(`${root}/action`, { ...hostCreds, action: 'rotate' });
    assert.equal(rotate.status, 200);
    assert.equal(rotate.body.ok, false, 'a failed engine action must not be reported as successful');
    assert.equal(typeof rotate.body.error, 'string');
    assert.ok(rotate.body.error.length > 0);

    // 9. Export: the playtest record, without credentials.
    const exported = await call(`${root}/export?playerId=${host.playerId}&token=${host.token}`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /^application\/json/);
    assert.equal(exported.headers.get('content-disposition'), `attachment; filename="mountain-movers-v05-${host.roomId}.json"`);
    for (const participant of [...everyone, paused, fallback.body]) {
      assert.ok(!exported.text.includes(participant.token), 'credentials must not enter exported playtests');
    }
    const record = exported.body;
    assert.equal(record.gameVersion, '0.5.0');
    assert.equal(record.mission, 'o6');
    assert.equal(record.snapshot.run, 2);
    assert.ok(Array.isArray(record.incidents));
    assert.ok(record.events.some(e => e.type === 'session_reset' && e.mission === 'o6' && e.build === 'lowbed'));
    assert.equal(record.events.filter(e => e.type === 'player_joined').length, 4);
    assert.ok(record.events.some(e => e.type === 'action' && e.action === 'rotate' && e.ok === false));
    assert.equal((await call(`${root}/export?playerId=${host.playerId}&token=${guest.token}`)).status, 401);
    const fallbackRecord = (await call(`/api/rooms/${fallback.body.roomId}/export?playerId=${fallback.body.playerId}&token=${fallback.body.token}`)).body;
    const created = fallbackRecord.events.find(e => e.type === 'session_created');
    assert.deepEqual([created.mission, created.build], ['b2', 'standard'], 'the log records the options actually used, not the raw request');
    assert.ok(hostEvents.frames.every(f => everyone.every(p => !f.data.includes(p.token))), 'credentials never travel on the stream');
    assert.equal((await call(`${root}/input`)).status, 405, 'input is POST only');

    // The owner leaving pauses the room again.
    hostEvents.close();
    await waitFor(() => room(host.roomId).clients.get(host.playerId).streams.size === 0, 'the server to drop the closed stream');
    const frozen = room(host.roomId).state.time;
    await sleep(120);
    assert.equal(room(host.roomId).state.time, frozen, 'no owner stream, no steps');
    assert.equal((await post(`${root}/action`, { ...guestCreds, action: 'interact' })).status, 409);
  } finally {
    for (const stream of streams) stream.abort();
    await running.close();
  }
});

test('only whitelisted files are served; health, preview and malformed requests', { timeout: 10_000 }, async () => {
  const running = await startServer({ port: 0 });
  const { call, post, peek } = httpClient(running);
  try {
    // 10. Static files come from the STATIC whitelist only (geom.mjs is shared with the browser).
    const home = await call('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /^text\/html/);
    assert.match(home.text, /<html/i);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.match(home.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const geom = await call('/geom.mjs');
    assert.equal(geom.status, 200, 'geom.mjs is whitelisted for the browser');
    assert.match(geom.headers.get('content-type'), /^text\/javascript/);
    for (const hidden of ['/server.mjs', '/sim.mjs', '/maps.mjs', '/package.json', '/.gitignore', '/test/server.test.mjs', '/test/helpers.mjs']) {
      assert.equal((await call(hidden)).status, 404, `${hidden} must not be served`);
    }

    // 11. Health and preview; a preview opens no room.
    const health = await call('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.version, '0.5.0');
    const preview = await call('/api/preview?mission=o6');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.state.mission, 'o6');
    assert.equal(preview.body.world.mission, 'o6');
    assert.ok(Array.isArray(preview.body.world.roads) && preview.body.world.roads.length > 0);
    assert.equal(Object.hasOwn(preview.body.state, 'world'), false);
    const unknown = await call('/api/preview?mission=boss&build=lowbed');
    assert.equal(unknown.body.state.mission, 'b2');
    assert.equal(unknown.body.state.build, 'lowbed');
    assert.equal(running.rooms.size, 0, 'previews open no rooms');

    // 12. Unknown rooms and malformed bodies.
    assert.equal((await post('/api/rooms/ABC123/join', { name: '迷路' })).status, 404);
    assert.equal(await peek(`/api/rooms/ABC123/events?playerId=x&token=${'0'.repeat(48)}`), 404);
    const raw = (body, type = 'application/json') => call('/api/rooms', { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal((await raw('{"name":')).status, 400, 'malformed JSON');
    assert.equal((await raw('null')).status, 400, 'JSON that is not an object');
    assert.equal((await raw('[]')).status, 400);
    assert.equal((await raw('{"name":"x"}', 'text/plain')).status, 415);
    assert.equal((await post('/api/rooms', { name: 'x'.repeat(9000) })).status, 413);
    assert.equal(running.rooms.size, 0, 'rejected requests open no rooms');
  } finally {
    await running.close();
  }
});
