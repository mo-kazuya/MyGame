'use strict';
const T = 32, VW = 640, VH = 416;
const FONT = "'DotGothic16', 'MS Gothic', monospace";
const SAVE_KEY = 'xanaduLike.save.v2';
const VERSION = '1.4'; // index.html の ?v= と合わせる（スマホのキャッシュ対策）

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const $menu = document.getElementById('menu');
const $hud = document.getElementById('hud');
const $log = document.getElementById('log');

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const touching = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const touching2 = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
const isTop = () => area.def.view === 'top';

// ---------------------------------------------------------------- 入力
const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyZ: 'jump', Space: 'jump', KeyX: 'magic', KeyA: 'potion', KeyS: 'elixir',
  KeyD: 'dig', KeyQ: 'spell', KeyV: 'items',
  KeyC: 'status', Enter: 'ok', Escape: 'cancel', KeyP: 'cancel',
};
const keys = {}, pressed = {};
addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (!keys[k]) pressed[k] = true;
  keys[k] = true;
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  keys[k] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------------------------------------------------------------- 効果音
let actx = null;
function tone(freq, dur = 0.08, type = 'square', vol = 0.05, slide = 0, delay = 0) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + dur);
  } catch (e) { /* 音が出せない環境では無視 */ }
}
const SFX = {
  hit: () => tone(260, 0.06, 'square', 0.05, -160),
  miss: () => tone(500, 0.05, 'triangle', 0.04, 200),
  hurt: () => tone(140, 0.18, 'sawtooth', 0.06, -80),
  kill: () => { tone(400, 0.08, 'square', 0.05, -300); tone(200, 0.15, 'triangle', 0.05, -150, 0.05); },
  coin: () => { tone(880, 0.05); tone(1320, 0.1, 'square', 0.05, 0, 0.05); },
  item: () => { tone(660, 0.07); tone(990, 0.12, 'square', 0.05, 0, 0.07); },
  jump: () => tone(300, 0.1, 'square', 0.03, 250),
  magic: () => tone(900, 0.15, 'sawtooth', 0.04, -600),
  fire: () => tone(180, 0.2, 'sawtooth', 0.05, -100),
  dig: () => { tone(90, 0.1, 'square', 0.07, -40); tone(70, 0.12, 'triangle', 0.06, -30, 0.08); },
  door: () => tone(220, 0.12, 'triangle', 0.06, 110),
  select: () => tone(740, 0.04, 'square', 0.03),
  bad: () => tone(120, 0.12, 'square', 0.04),
  level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.05, 0, i * 0.11)),
  heal: () => [600, 800, 1000].forEach((f, i) => tone(f, 0.1, 'triangle', 0.06, 0, i * 0.07)),
};

// ---------------------------------------------------------------- メッセージ
const logLines = [];
const msgSeen = {};
function msg(text, cls = '') {
  logLines.push({ text, cls });
  while (logLines.length > 6) logLines.shift();
  $log.innerHTML = logLines.map(l => `<div class="${l.cls}">${l.text}</div>`).join('');
}
// 同じメッセージを短時間に連発しない
function msgThrottle(id, text, cls, frames = 120) {
  if (G && msgSeen[id] && G.time - msgSeen[id] < frames) return;
  msgSeen[id] = G ? G.time : 0;
  msg(text, cls);
}

// ---------------------------------------------------------------- ゲーム状態
let G = null;          // { p, state, time, fade, endTimer, freeze }
let area = null;       // 現在のエリア
let enemies = [], items = [], shots = [], parts = [], texts = [];
let mode = 'title';    // title / play / menu
let cam = { x: 0, y: 0 };

function newPlayer() {
  return {
    x: 0, y: 0, w: 20, h: 28, vx: 0, vy: 0, dir: 1, aimX: 1, aimY: 0,
    onGround: false, climb: false, drop: 0, atkCool: 0, inv: 0, anim: 0,
    level: 1, xp: 0, hp: 50, maxHp: 50, mp: 10, maxMp: 10,
    str: 5, def: 2, agi: 5, int: 5, karma: 0, gold: 600, food: 60,
    keys: 0, potions: 1, elixirs: 0, crowns: 0, lamp: false,
    tools: { mattock: 0, wing: 0, hourglass: 0, revive: 0 },
    weapons: [{ id: 'dagger', exp: 0 }], weapon: 0,
    armors: ['cloth'], armor: 'cloth', shields: [], shield: null,
    armorExp: {}, shieldExp: {},
    spells: [{ id: 'fire', exp: 0 }], spell: 0,
    train: { str: 0, def: 0, agi: 0, int: 0, hp: 0 },
  };
}
const newState = () => ({ taken: {}, opened: {}, killed: {}, dug: {}, flags: {}, visited: {} });

function newGame() {
  G = { p: newPlayer(), state: newState(), time: 0, fade: null, endTimer: 0, xpNotice: 0, freeze: 0 };
  logLines.length = 0;
  loadArea('town', { start: true });
  msg('王から支度金 600G を賜った。竜の棲む地下迷宮は町の東にある。', 'info');
  msg('王城の訓練所で己を鍛えるか、店で装備を整えるか――使い道はあなた次第だ。');
  msg('迷宮の魔物は倒すと二度と現れない。経験値も金も限りがある。', 'info');
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ p: G.p, state: G.state, time: G.time }));
    return true;
  } catch (e) { return false; }
}
function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d) return false;
    G = { p: Object.assign(newPlayer(), d.p), state: Object.assign(newState(), d.state), time: d.time || 0,
          fade: null, endTimer: 0, xpNotice: 0, freeze: 0 };
    logLines.length = 0;
    loadArea('town', { door: 'I' });
    msg('宿屋で目を覚ました。', 'info');
    return true;
  } catch (e) { return false; }
}

const curWeapon = () => G.p.weapons[G.p.weapon];
const curSpell = () => G.p.spells[G.p.spell];
function armorDef() {
  const p = G.p;
  const a = ARMORS[p.armor].def * (1 + 0.15 * profLevel(p.armorExp[p.armor] || 0));
  const s = p.shield ? SHIELDS[p.shield].def * (1 + 0.15 * profLevel(p.shieldExp[p.shield] || 0)) : 0;
  return a + s;
}
const totalDef = () => Math.round(G.p.def + armorDef());

// ---------------------------------------------------------------- エリア
const ITEM_CHARS = '$!*?%&mGQRL';
const DOOR_CHARS = new Set('abcdefghKWAFSIT'.split(''));
const SHOP_CHARS = new Set('KWAFSIT'.split(''));
const SOLID = new Set(['#', '=', '+']);

function tile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) return '#';
  return area.grid[ty][tx];
}
const tileAtPx = (x, y) => tile(Math.floor(x / T), Math.floor(y / T));
const isSolid = (tx, ty) => SOLID.has(tile(tx, ty));
function isPlatform(tx, ty) {
  const c = tile(tx, ty);
  return c === '-' || (c === 'H' && tile(tx, ty - 1) !== 'H');
}

function loadArea(id, entry) {
  const def = AREAS[id];
  const w = Math.max(...def.map.map(r => r.length));
  const grid = def.map.map(r => r.padEnd(w, def.bg).split(''));
  area = { id, def, grid, w, h: grid.length, total: 0 };
  enemies = []; items = []; shots = []; parts = []; texts = [];
  G.freeze = 0;
  let start = null;
  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      const key = `${id}:${x}:${y}`;
      if ((ch === '+' && G.state.opened[key]) || (ch === '#' && G.state.dug[key])) grid[y][x] = def.bg;
      else if (ch === 'P') { start = { x, y }; grid[y][x] = def.bg; }
      else if (ENEMIES[ch]) {
        grid[y][x] = def.bg;
        if (!ENEMIES[ch].peaceful) area.total++;
        // ザナドゥ流：倒した魔物は二度と現れない
        if (!G.state.killed[key]) spawnEnemy(ch, x, y, key);
      } else if (ITEM_CHARS.includes(ch)) {
        grid[y][x] = def.bg;
        if (!G.state.taken[key]) items.push({ ch, key, x: x * T + 4, y: y * T + 4, w: 24, h: 28, bob: Math.random() * 6 });
      }
    }
  }
  let tx = 1, ty = 1;
  if (entry.door) {
    outer: for (let y = 0; y < area.h; y++) for (let x = 0; x < w; x++) if (grid[y][x] === entry.door) { tx = x; ty = y; break outer; }
  } else if (start) { tx = start.x; ty = start.y; }
  const p = G.p;
  p.x = tx * T + (T - p.w) / 2;
  p.y = ty * T + T - p.h;
  p.vx = p.vy = 0; p.climb = false; p.onGround = true;
  snapCamera();
  if (!G.state.visited[id]) {
    G.state.visited[id] = true;
    if (def.intro) msg(def.intro, 'info');
  }
}

function spawnEnemy(ch, tx, ty, key) {
  const d = ENEMIES[ch];
  const e = Object.assign({ scale: 2 }, d, {
    type: ch, key, maxHp: d.hp, vx: 0, vy: 0, dir: -1, cool: 30, flash: 0, onGround: false,
    t: rnd(0, 200), state: 'hover', st: 0, wx: 0, wy: 0,
  });
  e.x = tx * T + (T - e.w) / 2;
  e.y = (e.ai === 'fly' || e.ai === 'ghost' || area.def.view === 'top') ? ty * T + (T - e.h) / 2 : ty * T + T - e.h;
  enemies.push(e);
}

const remaining = () => enemies.filter(e => !e.peaceful).length;

// ---------------------------------------------------------------- 当たり判定付き移動
function moveX(e, dx) {
  if (!dx) return null;
  e.x += dx;
  const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.01) / T);
  if (dx > 0) {
    const tx = Math.floor((e.x + e.w - 0.01) / T);
    for (let ty = y0; ty <= y1; ty++) if (isSolid(tx, ty)) { e.x = tx * T - e.w; return { tx, ty }; }
  } else {
    const tx = Math.floor(e.x / T);
    for (let ty = y0; ty <= y1; ty++) if (isSolid(tx, ty)) { e.x = (tx + 1) * T; return { tx, ty }; }
  }
  return null;
}
function moveY(e, dy, platforms) {
  if (!dy) return null;
  const prevBottom = e.y + e.h;
  e.y += dy;
  const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.01) / T);
  if (dy > 0) {
    const ty = Math.floor((e.y + e.h - 0.01) / T);
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(tx, ty) || (platforms && isPlatform(tx, ty) && prevBottom <= ty * T + 0.01)) {
        e.y = ty * T - e.h;
        return { tx, ty };
      }
    }
  } else {
    const ty = Math.floor(e.y / T);
    for (let tx = x0; tx <= x1; tx++) if (isSolid(tx, ty)) { e.y = (ty + 1) * T; return { tx, ty }; }
  }
  return null;
}
function solidAt(r) {
  const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w - 0.01) / T);
  const y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h - 0.01) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(tx, ty)) return true;
  return false;
}

// ---------------------------------------------------------------- プレイヤー
function updatePlayer() {
  const p = G.p;
  if (p.atkCool > 0) p.atkCool--;
  if (p.inv > 0) p.inv--;
  if (pressed.spell) switchSpell();
  if (isTop()) { updatePlayerTop(); return; }

  const dirIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const cx = p.x + p.w / 2;

  // 扉・店に入る
  if (pressed.up && p.onGround && !p.climb) {
    const c = tileAtPx(cx, p.y + p.h - 4);
    if (DOOR_CHARS.has(c)) { enterDoor(c); return; }
  }

  // はしご
  const onLadder = tileAtPx(cx, p.y + p.h / 2) === 'H' || tileAtPx(cx, p.y + p.h - 1) === 'H';
  const ladderBelow = tileAtPx(cx, p.y + p.h + 2) === 'H';
  if (!p.climb) {
    if (keys.up && onLadder) p.climb = true;
    else if (keys.down && p.onGround && ladderBelow && !keys.dig) { p.climb = true; p.y += 3; }
  }
  if (p.climb) {
    if (dirIn && !keys.up && !keys.down) {
      p.climb = false;
    } else if (pressed.jump) {
      p.climb = false; p.vy = -4;
    } else {
      p.x = Math.floor(cx / T) * T + T / 2 - p.w / 2;
      p.vx = p.vy = 0;
      const dy = (keys.down ? 2.2 : 0) - (keys.up ? 2.2 : 0);
      const hit = moveY(p, dy, false);
      if (hit && dy > 0) { p.climb = false; p.onGround = true; }
      const fx = p.x + p.w / 2;
      const still = tileAtPx(fx, p.y + p.h - 1) === 'H' || tileAtPx(fx, p.y + p.h / 2) === 'H';
      if (!still) {
        p.climb = false;
        if (dy < 0) { // 上まで登りきった：はしごの頭に立つ
          const row = Math.floor((p.y + p.h - 1) / T);
          p.y = (row + 1) * T - p.h;
          p.onGround = true;
        }
      }
      if (dy) p.anim++;
      afterPlayerMove();
      return;
    }
  }

  // 歩き・ジャンプ
  p.vx = dirIn * 2.4;
  if (dirIn) { p.dir = dirIn; p.aimX = dirIn; p.aimY = 0; }
  if (pressed.jump && p.onGround) { p.vy = -8; p.onGround = false; SFX.jump(); }
  if (keys.down && !keys.dig && p.onGround && tileAtPx(cx, p.y + p.h + 2) === '-') p.drop = 10;
  p.vy = Math.min(p.vy + 0.45, 9);

  const hx = moveX(p, p.vx);
  if (hx && tile(hx.tx, hx.ty) === '+') tryUnlock(hx.tx, hx.ty);
  bumpEnemies('x', dirIn);

  p.onGround = false;
  const hy = moveY(p, p.vy, p.drop <= 0);
  if (p.drop > 0) p.drop--;
  if (hy) { if (p.vy > 0) p.onGround = true; p.vy = 0; }
  if (dirIn && p.onGround) p.anim++;

  if (pressed.magic) castMagic();
  if (pressed.dig) dig(keys.down);
  afterPlayerMove();
}

// 守護者の部屋：見下ろし視点で4方向に移動
function updatePlayerTop() {
  const p = G.p;
  const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dx) p.dir = dx;
  if (dx || dy) { p.aimX = dx; p.aimY = dy; p.anim++; }
  const sp = (dx && dy) ? 1.7 : 2.4;
  p.vx = dx * sp;
  const hx = moveX(p, dx * sp);
  if (hx && tile(hx.tx, hx.ty) === '+') tryUnlock(hx.tx, hx.ty);
  bumpEnemies('x', dx);
  moveY(p, dy * sp, false);
  bumpEnemies('y', dy);
  p.onGround = true; p.climb = false;
  if (pressed.jump) {
    const c = tileAtPx(p.x + p.w / 2, p.y + p.h / 2);
    if (DOOR_CHARS.has(c)) { enterDoor(c); return; }
  }
  if (pressed.magic) castMagic();
  if (pressed.dig) dig(false);
  afterPlayerMove();
}

function afterPlayerMove() {
  const p = G.p;
  if (pressed.potion) usePotion();
  if (pressed.elixir) useElixir();
  // トゲ
  const x0 = Math.floor((p.x + 2) / T), x1 = Math.floor((p.x + p.w - 2) / T);
  const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - 1) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tile(tx, ty) === '^' && p.inv <= 0) {
      hurtPlayer(14 + totalDef(), null, 'トゲに刺さった！');
      p.vy = -5;
    }
  }
  // アイテム取得
  for (const it of items) if (!it.got && overlap(p, it)) pickItem(it);
  items = items.filter(it => !it.got);
}

function tryUnlock(tx, ty) {
  const p = G.p;
  if (p.keys <= 0) { msgThrottle('locked', '扉には鍵がかかっている。'); return; }
  p.keys--;
  // 縦につながった鍵扉をまとめて開ける
  let y = ty;
  while (tile(tx, y - 1) === '+') y--;
  for (; tile(tx, y) === '+'; y++) {
    area.grid[y][tx] = area.def.bg;
    G.state.opened[`${area.id}:${tx}:${y}`] = true;
  }
  msg('鍵を使って扉を開けた。', 'info');
  SFX.door();
  burst(tx * T + 16, ty * T + 16, '#ffd84a', 12);
}

// つるはし：前（↓を押しながらなら足元）のレンガを掘る
function dig(down) {
  const p = G.p;
  if (area.def.noDig) { msgThrottle('nodig', 'ここでは掘れない。'); return; }
  if (p.tools.mattock <= 0) { msgThrottle('nomat', 'つるはしを持っていない。（道具屋で買える）', 'bad'); SFX.bad(); return; }
  const cx = p.x + p.w / 2;
  let targets;
  if (down) {
    targets = [[Math.floor(cx / T), Math.floor((p.y + p.h + 2) / T)]];
  } else {
    const tx = Math.floor((p.dir > 0 ? p.x + p.w + 12 : p.x - 12) / T);
    const ty = Math.floor((p.y + p.h - 1) / T);
    targets = [[tx, ty], [tx, ty - 1]];
  }
  const breakable = ([tx, ty]) => tile(tx, ty) === '#' && tx > 0 && ty > 0 && tx < area.w - 1 && ty < area.h - 1;
  const ok = targets.filter(breakable);
  if (!ok.length) { msgThrottle('cantdig', 'ここは掘れない。'); return; }
  p.tools.mattock--;
  for (const [tx, ty] of ok) {
    area.grid[ty][tx] = area.def.bg;
    G.state.dug[`${area.id}:${tx}:${ty}`] = true;
    burst(tx * T + 16, ty * T + 16, THEMES[area.def.theme].brick, 16);
  }
  SFX.dig();
  msg(`レンガを掘りくずした。（つるはし 残り ${p.tools.mattock}）`);
}

function bumpEnemies(axis, dirIn) {
  const p = G.p;
  for (const e of enemies) {
    if (e.dead || !overlap(p, e)) continue;
    const pc = axis === 'x' ? p.x + p.w / 2 : p.y + p.h / 2;
    const ec = axis === 'x' ? e.x + e.w / 2 : e.y + e.h / 2;
    if (!e.boss) {
      const bx = p.x, by = p.y;
      if (axis === 'x') p.x = pc < ec ? e.x - p.w : e.x + e.w;
      else p.y = pc < ec ? e.y - p.h : e.y + e.h;
      // 押し戻した先が壁なら敵の方を押す
      if (solidAt(p)) {
        p.x = bx; p.y = by;
        if (axis === 'x') moveX(e, pc < ec ? 4 : -4); else moveY(e, pc < ec ? 4 : -4, false);
      }
    }
    const towards = (pc < ec && dirIn > 0) || (pc > ec && dirIn < 0);
    if (towards && p.atkCool <= 0) playerAttack(e, axis);
  }
}

function playerAttack(e, axis) {
  const p = G.p;
  p.atkCool = Math.max(8, 20 - Math.floor(p.agi / 2));
  const cx = (p.x + p.w / 2 + e.x + e.w / 2) / 2, cy = (p.y + p.h / 2 + e.y + e.h / 2) / 2;
  if (Math.random() < 0.08) { addText(cx, cy, 'MISS', '#aaaaff'); SFX.miss(); return; }
  const cw = curWeapon(), w = WEAPONS[cw.id];
  const wlBefore = profLevel(cw.exp);
  const atk = p.str + w.atk * (1 + 0.15 * wlBefore);
  let dmg = Math.max(1, Math.round(atk - e.def * 0.6 + rnd(-1, 2)));
  if (e.boss && !w.slayer) {
    dmg = 0;
    msgThrottle('slayer', 'ドラゴンの鱗は硬すぎる！ ドラゴンスレイヤーでなければ…', 'bad', 300);
  }
  cw.exp++;
  const wl = profLevel(cw.exp);
  if (wl > wlBefore) msg(`${w.name}の熟練度が上がった！（Lv${wl}）`, 'good');
  slash(cx, cy);
  damageEnemy(e, dmg);
  if (!e.boss && !e.guardian && !e.dead) {
    const s = axis === 'y' ? Math.sign(e.y - p.y) : Math.sign(e.x - p.x);
    if (axis === 'y') moveY(e, s * 6, false); else moveX(e, s * 6);
  }
}

function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.flash = 8;
  addText(e.x + e.w / 2, e.y, String(dmg), dmg ? '#ffffff' : '#888888');
  SFX.hit();
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  const p = G.p;
  e.dead = true;
  if (e.key) G.state.killed[e.key] = true;
  p.xp += e.xp;
  p.gold += e.gold;
  SFX.kill();
  burst(e.x + e.w / 2, e.y + e.h / 2, e.boss || e.guardian ? '#ff8030' : '#ffffff', e.boss || e.guardian ? 50 : 14);
  addText(e.x + e.w / 2, e.y - 12, `+${e.xp}EXP`, '#8cf08c');
  if (e.karma) {
    p.karma += e.karma;
    msg(`罪なき${e.name}を殺してしまった… カルマが ${e.karma} 増えた。`, 'bad');
  } else {
    msg(`${e.name}を倒した。 経験値 ${e.xp}${e.gold ? ` / ${e.gold}G` : ''}`);
  }
  if (e.guardian) {
    p.crowns++;
    SFX.level();
    msg(`守護者は王冠を遺した。（王冠 ${p.crowns} / ${CROWNS_NEEDED}）`, 'info');
    if (p.crowns >= CROWNS_NEEDED) msg('3つの王冠がそろった！ 竜の巣への扉が開くはずだ。', 'info');
  }
  if (e.boss) {
    G.state.flags.dragon = true;
    G.endTimer = 180;
    msg('ドラゴンを倒した！！ 地の底に静寂が戻った…', 'info');
  }
  if (!e.peaceful && remaining() === 0 && area.total > 0) msg(`${area.def.name}の魔物を全て倒した。`, 'good');
  if (p.xp >= needXp(p.level) && G.xpNotice !== p.level) {
    G.xpNotice = p.level;
    msg('経験値が十分たまった。町の寺院でレベルを上げてもらおう。', 'info');
  }
}

function hurtPlayer(atk, src, text) {
  const p = G.p;
  if (p.inv > 0 || p.hp <= 0) return;
  const dmg = Math.max(1, Math.round(atk - totalDef() * 0.8 + rnd(-2, 2)));
  p.hp = Math.max(0, p.hp - dmg);
  p.inv = 40;
  SFX.hurt();
  addText(p.x + p.w / 2, p.y, String(dmg), '#ff6060');
  if (text) msg(text, 'bad');
  // 防具も攻撃を受けるほど体になじむ
  const before = profLevel(p.armorExp[p.armor] || 0);
  p.armorExp[p.armor] = (p.armorExp[p.armor] || 0) + 1;
  if (p.armor !== 'cloth' && profLevel(p.armorExp[p.armor]) > before) msg(`${ARMORS[p.armor].name}が体になじんできた。（Lv${profLevel(p.armorExp[p.armor])}）`, 'good');
  if (p.shield) p.shieldExp[p.shield] = (p.shieldExp[p.shield] || 0) + 1;
  if (src && !p.climb) {
    if (isTop()) {
      const ax = (p.x + p.w / 2) - (src.x + src.w / 2), ay = (p.y + p.h / 2) - (src.y + src.h / 2);
      if (Math.abs(ax) > Math.abs(ay)) moveX(p, Math.sign(ax) * 10); else moveY(p, Math.sign(ay) * 10, false);
    } else {
      moveX(p, ((p.x + p.w / 2) < (src.x + src.w / 2) ? -1 : 1) * 10);
    }
  }
  if (p.hp <= 0) playerDied();
}

function switchSpell() {
  const p = G.p;
  if (p.spells.length < 2) { msgThrottle('onespell', 'まだ他の魔法を覚えていない。（町の魔法屋で学べる）'); return; }
  p.spell = (p.spell + 1) % p.spells.length;
  SFX.select();
  msg(`魔法を ${SPELLS[curSpell().id].name} に切り替えた。`);
}

function spellPower(sp) {
  const p = G.p, s = SPELLS[sp.id];
  return Math.round((4 + p.int * 1.3 + p.level * 1.5) * s.power * (1 + 0.15 * profLevel(sp.exp)));
}

function castMagic() {
  const p = G.p;
  const sp = curSpell(), s = SPELLS[sp.id];
  if (p.mp < s.mp) { msgThrottle('nomp', 'MPが足りない。', 'bad', 60); SFX.bad(); return; }
  p.mp -= s.mp;
  SFX.magic();
  const dmg = spellPower(sp);
  const ox = p.x + p.w / 2 - 6, oy = p.y + p.h / 2 - 8;
  let ax = p.aimX, ay = isTop() ? p.aimY : 0;
  if (!ax && !ay) ax = p.dir;
  const len = Math.hypot(ax, ay);
  ax /= len; ay /= len;
  const base = { w: 12, h: 12, friendly: true, dmg, spell: sp };
  if (sp.id === 'fire') {
    shots.push(Object.assign({}, base, { x: ox + ax * 10, y: oy + ay * 10, vx: ax * 6, vy: ay * 6, life: 70, kind: 'fire' }));
  } else if (sp.id === 'needle') {
    shots.push(Object.assign({}, base, { x: ox + ax * 10, y: oy + ay * 10, vx: ax * 8, vy: ay * 8, life: 60, kind: 'needle', pierce: true, hit: new Set() }));
  } else {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      shots.push(Object.assign({}, base, { x: ox, y: oy, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, life: 28, kind: 'thunder' }));
    }
  }
}

function usePotion() {
  const p = G.p;
  if (p.potions <= 0) { msgThrottle('nopot', '薬を持っていない。', 'bad', 60); return; }
  if (p.hp >= p.maxHp) { msgThrottle('fullhp', 'HPは満タンだ。', '', 60); return; }
  p.potions--;
  const heal = Math.max(40, Math.floor(p.maxHp * 0.5));
  p.hp = Math.min(p.maxHp, p.hp + heal);
  SFX.heal();
  msg(`薬を飲んだ。HPが ${heal} 回復した。`, 'good');
}
function useElixir() {
  const p = G.p;
  if (p.elixirs <= 0) { msgThrottle('noeli', '魔法の水を持っていない。', 'bad', 60); return; }
  if (p.mp >= p.maxMp) { msgThrottle('fullmp', 'MPは満タンだ。', '', 60); return; }
  p.elixirs--;
  p.mp = p.maxMp;
  SFX.heal();
  msg('魔法の水を飲んだ。MPが全回復した。', 'good');
}

function useTool(id) {
  const p = G.p;
  if (p.tools[id] <= 0) return false;
  if (id === 'mattock') { dig(false); return true; }
  if (id === 'wing') {
    if (area.id === 'lair' && !G.state.flags.dragon) { msg('竜の気配が翼の魔力をかき消した！', 'bad'); SFX.bad(); return false; }
    if (area.id === 'town') { msg('ここはもう町だ。'); return false; }
    p.tools.wing--;
    SFX.magic();
    msg('魔法の翼が光に包まれ、町へと運ばれた。', 'info');
    G.fade = { t: 0, dur: 40, cb: () => loadArea('town', { door: 'I' }) };
    return true;
  }
  if (id === 'hourglass') {
    p.tools.hourglass--;
    G.freeze = 420;
    SFX.level();
    msg('砂時計を返した。魔物たちの時が止まった！', 'info');
    return true;
  }
  if (id === 'revive') { msg('命の霊薬は力尽きたときに自動で使われる。'); return false; }
  return false;
}

function pickItem(it) {
  const p = G.p;
  const full = (n) => { if (n >= MAX_ITEM) { msgThrottle('full' + it.ch, 'これ以上持てない。'); return true; } return false; };
  const tool = (id) => { if (full(p.tools[id])) return false; p.tools[id]++; msg(`${TOOLS[id].name}を手に入れた。`, 'good'); SFX.item(); return true; };
  switch (it.ch) {
    case '$': { const g = { d1: 60, d2: 160, d3: 300, r1: 80, r2: 200, r3: 300 }[area.id] || 50; p.gold += g; msg(`${g}G を拾った。`, 'good'); SFX.coin(); break; }
    case '!': if (full(p.potions)) return; p.potions++; msg('薬を手に入れた。', 'good'); SFX.item(); break;
    case '*': if (full(p.elixirs)) return; p.elixirs++; msg('魔法の水を手に入れた。', 'good'); SFX.item(); break;
    case '?': if (full(p.keys)) return; p.keys++; msg('鍵を手に入れた。', 'good'); SFX.item(); break;
    case '%': p.food = Math.min(MAX_FOOD, p.food + 40); msg('食料を見つけた。（+40）', 'good'); SFX.item(); break;
    case 'm': if (!tool('mattock')) return; msg('D キーで目の前のレンガを掘れる。↓＋D で足元を掘る。', 'info'); break;
    case 'G': if (!tool('wing')) return; break;
    case 'Q': if (!tool('hourglass')) return; break;
    case 'R': if (!tool('revive')) return; break;
    case 'L':
      p.lamp = true;
      msg('ランプを手に入れた。暗い場所でも遠くまで見渡せる。', 'info');
      SFX.item();
      break;
    case '&':
      p.weapons.push({ id: 'slayer', exp: 0 });
      p.weapon = p.weapons.length - 1;
      msg('伝説の剣「ドラゴンスレイヤー」を手に入れた！ これなら竜を斬れる！', 'info');
      SFX.level();
      break;
  }
  it.got = true;
  G.state.taken[it.key] = true;
}

// ---------------------------------------------------------------- 敵
function updateEnemy(e) {
  const p = G.p;
  if (e.cool > 0) e.cool--;
  if (e.flash > 0) e.flash--;
  e.t++;
  const dx = (p.x + p.w / 2) - (e.x + e.w / 2);
  const dy = (p.y + p.h / 2) - (e.y + e.h / 2);

  if (e.ai === 'boss') {
    updateBoss(e, dx);
  } else if (isTop()) {
    updateEnemyTop(e, dx, dy);
  } else if (e.ai === 'walk') {
    let sp = e.speed;
    if (e.chase && Math.abs(dx) < T * 6 && Math.abs(dy) < T * 1.5) { e.dir = dx > 0 ? 1 : -1; sp *= 1.3; }
    if (touching(e, p, 1) && Math.sign(dx) === e.dir) sp = 0;
    const hit = moveX(e, e.dir * sp);
    if (hit) e.dir *= -1;
    else if (e.onGround && sp) {
      const fx = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
      const tx = Math.floor(fx / T), ty = Math.floor((e.y + e.h + 2) / T);
      if (!isSolid(tx, ty) && !isPlatform(tx, ty)) { e.x -= e.dir * sp; e.dir *= -1; }
    }
    e.vy = Math.min(e.vy + 0.45, 9);
    e.onGround = false;
    if (moveY(e, e.vy, true)) { if (e.vy > 0) e.onGround = true; e.vy = 0; }
    if (e.shoot && e.t % e.shoot.rate === 0 && Math.abs(dx) < T * 8 && Math.abs(dy) < T) {
      e.dir = dx > 0 ? 1 : -1;
      enemyShot(e, e.dir * e.shoot.speed, 0, e.shoot.dmg);
    }
  } else if (e.ai === 'fly') {
    let vx, vy;
    if (Math.abs(dx) < T * 7 && Math.abs(dy) < T * 4) {
      vx = Math.sign(dx) * e.speed;
      vy = Math.sign(dy) * e.speed * 0.6;
    } else {
      vx = Math.cos(e.t / 40) * e.speed * 0.6;
      vy = 0;
    }
    if (vx) e.dir = Math.sign(vx);
    if (moveX(e, vx)) e.t += 40;
    moveY(e, vy + Math.sin(e.t / 8) * 0.9, false);
  } else if (e.ai === 'ghost') {
    const vx = Math.cos(e.t / 90) * 0.5;
    if (vx) e.dir = Math.sign(vx);
    moveX(e, vx);
    moveY(e, Math.sin(e.t / 40) * 0.4, false);
  }

  // プレイヤーと重ならないよう押し戻す
  if (!e.boss && overlap(e, p)) {
    if (isTop() && Math.abs(dy) * (e.w + p.w) > Math.abs(dx) * (e.h + p.h)) {
      const target = dy > 0 ? p.y - e.h : p.y + p.h;
      moveY(e, clamp(target - e.y, -T + 1, T - 1), false);
    } else {
      const target = dx > 0 ? p.x - e.w : p.x + p.w;
      moveX(e, clamp(target - e.x, -T + 1, T - 1));
    }
  }
  // 接触攻撃
  const contact = e.boss ? overlap(e, p) : isTop() ? touching2(e, p, 2) : touching(e, p, 2);
  if (!e.peaceful && e.cool <= 0 && p.inv <= 0 && contact) {
    hurtPlayer(e.atk, e);
    e.cool = e.rate;
  }
}

// 見下ろし視点の敵：近づくと追いかけ、離れていればうろつく
function updateEnemyTop(e, dx, dy) {
  const dist = Math.hypot(dx, dy);
  const sp = e.ai === 'ghost' ? 0.5 : (e.speed || 1);
  let vx, vy;
  if (e.ai !== 'ghost' && dist < T * 7) {
    if (touching2(e, G.p, 1)) { vx = vy = 0; } else { vx = dx / dist * sp; vy = dy / dist * sp; }
  } else {
    if (e.t % 90 === 0) { const a = Math.random() * Math.PI * 2; e.wx = Math.cos(a); e.wy = Math.sin(a); }
    vx = e.wx * sp * 0.6; vy = e.wy * sp * 0.6;
  }
  if (vx) e.dir = Math.sign(vx);
  if (moveX(e, vx)) e.wx *= -1;
  if (moveY(e, vy, false)) e.wy *= -1;
  if (e.shoot && e.t % e.shoot.rate === 0 && dist < T * 9) {
    const a = Math.atan2(dy, dx);
    const spread = e.shoot.spread ? [-0.3, 0, 0.3] : [0];
    for (const d of spread) enemyShot(e, Math.cos(a + d) * e.shoot.speed, Math.sin(a + d) * e.shoot.speed, e.shoot.dmg);
  }
}

function updateBoss(e, dx) {
  const p = G.p;
  const pcx = p.x + p.w / 2, ecx = e.x + e.w / 2;
  const aw = area.w * T, floorY = (area.h - 1) * T;
  e.dir = dx > 0 ? 1 : -1;
  if (e.state === 'hover') {
    const tx = clamp(pcx - e.w / 2 + Math.sin(e.t / 70) * 140, T, aw - T - e.w);
    const ty = T * 1.5 + Math.sin(e.t / 25) * 16;
    e.x += clamp(tx - e.x, -1.8, 1.8);
    e.y += clamp(ty - e.y, -1.5, 1.5);
    if (e.t % e.shoot.rate === 0) {
      const ang = Math.atan2((p.y + p.h / 2) - (e.y + e.h / 2), pcx - ecx);
      for (const d of [-0.25, 0, 0.25]) enemyShot(e, Math.cos(ang + d) * e.shoot.speed, Math.sin(ang + d) * e.shoot.speed, e.shoot.dmg);
      SFX.fire();
    }
    if (e.t % 420 === 0) { e.state = 'dive'; e.st = 0; e.sweep = e.dir; msg('ドラゴンが急降下してきた！', 'bad'); }
  } else if (e.state === 'dive') {
    e.y += 4;
    if (e.y >= floorY - e.h) { e.y = floorY - e.h; e.state = 'sweep'; e.st = 0; }
  } else if (e.state === 'sweep') {
    e.st++;
    e.x += e.sweep * 2.6;
    if (e.x < T) { e.x = T; e.sweep = 1; }
    if (e.x > aw - T - e.w) { e.x = aw - T - e.w; e.sweep = -1; }
    if (e.st > 150) e.state = 'rise';
  } else if (e.state === 'rise') {
    e.y -= 2.5;
    if (e.y <= T * 1.5) e.state = 'hover';
  }
}

function enemyShot(e, vx, vy, dmg) {
  shots.push({ x: e.x + e.w / 2 - 6, y: e.y + e.h / 2 - 6, w: 12, h: 12, vx, vy, dmg, life: 260, friendly: false });
}

function updateShots() {
  const p = G.p;
  for (const s of shots) {
    if (!s.friendly && G.freeze > 0) continue; // 止まった時の中では敵の弾も止まる
    s.x += s.vx; s.y += s.vy; s.life--;
    if (isSolid(Math.floor((s.x + 6) / T), Math.floor((s.y + 6) / T))) { s.life = 0; burst(s.x + 6, s.y + 6, s.friendly ? '#80c0ff' : '#ff8030', 5); }
    if (s.life <= 0) continue;
    if (s.friendly) {
      for (const e of enemies) {
        if (e.dead || !overlap(s, e) || (s.hit && s.hit.has(e))) continue;
        let dmg = Math.max(1, Math.round(s.dmg - e.def / 4));
        if (e.boss) dmg = Math.floor(dmg / 2);
        const before = profLevel(s.spell.exp);
        s.spell.exp++;
        if (profLevel(s.spell.exp) > before) msg(`${SPELLS[s.spell.id].name}の熟練度が上がった！（Lv${profLevel(s.spell.exp)}）`, 'good');
        damageEnemy(e, dmg);
        burst(s.x + 6, s.y + 6, '#80c0ff', 8);
        if (s.pierce) s.hit.add(e); else { s.life = 0; break; }
      }
    } else if (overlap(s, p) && p.inv <= 0) {
      hurtPlayer(s.dmg, s);
      s.life = 0;
    }
  }
  shots = shots.filter(s => s.life > 0);
}

// ---------------------------------------------------------------- 演出
function addText(x, y, text, color) { texts.push({ x, y, text, color, life: 50 }); }
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 20 + rnd(0, 20), color });
  }
}
function slash(x, y) { parts.push({ x, y, slash: true, life: 8 }); }

function updateEffects() {
  for (const q of parts) { if (!q.slash) { q.x += q.vx; q.y += q.vy; if (!isTop()) q.vy += 0.12; } q.life--; }
  parts = parts.filter(q => q.life > 0);
  for (const t of texts) { t.y -= 0.6; t.life--; }
  texts = texts.filter(t => t.life > 0);
  if (area.def.theme === 'lair' && G.time % 6 === 0) {
    parts.push({ x: rnd(0, area.w * T), y: area.h * T, vx: Math.random() - 0.5, vy: -1 - Math.random() * 1.5, life: 120, color: '#ff6020', ember: true });
  }
}

// ---------------------------------------------------------------- 扉・遷移
function enterDoor(c) {
  if (SHOP_CHARS.has(c)) { SFX.door(); openShop(c); return; }
  const link = area.def.links[c];
  if (!link) return;
  const gate = area.def.gate && area.def.gate[c];
  if (gate === 'crowns' && G.p.crowns < CROWNS_NEEDED) {
    msgThrottle('gate', `扉には3つのくぼみがある。守護者の王冠が必要なようだ。（${G.p.crowns} / ${CROWNS_NEEDED}）`, 'bad');
    SFX.bad();
    return;
  }
  SFX.door();
  G.fade = { t: 0, dur: 30, cb: () => { loadArea(link[0], { door: link[1] }); msg(`${AREAS[link[0]].name}に入った。`); } };
}

// ---------------------------------------------------------------- メインの更新
function updateWorld() {
  if (G.fade) {
    G.fade.t++;
    if (G.fade.t === G.fade.dur / 2) G.fade.cb();
    if (G.fade.t >= G.fade.dur) G.fade = null;
    return;
  }
  if (pressed.cancel) { openPause(); return; }
  if (pressed.status || pressed.ok) { openStatus(); return; }
  if (pressed.items) { openItems(); return; }

  G.time++;
  const p = G.p;
  updatePlayer();
  if (mode !== 'play' || G.fade) return; // 店に入った・死んだ・扉に入った
  if (G.freeze > 0) {
    if (--G.freeze === 0) msg('止まっていた時が動き出した。');
  } else {
    for (const e of enemies) if (!e.dead) updateEnemy(e);
  }
  enemies = enemies.filter(e => !e.dead);
  updateShots();
  updateEffects();

  // 食料と自然回復
  if (area.def.safe) {
    if (G.time % 60 === 0) { p.hp = Math.min(p.maxHp, p.hp + 1); p.mp = Math.min(p.maxMp, p.mp + 1); }
  } else {
    if (G.time % 180 === 0 && p.food > 0) {
      p.food--;
      if (p.food === 10) msg('食料が残りわずかだ！', 'bad');
      if (p.food === 0) msg('食料が尽きた！ 体力がどんどん減っていく…', 'bad');
    }
    if (p.food > 0) {
      if (G.time % 150 === 0) p.hp = Math.min(p.maxHp, p.hp + 1);
      if (G.time % 240 === 0) p.mp = Math.min(p.maxMp, p.mp + 1);
    } else if (G.time % 60 === 0) {
      p.hp = Math.max(0, p.hp - 2);
      if (p.hp <= 0) playerDied();
    }
  }

  if (G.endTimer > 0 && --G.endTimer === 0) openEnding();
  if (mode === 'play' && G.time % 6 === 0) updateHud();
}

function playerDied() {
  if (mode !== 'play') return;
  const p = G.p;
  if (p.tools.revive > 0) {
    p.tools.revive--;
    p.hp = p.maxHp;
    p.inv = 120;
    SFX.heal();
    burst(p.x + p.w / 2, p.y + p.h / 2, '#ffd84a', 30);
    msg('命の霊薬が砕け散り、あなたはよみがえった！', 'info');
    return;
  }
  SFX.hurt();
  msg('あなたは力尽きた…', 'bad');
  updateHud();
  openMenu(() => ({
    title: 'GAME OVER',
    text: 'あなたは地の底で力尽きた…',
    cancelable: false,
    items: [
      { label: '宿屋の記録から再開', disabled: !hasSave(), action: () => (loadGame() ? 'play' : 'keep') },
      { label: 'はじめから', action: () => { newGame(); return 'play'; } },
      { label: 'タイトルへ', action: () => { G = null; return 'title'; } },
    ],
  }), 'title');
}

// ---------------------------------------------------------------- メニュー
let menu = null;
function openMenu(builder, returnMode) {
  menu = { builder, sel: 0, returnMode: returnMode || (menu ? menu.returnMode : mode) };
  mode = 'menu';
  renderMenu();
}
function closeMenu(next) {
  const m = menu;
  menu = null;
  $menu.classList.add('hidden');
  mode = next || (m ? m.returnMode : 'play');
  if (mode === 'title') openTitle();
  if (G && mode === 'play') updateHud();
}
function renderMenu() {
  const d = menu.builder();
  if (G && area) updateHud();
  menu.data = d;
  if (menu.sel >= d.items.length) menu.sel = d.items.length - 1;
  if (menu.sel < 0) menu.sel = 0;
  $menu.innerHTML = `<div class="mbox">
    <h2>${d.title}</h2>
    ${d.text ? `<div class="mtext">${d.text}</div>` : ''}
    <ul>${d.items.map((it, i) => `<li data-i="${i}" class="${i === menu.sel ? 'sel' : ''} ${it.disabled ? 'dis' : ''}">
      <span>${it.label}</span>${it.sub ? `<small>${it.sub}</small>` : ''}</li>`).join('')}</ul>
    <div class="mfoot">↑↓ 選択　Z・Enter 決定${d.cancelable === false ? '' : '　X・Esc 戻る'}</div>
    ${d.cancelable === false ? '' : '<button class="mclose" aria-label="戻る">×</button>'}
  </div>`;
  $menu.classList.remove('hidden');
  $menu.querySelectorAll('li').forEach(li => {
    const i = +li.dataset.i;
    // 作り直すとタップが消えるので、選択の見た目だけ切り替える
    li.addEventListener('mouseenter', () => { if (menu && menu.sel !== i) { menu.sel = i; updateMenuSel(); } });
    li.addEventListener('click', () => { if (menu) { menu.sel = i; chooseMenu(); } });
  });
  const close = $menu.querySelector('.mclose');
  if (close) close.addEventListener('click', () => { if (menu) cancelMenu(); });
  updateMenuSel();
}
function updateMenuSel() {
  $menu.querySelectorAll('li').forEach(li => {
    const on = +li.dataset.i === menu.sel;
    li.classList.toggle('sel', on);
    if (on) li.scrollIntoView({ block: 'nearest' });
  });
}
function cancelMenu() {
  if (menu.data.back) menu.data.back(); else closeMenu();
}
function chooseMenu() {
  const it = menu.data.items[menu.sel];
  if (!it || it.disabled) { SFX.bad(); return; }
  SFX.select();
  const before = menu;
  const r = it.action();
  if (menu !== before) return; // 別のメニューを開いた
  if (r === 'close') closeMenu();
  else if (r === 'play' || r === 'title') closeMenu(r);
  else renderMenu();
}
function menuInput() {
  if (!menu) return;
  const n = menu.data.items.length;
  if (pressed.up) { menu.sel = (menu.sel + n - 1) % n; SFX.select(); updateMenuSel(); }
  if (pressed.down) { menu.sel = (menu.sel + 1) % n; SFX.select(); updateMenuSel(); }
  if (pressed.jump || pressed.ok) chooseMenu();
  else if ((pressed.magic || pressed.cancel) && menu.data.cancelable !== false) cancelMenu();
}

function openTitle() {
  mode = 'title';
  openMenu(() => ({
    title: '地底の竜 -XANADU-like-',
    text: `町の東にある地下迷宮の奥深く、\n伝説の竜が棲むという。\n3体の守護者から王冠を奪い、竜を討て！\n\nver ${VERSION}`,
    cancelable: false,
    items: [
      { label: 'はじめから', action: () => { newGame(); return 'play'; } },
      { label: 'つづきから', sub: hasSave() ? '' : '記録なし', disabled: !hasSave(), action: () => (loadGame() ? 'play' : 'keep') },
      { label: '遊び方', action: () => { openHowTo(); } },
    ],
  }), 'title');
}

function openHowTo() {
  openMenu(() => ({
    title: '遊び方',
    text: [
      '・敵には体当たりで攻撃。武器・防具・魔法は使うほど熟練度が上がる。',
      '・迷宮の魔物は倒すと二度と現れない。経験値と金は有限だ。',
      '・王から授かった金を、訓練（能力）と装備のどちらに使うかはあなた次第。',
      '・経験値がたまったら寺院でレベルを上げてもらう。',
      '・罪なき精霊を殺すとカルマが増え、寺院でレベルを上げてもらえなくなる。',
      '・迷宮では食料が減る。尽きるとHPが減っていく。',
      '・つるはし（D キー）でレンガを掘れる。壁の向こうに隠し部屋があるかも…',
      '・各層の守護者を倒して王冠を集めよ。3つそろえば竜の巣への扉が開く。',
      '・竜はドラゴンスレイヤーでしか斬れないという…',
    ].join('\n'),
    back: () => openTitle(),
    items: [{ label: 'もどる', action: () => { openTitle(); } }],
  }), 'title');
}

function openPause() {
  openMenu(() => ({
    title: 'ポーズ',
    text: `場所: ${area.def.name}\nプレイ時間: ${fmtTime(G.time)}`,
    items: [
      { label: 'ゲームにもどる', action: () => 'close' },
      { label: 'ステータス', action: () => { openStatus(); } },
      { label: '道具', action: () => { openItems(); } },
      { label: 'タイトルへ（記録していない進行は失われます）', action: () => { G = null; return 'title'; } },
    ],
  }), 'play');
}

function fmtTime(frames) {
  const s = Math.floor(frames / 60);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function statusText() {
  const p = G.p, cw = curWeapon(), sp = curSpell();
  return [
    `レベル ${p.level}　経験値 ${p.xp} / 次 ${needXp(p.level)}`,
    `HP ${p.hp}/${p.maxHp}　MP ${p.mp}/${p.maxMp}`,
    `STR ${p.str}　DEF ${p.def}（合計防御 ${totalDef()}）　AGI ${p.agi}　INT ${p.int}`,
    `カルマ ${p.karma}　所持金 ${p.gold}G　食料 ${p.food}　王冠 ${p.crowns}/${CROWNS_NEEDED}`,
    `武器 ${WEAPONS[cw.id].name}（熟練Lv${profLevel(cw.exp)}）`,
    `防具 ${ARMORS[p.armor].name}（Lv${profLevel(p.armorExp[p.armor] || 0)}）　盾 ${p.shield ? `${SHIELDS[p.shield].name}（Lv${profLevel(p.shieldExp[p.shield] || 0)}）` : 'なし'}`,
    `魔法 ${SPELLS[sp.id].name}（熟練Lv${profLevel(sp.exp)}・威力${spellPower(sp)}）`,
    `鍵 ${p.keys}　薬 ${p.potions}　魔法の水 ${p.elixirs}${p.lamp ? '　ランプ' : ''}`,
  ].join('\n');
}

function openStatus() {
  const p = G.p;
  openMenu(() => ({
    title: 'ステータス',
    text: statusText(),
    items: [
      { label: '武器を持ちかえる', action: () => { openEquip('weapon'); } },
      { label: '鎧を着がえる', action: () => { openEquip('armor'); } },
      { label: '盾を持ちかえる', disabled: !p.shields.length, action: () => { openEquip('shield'); } },
      { label: '魔法を選ぶ', action: () => { openEquip('spell'); } },
      { label: '道具', action: () => { openItems(); } },
      { label: '閉じる', action: () => 'close' },
    ],
  }), 'play');
}

function openItems() {
  const p = G.p;
  openMenu(() => ({
    title: '道具',
    text: '使う道具を選んでください。',
    items: [
      { label: '薬', sub: `${p.potions}個`, disabled: !p.potions, action: () => { usePotion(); } },
      { label: '魔法の水', sub: `${p.elixirs}個`, disabled: !p.elixirs, action: () => { useElixir(); } },
      ...Object.entries(TOOLS).map(([id, t]) => ({
        label: t.name, sub: `${p.tools[id]}個`, disabled: !p.tools[id],
        action: () => (useTool(id) && id !== 'revive' ? 'close' : undefined),
      })),
      { label: '閉じる', action: () => 'close' },
    ],
  }), 'play');
}

function openEquip(kind) {
  const p = G.p;
  openMenu(() => {
    let items;
    if (kind === 'weapon') {
      items = p.weapons.map((w, i) => ({
        label: `${i === p.weapon ? 'E ' : '　'}${WEAPONS[w.id].name}`,
        sub: `攻撃${WEAPONS[w.id].atk} 熟練Lv${profLevel(w.exp)}`,
        action: () => { p.weapon = i; },
      }));
    } else if (kind === 'armor') {
      items = p.armors.map(id => ({
        label: `${id === p.armor ? 'E ' : '　'}${ARMORS[id].name}`, sub: `防御${ARMORS[id].def} 熟練Lv${profLevel(p.armorExp[id] || 0)}`,
        action: () => { p.armor = id; },
      }));
    } else if (kind === 'shield') {
      items = p.shields.map(id => ({
        label: `${id === p.shield ? 'E ' : '　'}${SHIELDS[id].name}`, sub: `防御${SHIELDS[id].def} 熟練Lv${profLevel(p.shieldExp[id] || 0)}`,
        action: () => { p.shield = id; },
      }));
    } else {
      items = p.spells.map((s, i) => ({
        label: `${i === p.spell ? 'E ' : '　'}${SPELLS[s.id].name}`, sub: `MP${SPELLS[s.id].mp} 熟練Lv${profLevel(s.exp)}`,
        action: () => { p.spell = i; },
      }));
    }
    items.push({ label: 'もどる', action: () => { openStatus(); } });
    return { title: { weapon: '武器', armor: '鎧', shield: '盾', spell: '魔法' }[kind], items, back: () => openStatus() };
  }, 'play');
}

// ---------------------------------------------------------------- 店
let shopTalk = '';
function openShop(c) {
  const p = G.p;
  shopTalk = '';
  const leave = { label: '店を出る', action: () => 'close' };
  const wallet = () => `所持金 ${p.gold}G`;
  const talk = () => (shopTalk ? '\n\n' + shopTalk : '');
  const buy = (price, fn) => () => {
    if (p.gold < price) { shopTalk = '「お金が足りないよ。」'; SFX.bad(); return; }
    p.gold -= price;
    fn();
    SFX.coin();
  };
  const limited = (n, label, fn) => () => {
    if (n() >= MAX_ITEM) { shopTalk = `「${label}はもう持ちきれないよ。」`; SFX.bad(); return; }
    fn();
  };

  if (c === 'K') {
    openMenu(() => ({
      title: '王城・訓練所',
      text: wallet() + `\nSTR ${p.str}　DEF ${p.def}　AGI ${p.agi}　INT ${p.int}　最大HP ${p.maxHp}` +
        (shopTalk ? talk() : '\n\n王「金は力にも、剣にもなる。限られた金をどう使うかは、そなた次第だ。」'),
      items: Object.entries(TRAINING).map(([id, t]) => {
        const cost = trainCost(id, p.train[id]);
        return {
          label: t.name, sub: `${cost}G`,
          action: buy(cost, () => {
            p.train[id]++;
            if (id === 'hp') { p.maxHp += 10; p.hp += 10; }
            else if (id === 'int') { p.int++; p.maxMp += 2; p.mp += 2; }
            else p[id]++;
            shopTalk = '教官「よし、その調子だ！」';
          }),
        };
      }).concat([leave]),
    }), 'play');
  } else if (c === 'W') {
    openMenu(() => ({
      title: '武器屋「鋼の牙」',
      text: wallet() + (shopTalk ? talk() : '\n\n「使い慣れた剣は、新しい名剣にも勝ることがあるぜ。」'),
      items: Object.entries(WEAPONS).filter(([, w]) => w.price > 0).map(([id, w]) => {
        const owned = p.weapons.some(x => x.id === id);
        return {
          label: w.name, sub: owned ? '所持' : `攻撃${w.atk}　${w.price}G`, disabled: owned,
          action: buy(w.price, () => {
            p.weapons.push({ id, exp: 0 });
            p.weapon = p.weapons.length - 1;
            shopTalk = `「${w.name}だね。毎度あり！」（装備した）`;
            msg(`${w.name}を買った。`, 'good');
          }),
        };
      }).concat([leave]),
    }), 'play');
  } else if (c === 'A') {
    openMenu(() => ({
      title: '防具屋「岩の守り」',
      text: wallet() + talk(),
      items: Object.entries(ARMORS).filter(([, a]) => a.price > 0).map(([id, a]) => {
        const owned = p.armors.includes(id);
        return {
          label: a.name, sub: owned ? '所持' : `防御${a.def}　${a.price}G`, disabled: owned,
          action: buy(a.price, () => { p.armors.push(id); p.armor = id; shopTalk = `「${a.name}、よく似合うよ。」（装備した）`; msg(`${a.name}を買った。`, 'good'); }),
        };
      }).concat(Object.entries(SHIELDS).map(([id, s]) => {
        const owned = p.shields.includes(id);
        return {
          label: s.name, sub: owned ? '所持' : `防御${s.def}　${s.price}G`, disabled: owned,
          action: buy(s.price, () => { p.shields.push(id); p.shield = id; shopTalk = `「${s.name}だね。」（装備した）`; msg(`${s.name}を買った。`, 'good'); }),
        };
      })).concat([leave]),
    }), 'play');
  } else if (c === 'F') {
    const town = area.id === 'town';
    openMenu(() => ({
      title: town ? '道具屋「旅のそなえ」' : '地下の商人',
      text: wallet() + `\n食料 ${p.food}　薬 ${p.potions}　魔法の水 ${p.elixirs}　鍵 ${p.keys}　つるはし ${p.tools.mattock}` +
        (shopTalk ? talk() : '\n\n「迷宮の壁の向こうにはお宝が眠ってるって噂だ。つるはしはいかが？」'),
      items: [
        { label: '食料 ×20', sub: '15G', action: buy(15, () => { p.food = Math.min(MAX_FOOD, p.food + 20); shopTalk = '「腹が減っては戦はできぬ、だ。」'; }) },
        { label: '食料 ×100', sub: '60G', action: buy(60, () => { p.food = Math.min(MAX_FOOD, p.food + 100); shopTalk = '「たっぷり持っていきな。」'; }) },
        { label: '薬（HP回復）', sub: '30G', action: limited(() => p.potions, '薬', buy(30, () => { p.potions++; shopTalk = '「薬だね。」'; })) },
        { label: '魔法の水（MP全回復）', sub: '50G', action: limited(() => p.elixirs, '魔法の水', buy(50, () => { p.elixirs++; shopTalk = '「魔法の水だね。」'; })) },
        { label: '鍵', sub: '80G', action: limited(() => p.keys, '鍵', buy(80, () => { p.keys++; shopTalk = '「鍵は迷宮の扉を開けるのに使うんだ。」'; })) },
        ...Object.entries(TOOLS).filter(([id]) => town || id !== 'revive').map(([id, t]) => ({
          label: t.name, sub: `${t.price}G`,
          action: limited(() => p.tools[id], t.name, buy(t.price, () => { p.tools[id]++; shopTalk = `「${t.desc}」`; })),
        })),
        leave,
      ],
    }), 'play');
  } else if (c === 'S') {
    openMenu(() => ({
      title: '魔法屋「星読みの塔」',
      text: wallet() + `\nINT ${p.int}（魔法の威力は INT とレベルで決まる）` + talk(),
      items: Object.entries(SPELLS).filter(([, s]) => s.price > 0).map(([id, s]) => {
        const owned = p.spells.some(x => x.id === id);
        return {
          label: s.name, sub: owned ? '習得済み' : `${s.desc}　MP${s.mp}　${s.price}G`, disabled: owned,
          action: buy(s.price, () => {
            p.spells.push({ id, exp: 0 });
            p.spell = p.spells.length - 1;
            shopTalk = `「${s.name}の呪文を授けよう。Q キーで魔法を切り替えられる。」`;
            msg(`${s.name}の魔法を覚えた。`, 'good');
          }),
        };
      }).concat([leave]),
    }), 'play');
  } else if (c === 'I') {
    const cost = 10 + p.level * 5;
    openMenu(() => ({
      title: '宿屋「まどろみ亭」',
      text: wallet() + `\n「一晩 ${cost}G だよ。休めば旅の記録もつけておくよ。」` + talk(),
      items: [
        {
          label: '泊まる（全回復＋記録）', sub: `${cost}G`,
          action: buy(cost, () => {
            p.hp = p.maxHp; p.mp = p.maxMp;
            const ok = saveGame();
            SFX.heal();
            shopTalk = ok ? '「おはよう！ 旅の記録をつけておいたよ。」' : '「おはよう！（記録に失敗しました）」';
            msg('宿屋で休んだ。HPとMPが全回復した。', 'good');
          }),
        },
        leave,
      ],
    }), 'play');
  } else if (c === 'T') {
    openMenu(() => {
      const need = needXp(p.level);
      return {
        title: '寺院',
        text: wallet() + `\nレベル ${p.level}　経験値 ${p.xp} / ${need}　カルマ ${p.karma}` +
          (shopTalk ? talk() : '\n\n「地下には罪なき精霊がさまよう。彼らを殺めてはならぬ。」'),
        items: [
          {
            label: 'レベルを上げてもらう', disabled: p.xp < need,
            action: () => {
              if (p.karma > 0) { shopTalk = '「汝の業（カルマ）は深い…。今のままでは力を授けられぬ。」'; SFX.bad(); return; }
              while (p.xp >= needXp(p.level)) levelUp();
              shopTalk = `「神の祝福を。汝はレベル ${p.level} となった。」`;
              msg(`レベルが ${p.level} に上がった！`, 'info');
              SFX.level();
            },
          },
          {
            label: 'お布施をして業を清める', sub: `${p.karma * 50}G`, disabled: p.karma === 0,
            action: buy(p.karma * 50, () => { p.karma = 0; shopTalk = '「汝の罪は清められた。」'; msg('カルマが 0 になった。', 'good'); }),
          },
          leave,
        ],
      };
    }, 'play');
  }
}

function levelUp() {
  const p = G.p;
  p.level++;
  p.maxHp += 15 + rnd(0, 5);
  p.maxMp += 3;
  p.str += 2;
  p.def += 1;
  p.agi += 1;
  p.int += 1;
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}

function openEnding() {
  const p = G.p;
  SFX.level();
  const killed = Object.keys(G.state.killed).length;
  openMenu(() => ({
    title: '— 竜は滅びた —',
    text: `地の底を支配していた竜は倒れ、\n町に平和が戻った。\n\nレベル ${p.level}　所持金 ${p.gold}G　カルマ ${p.karma}\n倒した魔物 ${killed}体　プレイ時間 ${fmtTime(G.time)}\n\nTHANK YOU FOR PLAYING!`,
    cancelable: false,
    items: [
      { label: 'このまま冒険を続ける', action: () => 'play' },
      { label: 'タイトルへ', action: () => { G = null; return 'title'; } },
    ],
  }), 'play');
}

// ---------------------------------------------------------------- HUD
function updateHud() {
  if (!G) { $hud.innerHTML = ''; return; }
  const p = G.p, cw = curWeapon(), sp = curSpell();
  const need = needXp(p.level);
  const pct = (a, b) => Math.max(0, Math.min(100, (a / b) * 100));
  const left = remaining();
  $hud.innerHTML = `
  <div class="hud-row">
    <b>Lv ${p.level}</b>
    <span class="bar hp"><i style="width:${pct(p.hp, p.maxHp)}%"></i><em>HP ${p.hp}/${p.maxHp}</em></span>
    <span class="bar mp"><i style="width:${pct(p.mp, p.maxMp)}%"></i><em>MP ${p.mp}/${p.maxMp}</em></span>
    <span class="${p.xp >= need ? 'ready' : ''}">EXP ${p.xp}/${need}${p.xp >= need ? '（寺院へ）' : ''}</span>
    <span>${area.def.name}${area.total ? `（魔物 残り ${left}/${area.total}）` : ''}</span>
  </div>
  <div class="hud-row">
    <span>金 ${p.gold}G</span>
    <span class="${p.food <= 10 ? 'warn' : ''}">食料 ${p.food}</span>
    <span class="${p.karma > 0 ? 'warn' : ''}">カルマ ${p.karma}</span>
    <span>王冠 ${p.crowns}/${CROWNS_NEEDED}</span>
    <span>鍵 ${p.keys}</span><span>薬 ${p.potions}</span><span>魔法の水 ${p.elixirs}</span>
    <span>つるはし ${p.tools.mattock}</span>
    <span>STR ${p.str} DEF ${totalDef()} AGI ${p.agi} INT ${p.int}</span>
  </div>
  <div class="hud-row">
    <span>武器 ${WEAPONS[cw.id].name}（熟練Lv${profLevel(cw.exp)}）</span>
    <span>防具 ${ARMORS[p.armor].name}</span>
    <span>盾 ${p.shield ? SHIELDS[p.shield].name : 'なし'}</span>
    <span>魔法 ${SPELLS[sp.id].name}（Lv${profLevel(sp.exp)}）</span>
    ${G.freeze > 0 ? '<span class="ready">時間停止中</span>' : ''}
  </div>`;
}

// ---------------------------------------------------------------- 描画
const THEMES = {
  town: { brick: '#7a5a3a', mortar: '#4a3420', hi: '#9a7650', stone: '#8a8a96', stoneDark: '#55556a', back: '#e8d8b0', backLine: '#8a6a40', grass: '#3cb043' },
  cave: { bgc: '#120c0a', brick: '#8a5a34', mortar: '#3a2414', hi: '#a87444', stone: '#6e6058', stoneDark: '#3e3430', back: '#2a1c16', backLine: '#1c120d' },
  ice:  { bgc: '#0a0e18', brick: '#4a6488', mortar: '#1e2a40', hi: '#6a88b0', stone: '#5a6a80', stoneDark: '#2a3448', back: '#18223a', backLine: '#101828' },
  deep: { bgc: '#0e0814', brick: '#6a3a7a', mortar: '#2a1236', hi: '#8a5a9a', stone: '#5a4a68', stoneDark: '#2e2238', back: '#1e1028', backLine: '#140a1c' },
  lair: { bgc: '#140404', brick: '#8a2a1a', mortar: '#3a0e08', hi: '#b04424', stone: '#6a3a30', stoneDark: '#3a1a14', back: '#2a0c08', backLine: '#1c0604' },
  room: { bgc: '#000', brick: '#5a5a6a', mortar: '#2a2a34', hi: '#7a7a8c', stone: '#5a5a6a', stoneDark: '#2a2a34', back: '#3a3428', backLine: '#2a2418' },
};
const SHOP_SIGNS = { K: '王', W: '武', A: '防', F: '道', S: '魔', I: '宿', T: '寺' };

const tileCache = {};
function tileImage(theme, key, drawFn) {
  const k = theme + '|' + key;
  if (!tileCache[k]) {
    const c = document.createElement('canvas');
    c.width = c.height = T;
    drawFn(c.getContext('2d'), THEMES[theme]);
    tileCache[k] = c;
  }
  return tileCache[k];
}

function drawBricks(g, base, mortar, hi) {
  g.fillStyle = base; g.fillRect(0, 0, T, T);
  for (let r = 0; r < 4; r++) {
    g.fillStyle = hi; g.fillRect(0, r * 8, T, 1);
    g.fillStyle = mortar; g.fillRect(0, r * 8 + 7, T, 1);
    const off = (r % 2) * 8;
    for (let x = off; x < T; x += 16) g.fillRect(x, r * 8, 1, 7);
  }
}
function drawBackWall(g, th) {
  g.fillStyle = th.back; g.fillRect(0, 0, T, T);
  g.fillStyle = th.backLine;
  g.fillRect(0, 15, T, 1); g.fillRect(0, 31, T, 1);
  g.fillRect(8, 0, 1, 15); g.fillRect(24, 16, 1, 15);
}
function drawFloor(g, th) {
  g.fillStyle = th.back; g.fillRect(0, 0, T, T);
  g.fillStyle = th.backLine;
  g.fillRect(0, 0, T, 1); g.fillRect(0, 0, 1, T);
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(1, 1, 15, 15); g.fillRect(17, 17, 14, 14);
}

function bgKey(ch) {
  // 背景の上に描く記号は、まず背景を描く
  if (area.def.theme !== 'town') return '.';
  return ch === 'a' ? ',' : ch === 't' ? ' ' : '.';
}

function drawTile(ch, tx, ty, sx, sy) {
  const th = area.def.theme;
  const T2 = THEMES[th];
  if (ch === ' ') return;
  if (ch === '#') {
    if (th === 'room') { // 見下ろし視点の壁：上面と側面
      const face = !isSolid(tx, ty + 1);
      ctx.drawImage(tileImage(th, '#' + (face ? 'f' : ''), g => {
        g.fillStyle = '#4a4a58'; g.fillRect(0, 0, T, T);
        g.fillStyle = '#5c5c6c'; g.fillRect(2, 2, T - 4, T - 4);
        if (face) {
          drawBricks(g, '#6a6a7a', '#34343e', '#8a8a9a');
          g.fillStyle = '#5c5c6c';
          g.fillRect(0, 0, T, 12);
        }
      }), sx, sy);
      return;
    }
    const top = !isSolid(tx, ty - 1);
    ctx.drawImage(tileImage(th, '#' + (top ? 't' : ''), g => {
      drawBricks(g, T2.brick, T2.mortar, T2.hi);
      if (top && T2.grass) { g.fillStyle = T2.grass; g.fillRect(0, 0, T, 5); g.fillRect(4, 5, 2, 2); g.fillRect(17, 5, 2, 3); g.fillRect(27, 5, 2, 2); }
    }), sx, sy);
    return;
  }
  if (ch === '=') {
    ctx.drawImage(tileImage(th, '=', g => {
      g.fillStyle = T2.stone; g.fillRect(0, 0, T, T);
      g.fillStyle = T2.stoneDark; g.fillRect(0, T - 3, T, 3); g.fillRect(T - 3, 0, 3, T);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, T, 2); g.fillRect(0, 0, 2, T);
      g.fillStyle = T2.stoneDark; g.fillRect(9, 10, 4, 2); g.fillRect(20, 19, 3, 2);
    }), sx, sy);
    return;
  }
  if (ch === '.') {
    if (th === 'town') {
      ctx.drawImage(tileImage(th, 'house', g => {
        g.fillStyle = T2.back; g.fillRect(0, 0, T, T);
        g.fillStyle = T2.backLine; g.fillRect(0, 0, T, 2); g.fillRect(0, 0, 2, T); g.fillRect(15, 0, 2, T);
      }), sx, sy);
      if (tile(tx, ty - 1) !== '.') { // 屋根
        const castle = tile(tx, ty + 5) === 'K' || tile(tx - 1, ty + 5) === 'K' || tile(tx - 2, ty + 5) === 'K' ||
          tile(tx + 1, ty + 5) === 'K' || tile(tx + 2, ty + 5) === 'K' || tile(tx + 3, ty + 5) === 'K';
        if (castle) { // 王城は城壁の凸凹
          ctx.fillStyle = '#9a9aa8';
          ctx.fillRect(sx, sy - 8, T, 10);
          ctx.fillStyle = '#c8c8d4';
          ctx.fillRect(sx + 2, sy - 16, 12, 8); ctx.fillRect(sx + 18, sy - 16, 12, 8);
        } else {
          ctx.fillStyle = '#a03828';
          ctx.fillRect(sx - 4, sy - 10, T + 8, 12);
          ctx.fillStyle = '#c04838';
          ctx.fillRect(sx - 4, sy - 10, T + 8, 3);
        }
      } else if (tile(tx, ty + 1) === '.' && (tx % 3 !== 1)) { // 窓
        ctx.fillStyle = '#4a3420'; ctx.fillRect(sx + 7, sy + 8, 18, 16);
        ctx.fillStyle = '#ffe38a'; ctx.fillRect(sx + 9, sy + 10, 6, 5); ctx.fillRect(sx + 17, sy + 10, 6, 5);
        ctx.fillRect(sx + 9, sy + 17, 6, 5); ctx.fillRect(sx + 17, sy + 17, 6, 5);
      }
    } else if (th === 'room') {
      ctx.drawImage(tileImage(th, '.', g => drawFloor(g, T2)), sx, sy);
    } else {
      ctx.drawImage(tileImage(th, '.', g => drawBackWall(g, T2)), sx, sy);
    }
    return;
  }
  if (ch === ',') { ctx.fillStyle = '#16100c'; ctx.fillRect(sx, sy, T, T); return; }

  // ここから先は背景つき
  const bg = bgKey(ch);
  if (bg !== ch) drawTile(bg, tx, ty, sx, sy);

  if (ch === 'H') {
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(sx + 6, sy, 4, T); ctx.fillRect(sx + 22, sy, 4, T);
    ctx.fillStyle = '#c08a4a';
    for (let y = 4; y < T; y += 10) ctx.fillRect(sx + 6, sy + y, 20, 3);
  } else if (ch === '-') {
    ctx.fillStyle = '#9a6a3a'; ctx.fillRect(sx, sy, T, 8);
    ctx.fillStyle = '#c8945a'; ctx.fillRect(sx, sy, T, 2);
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(sx + 15, sy, 2, 8); ctx.fillRect(sx, sy + 7, T, 1);
  } else if (ch === '^') {
    ctx.fillStyle = '#c8c8d8';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(sx + i * 8, sy + T); ctx.lineTo(sx + i * 8 + 4, sy + T - 14); ctx.lineTo(sx + i * 8 + 8, sy + T);
      ctx.fill();
    }
  } else if (ch === '+') {
    ctx.fillStyle = '#4a4a5a'; ctx.fillRect(sx + 2, sy, T - 4, T);
    ctx.fillStyle = '#7a7a8a';
    for (let x = 6; x < T - 4; x += 7) ctx.fillRect(sx + x, sy, 3, T);
    ctx.fillStyle = '#2a2a34'; ctx.fillRect(sx + 2, sy + 12, T - 4, 4);
    if (tile(tx, ty + 1) !== '+') { ctx.fillStyle = '#ffd84a'; ctx.fillRect(sx + 13, sy + 4, 6, 6); ctx.fillStyle = '#000'; ctx.fillRect(sx + 15, sy + 6, 2, 4); }
  } else if (/[a-h]/.test(ch)) {
    const gated = area.def.gate && area.def.gate[ch];
    if (isTop()) { // 見下ろし視点では下り階段
      ctx.fillStyle = '#000'; ctx.fillRect(sx + 2, sy + 2, T - 4, T - 4);
      ctx.fillStyle = '#8a8070';
      for (let i = 0; i < 4; i++) ctx.fillRect(sx + 4 + i * 3, sy + 4 + i * 6, T - 8 - i * 6, 3);
    } else {
      ctx.fillStyle = '#000'; ctx.fillRect(sx + 3, sy + 2, T - 6, T - 2);
      ctx.fillStyle = gated ? '#7a1a1a' : ch === 'e' ? '#3a3a6a' : '#6a4220'; ctx.fillRect(sx + 6, sy + 6, T - 12, T - 6);
      ctx.fillStyle = '#4a2a10'; ctx.fillRect(sx + 15, sy + 6, 2, T - 6);
      ctx.fillStyle = '#ffd84a'; ctx.fillRect(sx + 19, sy + 18, 3, 3);
      if (gated) { // 王冠のくぼみ
        for (let i = 0; i < CROWNS_NEEDED; i++) { ctx.fillStyle = i < G.p.crowns ? '#ffd84a' : '#2a0a0a'; ctx.fillRect(sx + 8 + i * 6, sy + 9, 4, 4); }
      }
    }
    // 上向き矢印（↑で入れる）
    if (Math.floor(G.time / 30) % 2 === 0 && Math.abs(G.p.x + G.p.w / 2 - (sx + cam.x + 16)) < 24 && Math.abs(G.p.y - (sy + cam.y)) < 32) {
      ctx.fillStyle = '#fff'; ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(isTop() ? 'Z' : '↑', sx + 16, sy - 6);
    }
  } else if (SHOP_CHARS.has(ch)) {
    ctx.fillStyle = '#3a2410'; ctx.fillRect(sx + 4, sy + 4, T - 8, T - 4);
    ctx.fillStyle = ch === 'K' ? '#5a2a8a' : '#8a5a2a'; ctx.fillRect(sx + 7, sy + 7, T - 14, T - 7);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(sx + 19, sy + 19, 3, 3);
    // 看板
    ctx.fillStyle = '#2a1a0a'; ctx.fillRect(sx + 4, sy - 26, T - 8, 22);
    ctx.fillStyle = '#f0e0b0'; ctx.fillRect(sx + 6, sy - 24, T - 12, 18);
    ctx.fillStyle = '#802010'; ctx.font = `16px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(SHOP_SIGNS[ch], sx + 16, sy - 9);
  } else if (ch === 't') {
    ctx.fillStyle = '#6a4220'; ctx.fillRect(sx + 13, sy + 8, 6, 24);
    ctx.fillStyle = '#2a8a3a';
    ctx.beginPath(); ctx.arc(sx + 16, sy - 2, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3cb043';
    ctx.beginPath(); ctx.arc(sx + 11, sy - 7, 8, 0, Math.PI * 2); ctx.fill();
  }
}

function snapCamera() {
  const p = G.p;
  const mw = area.w * T, mh = area.h * T;
  cam.x = mw <= VW ? (mw - VW) / 2 : clamp(Math.round(p.x + p.w / 2 - VW / 2), 0, mw - VW);
  cam.y = mh <= VH ? (mh - VH) / 2 : clamp(Math.round(p.y + p.h / 2 - VH / 2), 0, mh - VH);
}

function drawSpr(name, x, y, faceRight, scale = 2) {
  const s = SPR[name];
  if (!s) return;
  ctx.drawImage(faceRight ? s.r : s.l, Math.round(x), Math.round(y), 16 * scale, 16 * scale);
}

// 暗闇（第3層）：プレイヤーの周りだけ見える。ランプがあれば広く見える
const darkCv = document.createElement('canvas');
darkCv.width = VW; darkCv.height = VH;
function drawDarkness() {
  const p = G.p, d = darkCv.getContext('2d');
  const x = p.x + p.w / 2 - cam.x, y = p.y + p.h / 2 - cam.y;
  const r = (p.lamp ? 230 : 90) + Math.sin(G.time / 7) * 3;
  d.globalCompositeOperation = 'source-over';
  d.clearRect(0, 0, VW, VH);
  d.fillStyle = 'rgba(0,0,0,0.96)';
  d.fillRect(0, 0, VW, VH);
  d.globalCompositeOperation = 'destination-out';
  const grd = d.createRadialGradient(x, y, r * 0.35, x, y, r);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  d.fillStyle = grd;
  d.fillRect(0, 0, VW, VH);
  ctx.drawImage(darkCv, 0, 0);
}

const ITEM_SPR = { '$': 'gold', '!': 'potion', '*': 'elixir', '?': 'key', '%': 'food', '&': 'slayer', m: 'mattock', G: 'wing', Q: 'hourglass', R: 'revive', L: 'lamp' };

function render() {
  ctx.textAlign = 'left';
  if (mode === 'title' || !G) { renderTitle(); return; }
  snapCamera();
  const th = area.def.theme;
  // 背景
  if (th === 'town') {
    const grd = ctx.createLinearGradient(0, 0, 0, VH);
    grd.addColorStop(0, '#4a8ae8'); grd.addColorStop(1, '#bfe4ff');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, VW, VH);
    // 遠くの山（パララックス）
    ctx.fillStyle = '#7aa0c8';
    ctx.beginPath(); ctx.moveTo(0, VH);
    for (let x = 0; x <= VW; x += 20) ctx.lineTo(x, 200 + Math.sin((x + cam.x * 0.3) / 70) * 40 + Math.sin((x + cam.x * 0.3) / 23) * 10 - cam.y);
    ctx.lineTo(VW, VH); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 190 - cam.x * 0.15 + G.time * 0.1) % (VW + 200) + VW + 200) % (VW + 200) - 100;
      ctx.beginPath(); ctx.ellipse(cx, 50 + (i % 3) * 30, 40, 12, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.fillStyle = THEMES[th].bgc; ctx.fillRect(0, 0, VW, VH);
  }
  // タイル
  const tx0 = Math.floor(cam.x / T), ty0 = Math.floor(cam.y / T);
  for (let ty = ty0 - 1; ty <= ty0 + Math.ceil(VH / T) + 1; ty++) {
    for (let tx = tx0; tx <= tx0 + Math.ceil(VW / T); tx++) {
      if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) continue;
      drawTile(area.grid[ty][tx], tx, ty, tx * T - cam.x, ty * T - cam.y);
    }
  }
  // アイテム
  for (const it of items) {
    const bob = Math.sin(G.time / 15 + it.bob) * 2;
    if (it.ch === '&' || it.ch === 'L') {
      ctx.fillStyle = it.ch === 'L' ? `rgba(255,216,74,${0.25 + Math.sin(G.time / 10) * 0.15})` : `rgba(128,224,255,${0.25 + Math.sin(G.time / 10) * 0.15})`;
      ctx.beginPath(); ctx.arc(it.x + 12 - cam.x, it.y + 14 - cam.y, 20, 0, Math.PI * 2); ctx.fill();
    }
    drawSpr(ITEM_SPR[it.ch], it.x - 4 - cam.x, it.y - 4 + bob - cam.y, true);
  }
  // 敵
  for (const e of enemies) {
    if (e.flash && e.flash % 2) continue;
    if (e.peaceful) ctx.globalAlpha = 0.7;
    let name = e.spr;
    if (name === 'bat') name = Math.floor(e.t / 8) % 2 ? 'bat0' : 'bat1';
    const size = 16 * e.scale;
    const sq = (name === 'slime' || name === 'kingslime') ? Math.sin(e.t / 6) * (e.scale / 2) : 0;
    const yoff = e.boss ? 6 : 0;
    drawSpr(name, e.x + e.w / 2 - size / 2 - cam.x, e.y + e.h - size + yoff + sq - cam.y, e.dir > 0, e.scale);
    ctx.globalAlpha = 1;
    if (!e.peaceful && e.hp < e.maxHp) {
      const bw = e.boss || e.guardian ? 60 : 24;
      const bx = e.x + e.w / 2 - bw / 2 - cam.x, by = e.y - 8 - cam.y;
      ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#e04050'; ctx.fillRect(bx, by, bw * Math.max(0, e.hp) / e.maxHp, 3);
    }
  }
  // プレイヤー
  const p = G.p;
  if (!(p.inv > 0 && Math.floor(p.inv / 3) % 2)) {
    const moving = isTop() ? (keys.left || keys.right || keys.up || keys.down) : (p.onGround && p.vx);
    const frame = p.climb || moving ? Math.floor(p.anim / 8) % 2 : 0;
    const face = p.climb ? Math.floor(p.anim / 8) % 2 === 0 : p.dir > 0;
    drawSpr(frame ? 'hero1' : 'hero0', p.x + p.w / 2 - 16 - cam.x, p.y + p.h - 32 - cam.y, face);
  }
  // 弾
  for (const s of shots) {
    const x = s.x + 6 - cam.x, y = s.y + 6 - cam.y;
    if (s.kind === 'needle') {
      ctx.strokeStyle = '#e0ffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - s.vx * 2, y - s.vy * 2); ctx.lineTo(x + s.vx, y + s.vy); ctx.stroke();
      continue;
    }
    const col = !s.friendly ? ['rgba(255,120,30,0.5)', '#ffe080'] : s.kind === 'thunder' ? ['rgba(255,240,80,0.5)', '#ffffc0'] : ['rgba(80,160,255,0.5)', '#c0e8ff'];
    ctx.fillStyle = col[0];
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col[1];
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  // パーティクル
  for (const q of parts) {
    if (q.slash) {
      ctx.strokeStyle = `rgba(255,255,255,${q.life / 8})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(q.x - 10 - cam.x, q.y - 10 - cam.y); ctx.lineTo(q.x + 10 - cam.x, q.y + 10 - cam.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x + 10 - cam.x, q.y - 10 - cam.y); ctx.lineTo(q.x - 10 - cam.x, q.y + 10 - cam.y); ctx.stroke();
    } else {
      ctx.fillStyle = q.color;
      ctx.globalAlpha = Math.min(1, q.life / 20);
      ctx.fillRect(q.x - cam.x, q.y - cam.y, q.ember ? 2 : 3, q.ember ? 2 : 3);
      ctx.globalAlpha = 1;
    }
  }
  if (area.def.dark) drawDarkness();
  // ダメージ表示
  ctx.font = `bold 14px ${FONT}`; ctx.textAlign = 'center';
  for (const t of texts) {
    ctx.fillStyle = '#000'; ctx.fillText(t.text, t.x - cam.x + 1, t.y - cam.y + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.x - cam.x, t.y - cam.y);
  }
  ctx.textAlign = 'left';
  // 時間停止
  if (G.freeze > 0) {
    ctx.fillStyle = 'rgba(80,120,255,0.15)';
    ctx.fillRect(0, 0, VW, VH);
  }
  // フェード
  if (G.fade) {
    const h = G.fade.dur / 2;
    ctx.fillStyle = `rgba(0,0,0,${1 - Math.abs(G.fade.t - h) / h})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  // 食料切れ・瀕死の赤フラッシュ
  if ((p.food === 0 || p.hp < p.maxHp * 0.2) && !area.def.safe) {
    ctx.fillStyle = `rgba(255,0,0,${0.08 + Math.sin(G.time / 10) * 0.05})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  if (document.body.classList.contains('touch')) drawMiniHud();
}

// スマホでは HUD が画面外になりやすいので、画面の左上にも最低限の情報を出す
function drawMiniHud() {
  const p = G.p;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(4, 4, 262, 58);
  ctx.font = `bold 16px ${FONT}`; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText(`Lv${p.level}`, 10, 26);
  const bar = (y, v, max, col) => {
    ctx.fillStyle = '#222'; ctx.fillRect(56, y, 150, 10);
    ctx.fillStyle = col; ctx.fillRect(56, y, 150 * Math.max(0, v) / max, 10);
  };
  bar(11, p.hp, p.maxHp, '#e04050');
  bar(26, p.mp, p.maxMp, '#4080f0');
  ctx.fillStyle = '#fff'; ctx.font = `13px ${FONT}`;
  ctx.fillText(`${p.hp}`, 212, 21);
  ctx.fillText(`${p.mp}`, 212, 36);
  ctx.fillStyle = p.food <= 10 ? '#ff6060' : '#ffd84a';
  ctx.fillText(`${p.gold}G  食料${p.food}  鍵${p.keys}  王冠${p.crowns}`, 10, 56);
}

let titleT = 0;
function renderTitle() {
  titleT++;
  const grd = ctx.createLinearGradient(0, 0, 0, VH);
  grd.addColorStop(0, '#05030a'); grd.addColorStop(1, '#3a0a08');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, VW, VH);
  for (let i = 0; i < 40; i++) {
    const x = (i * 97 + titleT * (0.3 + (i % 5) * 0.1)) % VW;
    const y = VH - ((i * 53 + titleT * (0.5 + (i % 3) * 0.3)) % VH);
    ctx.fillStyle = i % 2 ? '#ff6020' : '#ffa040';
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 0.35;
  drawSpr('dragon', VW / 2 - 128, 120 + Math.sin(titleT / 30) * 8, false, 16);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- ループ
function step() {
  if (mode === 'menu') menuInput();
  else if (mode === 'play' && G) updateWorld();
  for (const k in pressed) delete pressed[k];
}

let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; }
  render();
  requestAnimationFrame(loop);
}

openTitle();
requestAnimationFrame(loop);
