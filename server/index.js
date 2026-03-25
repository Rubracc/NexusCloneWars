'use strict';
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const fs         = require('fs');

const GS = require('./gameState');
const AI = require('./ai');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const SAVE_FILE  = path.join(__dirname, '../save.json');

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = GS.defaultState();
GS.initDefaultMap(state);

// Load save if exists
if (fs.existsSync(SAVE_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    state = saved;
    console.log('✅ Sauvegarde chargée');
  } catch (e) {
    console.warn('⚠️  Sauvegarde corrompue, état par défaut');
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function broadcast(event, data) {
  io.emit(event, data);
}

function emitState(socket) {
  socket.emit('state', state);
}

function saveGame() {
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(state));
    console.log('💾 Sauvegarde OK');
  } catch (e) {
    console.error('❌ Erreur sauvegarde:', e.message);
  }
}

// ─── GAME LOOP ─────────────────────────────────────────────────────────────
// Fleet transit ticker (200ms)
setInterval(() => {
  const now = Date.now();
  const arrived = [];

  for (const [tid, transit] of Object.entries(state.fleets)) {
    const seg = transit.path[0];
    if (!seg) { arrived.push(tid); continue; }
    if (now - transit.segStart >= seg.dur) {
      transit.curFrom = seg.to;
      transit.path.shift();
      transit.segStart = now;
      if (!transit.path.length) arrived.push(tid);
    }
  }

  if (arrived.length) {
    arrived.forEach(tid => {
      const transit = state.fleets[tid];
      delete state.fleets[tid];
      if (transit) _arriveFleet(transit);
    });
    broadcast('state_delta', { fleets: state.fleets, planets: state.planets, eventLog: state.eventLog });
  }

  // Push fleet positions every 200ms if any in transit
  if (Object.keys(state.fleets).length > 0) {
    broadcast('fleets_tick', { fleets: state.fleets, ts: now });
  }
}, 200);

// Income ticker (1s)
let _lastIncome = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - _lastIncome) / 1000;
  _lastIncome = now;
  for (const faction of ['republic', 'separatist']) {
    state.credits[faction] = (state.credits[faction] || 0) + GS.calcIncome(state, faction) * dt;
  }
  broadcast('credits', { republic: Math.floor(state.credits.republic), separatist: Math.floor(state.credits.separatist) });
}, 1000);

// Construction ticker (500ms)
setInterval(() => {
  const now = Date.now();
  const done = state.constructionQueue.filter(c => now >= c.completionTime);
  if (!done.length) return;
  done.forEach(c => _completeConstruction(c));
  state.constructionQueue = state.constructionQueue.filter(c => now < c.completionTime);
  broadcast('state_delta', { constructionQueue: state.constructionQueue, planets: state.planets, eventLog: state.eventLog });
}, 500);

// AI ticker
let _lastAiTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const tickMs = state.settings.aiTickMs || 15000;
  if (now - _lastAiTick < tickMs) return;
  _lastAiTick = now;
  AI.aiTick(state, (event, data) => broadcast(event, data));
  broadcast('state_delta', { fleets: state.fleets, planets: state.planets, constructionQueue: state.constructionQueue, eventLog: state.eventLog });
}, 3000);

// Auto-save (every 30s)
setInterval(saveGame, 30000);

// ─── FLEET ARRIVAL ────────────────────────────────────────────────────────────
function _arriveFleet(transit) {
  const dest = state.planets[transit.dest];
  if (!dest) return;
  const fleet = transit.fleet;
  const domain = transit.domain || 'space';
  const arr = domain === 'ground' ? dest.groundFleets : dest.spaceFleets;
  const isEnemy = dest.owner !== fleet.faction && dest.owner !== 'neutral';

  if (isEnemy && state.settings.combatEnabled) {
    const result = GS.resolveCombat(state, fleet, dest, domain);
    const msg = result.won
      ? result.captured
        ? `⚔️ <b>${dest.name}</b> conquise par ${result.attacker}! (${result.atkPow} vs ${result.defPow})`
        : `⚔️ Victoire à <b>${dest.name}</b> (${result.atkPow} vs ${result.defPow})`
      : `💀 ${fleet.name} détruite à <b>${dest.name}</b> (${result.atkPow} vs ${result.defPow})`;
    GS.addEvent(state, result.won ? (result.captured ? 'conquest' : 'battle') : 'battle', msg);
    broadcast('combat_result', { result, planet: dest });
  } else {
    const slot = arr.findIndex(x => !x);
    if (slot !== -1) arr[slot] = fleet; else arr.push(fleet);
    GS.addEvent(state, 'move', `✅ ${fleet.name} arrivé à <b>${dest.name}</b>`);
  }
}

// ─── CONSTRUCTION COMPLETE ───────────────────────────────────────────────────
function _completeConstruction(c) {
  const planet = state.planets[c.planetId];
  if (!planet) return;

  if (c.type === 'unit') {
    const u = state.unitTypes[c.unitTypeId];
    if (!u) return;
    const arr = u.domain === 'space' ? planet.spaceFleets : planet.groundFleets;
    let tgt = arr.find(f => f && f.faction === c.faction && f.name === c.fn);
    if (!tgt) {
      const slot = arr.findIndex(x => !x);
      if (slot !== -1) {
        arr[slot] = { id: GS.uuid(), name: c.fn || u.name + ' Fleet', faction: c.faction, units: {} };
        tgt = arr[slot];
      } else return;
    }
    tgt.units[c.unitTypeId] = (tgt.units[c.unitTypeId] || 0) + 1;
    GS.addEvent(state, 'build', `🔨 ${u.name} construit à <b>${planet.name}</b>`);
  } else if (c.type === 'building') {
    const b = state.buildingTypes[c.buildingTypeId];
    if (!b) return;
    const arr = b.domain === 'space' ? planet.spaceBuildings : planet.groundBuildings;
    const slot = arr.findIndex(x => !x);
    if (slot !== -1) arr[slot] = { id: GS.uuid(), type: b.id, name: b.name };
    GS.addEvent(state, 'build', `🏗️ ${b.name} construite à <b>${planet.name}</b>`);
  }
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`🔌 Connexion: ${socket.id} (${ip})`);

  // Send full state on connect
  emitState(socket);

  // ── AUTH ──────────────────────────────────────────────────────────────────
  socket.on('auth', ({ password }, cb) => {
    if (password === ADMIN_PASS) {
      socket.isAdmin = true;
      socket.join('admins');
      cb({ ok: true, role: 'admin' });
      console.log(`🔑 Admin authentifié: ${socket.id}`);
    } else {
      cb({ ok: false, error: 'Mot de passe incorrect' });
    }
  });

  // ── MOVE FLEET ────────────────────────────────────────────────────────────
  socket.on('move_fleet', ({ planetId, fleetId, domain, destId }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });

    const planet = state.planets[planetId];
    if (!planet) return cb?.({ ok: false, error: 'Planète introuvable' });

    const arr = domain === 'space' ? planet.spaceFleets : planet.groundFleets;
    const fleetIdx = arr.findIndex(f => f && f.id === fleetId);
    if (fleetIdx === -1) return cb?.({ ok: false, error: 'Flotte introuvable' });

    const fleet = arr[fleetIdx];
    const path = GS.findPath(state, planetId, destId, fleet.faction);
    if (!path || !path.length) return cb?.({ ok: false, error: 'Aucune route disponible' });

    arr[fleetIdx] = null;
    const pathD = path.map(seg => {
      const hl = GS.getHL(state, seg.from, seg.to);
      return { ...seg, dur: GS.travelMs(state, seg.from, seg.to, hl?.type || 'medium') };
    });
    const totalMs = pathD.reduce((s, seg) => s + seg.dur, 0);

    const transit = {
      id: GS.uuid(), fleet, path: pathD,
      start: Date.now(), totalMs,
      segStart: Date.now(), curFrom: planetId,
      dest: destId, domain
    };
    state.fleets[transit.id] = transit;
    fleet.domain = domain;

    GS.addEvent(state, 'move',
      `🚀 ${fleet.name}: ${planet.name} → ${state.planets[destId]?.name || '?'}`);

    broadcast('fleet_dispatched', { transit, fromPlanet: planetId });
    broadcast('state_delta', { planets: state.planets, fleets: state.fleets, eventLog: state.eventLog });
    cb?.({ ok: true, transitId: transit.id });
  });

  // ── BUILD ─────────────────────────────────────────────────────────────────
  socket.on('build', ({ planetId, type, itemId, qty = 1, free = false }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });

    const planet = state.planets[planetId];
    if (!planet) return cb?.({ ok: false, error: 'Planète introuvable' });

    const item = type === 'unit' ? state.unitTypes[itemId] : state.buildingTypes[itemId];
    if (!item) return cb?.({ ok: false, error: 'Item introuvable' });

    const faction = planet.owner !== 'neutral' ? planet.owner : 'republic';
    const cost = (item.cost || 0) * qty;

    if (!free && (state.credits[faction] || 0) < cost) {
      return cb?.({ ok: false, error: 'Crédits insuffisants' });
    }
    if (!free) state.credits[faction] -= cost;

    for (let i = 0; i < qty; i++) {
      if (type === 'building' && i > 0) break;
      const c = {
        id: GS.uuid(), type, planetId, faction,
        unitTypeId: type === 'unit' ? itemId : undefined,
        buildingTypeId: type === 'building' ? itemId : undefined,
        startTime: Date.now(),
        completionTime: Date.now() + (item.buildTime || 10) * 1000,
        fn: planet.name + ' Fleet'
      };
      state.constructionQueue.push(c);
    }

    broadcast('state_delta', { constructionQueue: state.constructionQueue, credits: { republic: Math.floor(state.credits.republic), separatist: Math.floor(state.credits.separatist) } });
    cb?.({ ok: true });
  });

  // ── SET PLANET ────────────────────────────────────────────────────────────
  socket.on('set_planet', (data, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    const p = state.planets[data.id];
    if (!p) return cb?.({ ok: false, error: 'Planète introuvable' });
    Object.assign(p, data);
    broadcast('state_delta', { planets: state.planets });
    cb?.({ ok: true });
  });

  // ── ADD PLANET ────────────────────────────────────────────────────────────
  socket.on('add_planet', (data, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    const p = GS.makePlanet(data);
    state.planets[p.id] = p;
    broadcast('state_delta', { planets: state.planets });
    cb?.({ ok: true, id: p.id });
  });

  // ── DELETE PLANET ─────────────────────────────────────────────────────────
  socket.on('delete_planet', ({ id }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    delete state.planets[id];
    state.hyperlanes = state.hyperlanes.filter(l => l.from !== id && l.to !== id);
    broadcast('state_delta', { planets: state.planets, hyperlanes: state.hyperlanes });
    cb?.({ ok: true });
  });

  // ── ADD HYPERLANE ─────────────────────────────────────────────────────────
  socket.on('add_hyperlane', ({ from, to, type }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    const exists = state.hyperlanes.find(l =>
      (l.from === from && l.to === to) || (l.from === to && l.to === from));
    if (exists) return cb?.({ ok: false, error: 'Route déjà existante' });
    state.hyperlanes.push({ from, to, type: type || 'medium' });
    broadcast('state_delta', { hyperlanes: state.hyperlanes });
    cb?.({ ok: true });
  });

  // ── DELETE HYPERLANE ──────────────────────────────────────────────────────
  socket.on('delete_hyperlane', ({ from, to }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    state.hyperlanes = state.hyperlanes.filter(l =>
      !((l.from === from && l.to === to) || (l.from === to && l.to === from)));
    broadcast('state_delta', { hyperlanes: state.hyperlanes });
    cb?.({ ok: true });
  });

  // ── SET FLEET (admin override) ────────────────────────────────────────────
  socket.on('set_fleet', ({ planetId, domain, slotIdx, fleet }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    const p = state.planets[planetId];
    if (!p) return cb?.({ ok: false, error: 'Planète introuvable' });
    const arr = domain === 'space' ? p.spaceFleets : p.groundFleets;
    arr[slotIdx] = fleet;
    broadcast('state_delta', { planets: state.planets });
    cb?.({ ok: true });
  });

  // ── CANCEL CONSTRUCTION ───────────────────────────────────────────────────
  socket.on('cancel_construction', ({ id }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    const idx = state.constructionQueue.findIndex(c => c.id === id);
    if (idx === -1) return cb?.({ ok: false, error: 'Introuvable' });
    const c = state.constructionQueue[idx];
    const item = c.type === 'unit' ? state.unitTypes[c.unitTypeId] : state.buildingTypes[c.buildingTypeId];
    state.credits[c.faction] = (state.credits[c.faction] || 0) + Math.floor((item?.cost || 0) * 0.5);
    state.constructionQueue.splice(idx, 1);
    broadcast('state_delta', { constructionQueue: state.constructionQueue, credits: { republic: Math.floor(state.credits.republic), separatist: Math.floor(state.credits.separatist) } });
    cb?.({ ok: true });
  });

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  socket.on('set_settings', (settings, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false, error: 'Non autorisé' });
    Object.assign(state.settings, settings);
    broadcast('state_delta', { settings: state.settings });
    cb?.({ ok: true });
  });

  // ── CHAT / ANNOUNCE ───────────────────────────────────────────────────────
  socket.on('announce', ({ msg }, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false });
    GS.addEvent(state, 'announce', `📢 <b>GM:</b> ${msg}`);
    broadcast('announce', { msg });
    broadcast('state_delta', { eventLog: state.eventLog });
    cb?.({ ok: true });
  });

  // ── SAVE / RESET ──────────────────────────────────────────────────────────
  socket.on('save', (_, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false });
    saveGame();
    cb?.({ ok: true });
  });

  socket.on('reset', (_, cb) => {
    if (!socket.isAdmin) return cb?.({ ok: false });
    state = GS.defaultState();
    GS.initDefaultMap(state);
    broadcast('state', state);
    cb?.({ ok: true });
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`🔌 Déconnexion: ${socket.id}`);
  });
});

// ─── STATIC FILES ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/viewer.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../client/admin.html')));

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Republic at War Server`);
  console.log(`   Port     : ${PORT}`);
  console.log(`   Admin    : http://localhost:${PORT}/admin`);
  console.log(`   Joueurs  : http://localhost:${PORT}/`);
  console.log(`   Password : ${ADMIN_PASS}\n`);
});
