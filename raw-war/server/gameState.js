'use strict';
const { v4: uuid } = require('uuid');

// ─── DEFAULT DATA ────────────────────────────────────────────────────────────
function defaultState() {
  return {
    tick: 0,
    credits: { republic: 50000, separatist: 30000 },
    settings: {
      mapW: 4000, mapH: 3000,
      incomeOn: true, incomeRate: 0.5,
      travelSpeed: 0.025,
      combatEnabled: true,
      aiEnabled: true,
      aiTickMs: 15000
    },
    factions: {
      republic:   { id: 'republic',   name: 'République',   color: '#2196f3', icon: '⚙' },
      separatist: { id: 'separatist', name: 'Séparatistes', color: '#e53935', icon: '⚡' },
      neutral:    { id: 'neutral',    name: 'Neutre',       color: '#607d8b', icon: '◯' }
    },
    unitTypes: {
      venator:      { id: 'venator',      name: 'Venator',       domain: 'space',  faction: 'republic',   cost: 5000, power: 8,  icon: '🚀', buildTime: 30, req: 'shipyard_rep' },
      acclamator:   { id: 'acclamator',   name: 'Acclamator',    domain: 'space',  faction: 'republic',   cost: 3000, power: 5,  icon: '🛸', buildTime: 20, req: 'shipyard_rep' },
      clone_legion: { id: 'clone_legion', name: 'Légion Clone',  domain: 'ground', faction: 'republic',   cost: 2000, power: 5,  icon: '⚔️', buildTime: 15, req: 'barracks_rep' },
      atte:         { id: 'atte',         name: 'AT-TE',         domain: 'ground', faction: 'republic',   cost: 1500, power: 4,  icon: '🦿', buildTime: 12, req: 'barracks_rep' },
      providence:   { id: 'providence',   name: 'Providence',    domain: 'space',  faction: 'separatist', cost: 5500, power: 9,  icon: '🔴', buildTime: 35, req: 'shipyard_sep' },
      munificent:   { id: 'munificent',   name: 'Munificent',    domain: 'space',  faction: 'separatist', cost: 2500, power: 4,  icon: '🟤', buildTime: 18, req: 'shipyard_sep' },
      b1_army:      { id: 'b1_army',      name: 'Armée B1',      domain: 'ground', faction: 'separatist', cost: 1000, power: 3,  icon: '🤖', buildTime: 8,  req: 'factory_sep'  },
      aat:          { id: 'aat',          name: 'AAT',           domain: 'ground', faction: 'separatist', cost: 1200, power: 3,  icon: '🛡️', buildTime: 10, req: 'factory_sep'  }
    },
    buildingTypes: {
      shipyard_rep: { id: 'shipyard_rep', name: 'Chantier Naval',     domain: 'space',  faction: 'republic',   cost: 10000, bonus: 'production', icon: '🏭', buildTime: 60, income: 0   },
      station_rep:  { id: 'station_rep',  name: 'Station Défense',    domain: 'space',  faction: 'republic',   cost: 8000,  bonus: 'defense',     icon: '🛡️', buildTime: 45, income: 0   },
      barracks_rep: { id: 'barracks_rep', name: 'Caserne Clone',      domain: 'ground', faction: 'republic',   cost: 5000,  bonus: 'troops',      icon: '🏛️', buildTime: 30, income: 0   },
      factory_rep:  { id: 'factory_rep',  name: 'Usine',              domain: 'ground', faction: 'republic',   cost: 6000,  bonus: 'credits',     icon: '🏭', buildTime: 35, income: 200 },
      shipyard_sep: { id: 'shipyard_sep', name: 'Chantier Droïde',    domain: 'space',  faction: 'separatist', cost: 9000,  bonus: 'production',  icon: '🔧', buildTime: 55, income: 0   },
      station_sep:  { id: 'station_sep',  name: 'Plateforme Défense', domain: 'space',  faction: 'separatist', cost: 7500,  bonus: 'defense',     icon: '🎯', buildTime: 40, income: 0   },
      factory_sep:  { id: 'factory_sep',  name: 'Usine Droïdes',      domain: 'ground', faction: 'separatist', cost: 4000,  bonus: 'troops',      icon: '🤖', buildTime: 25, income: 0   },
      mine_sep:     { id: 'mine_sep',     name: 'Mine',               domain: 'ground', faction: 'separatist', cost: 5500,  bonus: 'credits',     icon: '⛏️', buildTime: 30, income: 150 }
    },
    planets: {},
    hyperlanes: [],
    fleets: {},       // fleets in transit: { id, fleetData, path, segIdx, segStart, totalMs, dest }
    constructionQueue: [],
    eventLog: []      // last 100 events
  };
}

// ─── PLANET FACTORY ──────────────────────────────────────────────────────────
function makePlanet(data) {
  return {
    id: data.id || uuid(),
    name: data.name || 'Planète',
    x: data.x || 0,
    y: data.y || 0,
    type: data.type || 'desert',
    terrain: data.terrain || 'Inconnu',
    owner: data.owner || 'neutral',
    bonus: data.bonus || 100,
    image: data.image || null,
    spaceFleets:    Array(6).fill(null),
    groundFleets:   Array(6).fill(null),
    spaceBuildings: Array(6).fill(null),
    groundBuildings:Array(6).fill(null),
    ...(data.spaceFleets    ? { spaceFleets:    data.spaceFleets    } : {}),
    ...(data.groundFleets   ? { groundFleets:   data.groundFleets   } : {}),
    ...(data.spaceBuildings ? { spaceBuildings: data.spaceBuildings } : {}),
    ...(data.groundBuildings? { groundBuildings:data.groundBuildings} : {}),
  };
}

// ─── INIT DEFAULT MAP ─────────────────────────────────────────────────────────
function initDefaultMap(state) {
  const planets = [
    { id: 'coruscant',    name: 'Coruscant',    x: 2000, y: 1100, type: 'city',       terrain: 'Ecumenopolis',   owner: 'republic',   bonus: 800 },
    { id: 'kamino',       name: 'Kamino',       x:  800, y:  800, type: 'ocean',      terrain: 'Océanique',      owner: 'republic',   bonus: 500 },
    { id: 'kuat',         name: 'Kuat',         x: 2600, y:  900, type: 'industrial', terrain: 'Chantier Naval', owner: 'republic',   bonus: 600 },
    { id: 'kashyyyk',     name: 'Kashyyyk',     x:  600, y: 1800, type: 'forest',     terrain: 'Forêt',          owner: 'republic',   bonus: 350 },
    { id: 'ryloth',       name: 'Ryloth',       x: 1400, y: 1400, type: 'desert',     terrain: 'Désertique',     owner: 'neutral',    bonus: 200 },
    { id: 'christophsis', name: 'Christophsis', x: 2000, y: 1600, type: 'ice',        terrain: 'Cristallin',     owner: 'neutral',    bonus: 300 },
    { id: 'felucia',      name: 'Felucia',      x: 1200, y: 2200, type: 'forest',     terrain: 'Jungle',         owner: 'neutral',    bonus: 250 },
    { id: 'geonosis',     name: 'Géonosis',     x: 2800, y: 1600, type: 'desert',     terrain: 'Désertique',     owner: 'separatist', bonus: 400 },
    { id: 'mustafar',     name: 'Mustafar',     x: 2600, y: 2200, type: 'volcanic',   terrain: 'Volcanique',     owner: 'separatist', bonus: 350 },
    { id: 'mygeeto',      name: 'Mygeeto',      x: 3200, y: 1800, type: 'ice',        terrain: 'Glacial',        owner: 'separatist', bonus: 450 },
    { id: 'saleucami',    name: 'Saleucami',    x: 3400, y: 1200, type: 'desert',     terrain: 'Aride',          owner: 'separatist', bonus: 280 },
  ];
  planets.forEach(p => { state.planets[p.id] = makePlanet(p); });

  state.hyperlanes = [
    { from: 'coruscant',    to: 'kuat',         type: 'large'  },
    { from: 'coruscant',    to: 'christophsis', type: 'medium' },
    { from: 'coruscant',    to: 'ryloth',       type: 'medium' },
    { from: 'kamino',       to: 'coruscant',    type: 'large'  },
    { from: 'kamino',       to: 'ryloth',       type: 'small'  },
    { from: 'kashyyyk',     to: 'kamino',       type: 'small'  },
    { from: 'kashyyyk',     to: 'felucia',      type: 'small'  },
    { from: 'kuat',         to: 'geonosis',     type: 'medium' },
    { from: 'kuat',         to: 'saleucami',    type: 'medium' },
    { from: 'ryloth',       to: 'christophsis', type: 'small'  },
    { from: 'ryloth',       to: 'felucia',      type: 'dashed' },
    { from: 'christophsis', to: 'geonosis',     type: 'medium' },
    { from: 'felucia',      to: 'mustafar',     type: 'dashed' },
    { from: 'geonosis',     to: 'mustafar',     type: 'large'  },
    { from: 'geonosis',     to: 'mygeeto',      type: 'medium' },
    { from: 'mustafar',     to: 'mygeeto',      type: 'medium' },
    { from: 'mygeeto',      to: 'saleucami',    type: 'small'  },
  ];

  // Initial fleets
  const p = state.planets;
  p.coruscant.spaceFleets[0]  = { id: uuid(), name: 'Open Circle Fleet',  faction: 'republic',   units: { venator: 3, acclamator: 2 } };
  p.coruscant.groundFleets[0] = { id: uuid(), name: '501ème Légion',       faction: 'republic',   units: { clone_legion: 2, atte: 4 } };
  p.kamino.spaceFleets[0]     = { id: uuid(), name: 'Flotte Kamino',       faction: 'republic',   units: { acclamator: 3 } };
  p.geonosis.spaceFleets[0]   = { id: uuid(), name: 'Flotte Géonosis',     faction: 'separatist', units: { providence: 2, munificent: 3 } };
  p.geonosis.groundFleets[0]  = { id: uuid(), name: 'Armée Droïde Alpha',  faction: 'separatist', units: { b1_army: 6, aat: 4 } };
  p.mustafar.spaceFleets[0]   = { id: uuid(), name: 'Flotte Mustafar',     faction: 'separatist', units: { munificent: 2 } };
  p.mygeeto.groundFleets[0]   = { id: uuid(), name: 'Garnison Mygeeto',    faction: 'separatist', units: { b1_army: 4 } };

  // Initial buildings
  p.coruscant.spaceBuildings[0]  = { id: uuid(), type: 'shipyard_rep', name: 'Chantier Central' };
  p.coruscant.groundBuildings[0] = { id: uuid(), type: 'barracks_rep', name: 'Caserne Principale' };
  p.kuat.spaceBuildings[0]       = { id: uuid(), type: 'shipyard_rep', name: 'Chantiers Kuat' };
  p.geonosis.groundBuildings[0]  = { id: uuid(), type: 'factory_sep',  name: 'Usine Droïdes Géonosis' };
  p.geonosis.spaceBuildings[0]   = { id: uuid(), type: 'shipyard_sep', name: 'Chantier Orbital Géonosis' };
  p.mustafar.groundBuildings[0]  = { id: uuid(), type: 'mine_sep',     name: 'Mine de Mustafar' };
}

// ─── GRAPH HELPERS ───────────────────────────────────────────────────────────
function getConns(state, pid) {
  return state.hyperlanes
    .filter(l => l.from === pid || l.to === pid)
    .map(l => l.from === pid ? l.to : l.from);
}

function getHL(state, a, b) {
  return state.hyperlanes.find(l =>
    (l.from === a && l.to === b) || (l.from === b && l.to === a)
  );
}

function findPath(state, startId, endId, faction) {
  if (startId === endId) return [];
  const visited = new Set([startId]);
  const queue = [[startId, []]];
  while (queue.length) {
    const [cur, path] = queue.shift();
    for (const nx of getConns(state, cur)) {
      if (nx === endId) return [...path, { from: cur, to: nx }];
      if (!visited.has(nx)) {
        // Block if enemy space fleets block passage (allow destination)
        const hasEnemy = state.planets[nx]?.spaceFleets.some(f => f && f.faction && f.faction !== faction);
        if (hasEnemy) { visited.add(nx); continue; }
        visited.add(nx);
        queue.push([nx, [...path, { from: cur, to: nx }]]);
      }
    }
  }
  return null;
}

function travelMs(state, fromId, toId, type = 'medium') {
  const p1 = state.planets[fromId], p2 = state.planets[toId];
  if (!p1 || !p2) return 10000;
  const dx = p1.x - p2.x, dy = p1.y - p2.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const mult = { large: 0.6, medium: 1.0, small: 1.4, dashed: 1.8 }[type] || 1;
  return Math.max(2000, Math.round(dist * (state.settings.travelSpeed || 0.025) * mult * 1000));
}

// ─── COMBAT ──────────────────────────────────────────────────────────────────
function fleetPower(state, fleet) {
  let p = 0;
  for (const uid in fleet.units || {}) {
    const u = state.unitTypes[uid];
    if (u) p += u.power * (fleet.units[uid] || 0);
  }
  return p || 1;
}

function defensePower(state, planet, domain) {
  const arr = domain === 'space' ? planet.spaceFleets : planet.groundFleets;
  return arr.filter(f => f && f.faction === planet.owner)
            .reduce((s, f) => s + fleetPower(state, f), 0) || 1;
}

function resolveCombat(state, attackFleet, destPlanet, domain) {
  const atkRoll = fleetPower(state, attackFleet) * (0.7 + Math.random() * 0.6);
  const defRoll = defensePower(state, destPlanet, domain) * (0.7 + Math.random() * 0.6);
  const won = atkRoll > defRoll;

  const result = {
    attacker: attackFleet.faction,
    defender: destPlanet.owner,
    planet:   destPlanet.name,
    atkPow:   Math.round(atkRoll),
    defPow:   Math.round(defRoll),
    won
  };

  if (won) {
    const arr = domain === 'space' ? destPlanet.spaceFleets : destPlanet.groundFleets;
    arr.forEach((_, i) => { if (arr[i]?.faction === destPlanet.owner) arr[i] = null; });
    const slot = arr.findIndex(x => !x);
    if (slot !== -1) arr[slot] = attackFleet; else arr.push(attackFleet);
    // Capture if no defenders remain
    const allDef = [...destPlanet.spaceFleets, ...destPlanet.groundFleets]
      .filter(f => f && f.faction === destPlanet.owner);
    if (!allDef.length) {
      result.captured = true;
      result.oldOwner = destPlanet.owner;
      destPlanet.owner = attackFleet.faction;
    }
  }
  return result;
}

// ─── INCOME ──────────────────────────────────────────────────────────────────
function calcIncome(state, faction) {
  if (!state.settings.incomeOn) return 0;
  const r = state.settings.incomeRate || 0.5;
  let inc = 0;
  Object.values(state.planets).forEach(p => {
    if (p.owner !== faction) return;
    inc += (p.bonus || 100) * 0.03 * r;
    [...p.groundBuildings, ...p.spaceBuildings].forEach(b => {
      if (!b) return;
      const bt = state.buildingTypes[b.type];
      if (bt?.income) inc += bt.income * 0.001 * r;
    });
  });
  return inc;
}

// ─── EVENT LOG ───────────────────────────────────────────────────────────────
function addEvent(state, type, msg) {
  state.eventLog.unshift({
    id: uuid(),
    type,
    msg,
    ts: new Date().toISOString()
  });
  if (state.eventLog.length > 100) state.eventLog.pop();
}

module.exports = {
  defaultState, initDefaultMap, makePlanet,
  getConns, getHL, findPath, travelMs,
  resolveCombat, calcIncome, addEvent,
  uuid
};
