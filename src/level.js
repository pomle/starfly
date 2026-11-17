import { ENEMY_TYPES, ENEMY_PARAMS } from './enemies.js';

/**
 * Level file format (JSON):
 * {
 *   "name": "Level 1",
 *   "loop": true,          // optional: restart once everything is spawned and cleared
 *   "loopDelay": 3,        // optional: seconds of quiet before a restart
 *   "events": [
 *     {
 *       "time": 1.5,       // seconds since level start
 *       "enemy": "jimmy",  // a key of ENEMY_TYPES
 *       "x": -0.5,         // -1 (left) .. 1 (right) across the playable width; default 0
 *       "count": 6,        // optional: spawn this many...
 *       "interval": 0.4,   // ...this many seconds apart (default 0.4)
 *       "params": { "amplitude": 3, "frequency": 2, "phase": 0, "hp": 1, "descent": 4, "score": 100 }
 *     }
 *   ]
 * }
 */

function fail(url, msg) {
  throw new Error(`Invalid level ${url}: ${msg}`);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fetches a level file and returns its validated, flattened form. */
export async function loadLevel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load level ${url}: HTTP ${res.status}`);
  return parseLevel(await res.json(), url);
}

export function parseLevel(data, url = 'level') {
  if (!Array.isArray(data.events)) fail(url, '"events" must be an array');

  const spawns = [];
  data.events.forEach((ev, i) => {
    const at = `events[${i}]`;
    if (!isNum(ev.time) || ev.time < 0) fail(url, `${at}.time must be a number >= 0`);
    if (!(ev.enemy in ENEMY_TYPES)) {
      fail(url, `${at}.enemy "${ev.enemy}" is unknown (have: ${Object.keys(ENEMY_TYPES).join(', ')})`);
    }
    const x = ev.x ?? 0;
    if (!isNum(x) || x < -1 || x > 1) fail(url, `${at}.x must be a number from -1 to 1`);
    const count = ev.count ?? 1;
    if (!Number.isInteger(count) || count < 1) fail(url, `${at}.count must be an integer >= 1`);
    const interval = ev.interval ?? 0.4;
    if (!isNum(interval) || interval <= 0) fail(url, `${at}.interval must be a number > 0`);
    const params = ev.params ?? {};
    for (const [k, v] of Object.entries(params)) {
      if (!ENEMY_PARAMS.includes(k)) fail(url, `${at}.params.${k} is not a known parameter`);
      if (!isNum(v)) fail(url, `${at}.params.${k} must be a number`);
    }
    for (let n = 0; n < count; n++) {
      spawns.push({ time: ev.time + n * interval, enemy: ev.enemy, x, params });
    }
  });
  spawns.sort((a, b) => a.time - b.time); // stable, so same-time events keep file order

  return {
    name: data.name ?? 'Untitled',
    loop: data.loop ?? false,
    loopDelay: data.loopDelay ?? 3,
    spawns,
  };
}

/** Plays a level's spawn schedule against a clock. */
export class LevelRunner {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset(delay = 0) {
    this.time = -delay; // a negative start time adds a pause before the first spawn
    this.next = 0;
  }

  /** True once every spawn has happened. */
  get done() {
    return this.next >= this.level.spawns.length;
  }

  /** Advances the clock and calls `spawn(spawnEvent)` for each spawn that came due. */
  update(dt, spawn) {
    this.time += dt;
    const { spawns } = this.level;
    while (this.next < spawns.length && spawns[this.next].time <= this.time) {
      spawn(spawns[this.next++]);
    }
  }
}
