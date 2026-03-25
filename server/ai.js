'use strict';
const GS = require('./gameState');

// ─── AI DIFFICULTY ───────────────────────────────────────────────────────────
const DIFFICULTY = {
  easy:   { aggression: 0.3, buildRate: 0.5, expandRate: 0.4 },
  medium: { aggression: 0.6, buildRate: 0.8, expandRate: 0.7 },
  hard:   { aggression: 0.9, buildRate: 1.0, expandRate: 1.0 }
};

// ─── MAIN AI TICK ────────────────────────────────────────────────────────────
function aiTick(state, emit) {
  if (!state.settings.aiEnabled) return;

  const faction = 'separatist';
  const diff = DIFFICULTY[state.settings.aiDifficulty || 'medium'];
  const credits = state.credits[faction] || 0;

  const myPlanets = Object.values(state.planets).filter(p => p.owner === faction);
  const neutralPlanets = Object.values(state.planets).filter(p => p.owner === 'neutral');
  const enemyPlanets = Object.values(state.planets).filter(p => p.owner === 'republic');

  // ── 1. BUILD UNITS on planets with shipyards/factories ──────────────────
  if (Math.random() < diff.buildRate) {
    _buildUnits(state, faction, myPlanets, credits, emit);
  }

  // ── 2. BUILD INFRASTRUCTURE ──────────────────────────────────────────────
  if (Math.random() < diff.buildRate * 0.5) {
    _buildInfra(state, faction, myPlanets, credits, emit);
  }

  // ── 3. EXPAND to neutral planets ─────────────────────────────────────────
  if (Math.random() < diff.expandRate && neutralPlanets.length > 0) {
    _expand(state, faction, myPlanets, neutralPlanets, emit);
  }

  // ── 4. ATTACK republic planets ───────────────────────────────────────────
  if (Math.random() < diff.aggression && enemyPlanets.length > 0) {
    _attack(state, faction, myPlanets, enemyPlanets, emit);
  }

  // ── 5. REINFORCE weak planets ────────────────────────────────────────────
  _reinforce(state, faction, myPlanets, emit);
}

// ─── BUILD UNITS ─────────────────────────────────────────────────────────────
function _buildUnits(state, faction, myPlanets, credits, emit) {
  const buildable = Object.values(state.unitTypes).filter(u => u.faction === faction);

  for (const planet of myPlanets) {
    const allBuildings = [...planet.spaceBuildings, ...planet.groundBuildings];
    for (const u of buildable) {
      if (credits < u.cost) continue;
      // Check required building
      if (u.req && !allBuildings.some(b => b?.type === u.req)) continue;
      // Don't queue too many
      const alreadyQueued = state.constructionQueue.filter(
        c => c.planetId === planet.id && c.type === 'unit' && c.unitTypeId === u.id
      ).length;
      if (alreadyQueued >= 2) continue;

      state.credits[faction] -= u.cost;
      const c = {
        id: GS.uuid(), type: 'unit', planetId: planet.id, faction,
        unitTypeId: u.id,
        startTime: Date.now(),
        completionTime: Date.now() + (u.buildTime || 10) * 1000,
        fn: planet.name + ' Fleet'
      };
      state.constructionQueue.push(c);
      emit('construction_started', { construction: c, planetId: planet.id });
      return; // One build per tick
    }
  }
}

// ─── BUILD INFRASTRUCTURE ────────────────────────────────────────────────────
function _buildInfra(state, faction, myPlanets, credits, emit) {
  const bldgs = Object.values(state.buildingTypes).filter(b => b.faction === faction);
  for (const planet of myPlanets) {
    const allSlots = [...planet.spaceBuildings, ...planet.groundBuildings];
    const hasEmpty = allSlots.some(b => !b);
    if (!hasEmpty) continue;
    for (const b of bldgs) {
      if (credits < b.cost) continue;
      const already = allSlots.some(sl => sl?.type === b.id);
      if (already) continue;
      state.credits[faction] -= b.cost;
      const c = {
        id: GS.uuid(), type: 'building', planetId: planet.id, faction,
        buildingTypeId: b.id,
        startTime: Date.now(),
        completionTime: Date.now() + (b.buildTime || 30) * 1000
      };
      state.constructionQueue.push(c);
      emit('construction_started', { construction: c, planetId: planet.id });
      return;
    }
  }
}

// ─── EXPAND ──────────────────────────────────────────────────────────────────
function _expand(state, faction, myPlanets, neutralPlanets, emit) {
  // Find my planet with a space fleet adjacent to a neutral planet
  for (const planet of myPlanets) {
    const fleet = planet.spaceFleets.find(f => f && f.faction === faction);
    if (!fleet) continue;
    for (const neutral of neutralPlanets) {
      const path = GS.findPath(state, planet.id, neutral.id, faction);
      if (path && path.length > 0 && path.length <= 3) {
        _dispatchFleet(state, planet, fleet, 'space', neutral.id, emit);
        return;
      }
    }
  }
}

// ─── ATTACK ──────────────────────────────────────────────────────────────────
function _attack(state, faction, myPlanets, enemyPlanets, emit) {
  // Find strongest fleet, pick weakest enemy target
  let bestFleet = null, bestPlanet = null, bestPath = null;

  for (const planet of myPlanets) {
    const fleet = planet.spaceFleets.find(f => f && f.faction === faction);
    if (!fleet) continue;
    const myPow = GS.fleetPower ? 0 : Object.values(fleet.units || {}).reduce((s, v) => s + v, 0);

    // Find reachable enemy planets
    for (const target of enemyPlanets) {
      const path = GS.findPath(state, planet.id, target.id, faction);
      if (!path) continue;
      if (!bestPath || path.length < bestPath.length) {
        bestFleet = fleet;
        bestPlanet = planet;
        bestPath = path;
      }
    }
  }

  if (bestFleet && bestPath) {
    const destId = bestPath[bestPath.length - 1].to;
    _dispatchFleet(state, bestPlanet, bestFleet, 'space', destId, emit);
  }
}

// ─── REINFORCE ───────────────────────────────────────────────────────────────
function _reinforce(state, faction, myPlanets, emit) {
  // Move surplus fleets from safe planets to frontline (adjacent to enemy)
  const frontline = myPlanets.filter(p => {
    return GS.getConns(state, p.id).some(cid => {
      const cp = state.planets[cid];
      return cp && cp.owner !== faction && cp.owner !== 'neutral';
    });
  });
  if (!frontline.length) return;

  // Find a safe planet with multiple fleets
  for (const planet of myPlanets) {
    const fleets = planet.spaceFleets.filter(f => f && f.faction === faction);
    if (fleets.length < 2) continue;
    const isFrontline = frontline.includes(planet);
    if (isFrontline) continue;

    // Send extra fleet to nearest frontline
    const target = frontline.sort((a, b) => {
      const da = Math.hypot(planet.x - a.x, planet.y - a.y);
      const db = Math.hypot(planet.x - b.x, planet.y - b.y);
      return da - db;
    })[0];
    if (!target) continue;
    const path = GS.findPath(state, planet.id, target.id, faction);
    if (path) {
      _dispatchFleet(state, planet, fleets[1], 'space', target.id, emit);
      return;
    }
  }
}

// ─── DISPATCH FLEET (shared with server) ─────────────────────────────────────
function _dispatchFleet(state, planet, fleet, domain, destId, emit) {
  const arr = domain === 'space' ? planet.spaceFleets : planet.groundFleets;
  const idx = arr.findIndex(f => f && f.id === fleet.id);
  if (idx === -1) return;
  arr[idx] = null;

  const path = GS.findPath(state, planet.id, destId, fleet.faction);
  if (!path || !path.length) { arr[idx] = fleet; return; }

  const pathD = path.map(seg => {
    const hl = GS.getHL(state, seg.from, seg.to);
    return { ...seg, dur: GS.travelMs(state, seg.from, seg.to, hl?.type || 'medium') };
  });
  const totalMs = pathD.reduce((s, seg) => s + seg.dur, 0);

  const transit = {
    id: GS.uuid(), fleet, path: pathD,
    start: Date.now(), totalMs,
    segStart: Date.now(), curFrom: planet.id,
    dest: destId, domain
  };
  state.fleets[transit.id] = transit;

  GS.addEvent(state, 'move',
    `🤖 IA: ${fleet.name} de ${planet.name} → ${state.planets[destId]?.name || '?'}`);
  emit('fleet_dispatched', { transit, fromPlanet: planet.id });
}

module.exports = { aiTick };
