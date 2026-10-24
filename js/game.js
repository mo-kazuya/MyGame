'use strict';
const T = 32, VW = 640, VH = 416;
const FONT = "'DotGothic16', 'MS Gothic', monospace";
const SAVE_KEY = 'xanaduLike.save.v1';

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

// ---------------------------------------------------------------- 入力
const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyZ: 'jump', Space: 'jump', KeyX: 'magic', KeyA: 'potion', KeyS: 'elixir',
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
let G = null;          // { p, state, time, fade, endTimer }
let area = null;       // 現在のエリア
let enemies = [], items = [], shots = [], parts = [], texts = [];
let mode = 'title';    // title / play / menu
let cam = { x: 0, y: 0 };

function newPlayer() {
  return {
    x: 0, y: 0, w: 20, h: 28, vx: 0, vy: 0, dir: 1,
    onGround: false, climb: false, drop: 0, atkCool: 0, inv: 0, anim: 0,
    level: 1, xp: 0, hp: 50, maxHp: 50, mp: 10, maxMp: 10,
    str: 5, def: 2, agi: 5, karma: 0, gold: 120, food: 60,
    keys: 0, potions: 1, elixirs: 0,
    weapons: [{ id: 'dagger', exp: 0 }], weapon: 0,
    armors: ['cloth'], armor: 'cloth', shields: [], shield: null,
  };
}

function newGame() {
  G = { p: newPlayer(), state: { taken: {}, opened: {}, flags: {}, visited: {} }, time: 0, fade: null, endTimer: 0, xpNotice: 0 };
  logLines.length = 0;
  loadArea('town', { start: true });
  msg('竜が棲むという地下迷宮の入口が、町の東にある。', 'info');
  msg('町の店で装備を整えて挑もう。敵には体当たりで攻撃だ！');
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
    G = { p: Object.assign(newPlayer(), d.p), state: d.state, time: d.time || 0, fade: null, endTimer: 0, xpNotice: 0 };
    logLines.length = 0;
    loadArea('town', { door: 'I' });
    msg('宿屋で目を覚ました。', 'info');
    return true;
  } catch (e) { return false; }
}

const curWeapon = () => G.p.weapons[G.p.weapon];
const totalDef = () => G.p.def + ARMORS[G.p.armor].def + (G.p.shield ? SHIELDS[G.p.shield].def : 0);

// ---------------------------------------------------------------- エリア
const ITEM_CHARS = '$!*?%&';
const DOOR_CHARS = new Set('abcdefghWAFIT'.split(''));
const SHOP_CHARS = new Set('WAFIT'.split(''));
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
  area = { id, def, grid, w, h: grid.length };
  enemies = []; items = []; shots = []; parts = []; texts = [];
  let start = null;
  for (let y = 0; y < area.h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      const key = `${id}:${x}:${y}`;
      if (ch === '+' && G.state.opened[key]) grid[y][x] = def.bg;
      else if (ch === 'P') { start = { x, y }; grid[y][x] = def.bg; }
      else if (ch >= '1' && ch <= '9') {
        grid[y][x] = def.bg;
        if (!(ENEMIES[ch].boss && G.state.flags.dragon)) spawnEnemy(ch, x, y);
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

function spawnEnemy(ch, tx, ty) {
  const d = ENEMIES[ch];
  const e = Object.assign({}, d, {
    type: ch, maxHp: d.hp, vx: 0, vy: 0, dir: -1, cool: 30, flash: 0, onGround: false,
    t: rnd(0, 200), state: 'hover', st: 0,
  });
  e.x = tx * T + (T - e.w) / 2;
  e.y = (e.ai === 'fly' || e.ai === 'ghost') ? ty * T - e.h / 2 : ty * T + T - e.h;
  enemies.push(e);
}

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

// ---------------------------------------------------------------- プレイヤー
function updatePlayer() {
  const p = G.p;
  if (p.atkCool > 0) p.atkCool--;
  if (p.inv > 0) p.inv--;
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
    else if (keys.down && p.onGround && ladderBelow) { p.climb = true; p.y += 3; }
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
  if (dirIn) p.dir = dirIn;
  if (pressed.jump && p.onGround) { p.vy = -8; p.onGround = false; SFX.jump(); }
  if (keys.down && p.onGround && tileAtPx(cx, p.y + p.h + 2) === '-') p.drop = 10;
  p.vy = Math.min(p.vy + 0.45, 9);

  const hx = moveX(p, p.vx);
  if (hx && tile(hx.tx, hx.ty) === '+') tryUnlock(hx.tx, hx.ty);
  bumpEnemies(dirIn);

  p.onGround = false;
  const hy = moveY(p, p.vy, p.drop <= 0);
  if (p.drop > 0) p.drop--;
  if (hy) { if (p.vy > 0) p.onGround = true; p.vy = 0; }
  if (dirIn && p.onGround) p.anim++;

  // 魔法・道具
  if (pressed.magic) castMagic();
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

function bumpEnemies(dirIn) {
  const p = G.p;
  for (const e of enemies) {
    if (e.dead || !overlap(p, e)) continue;
    const pc = p.x + p.w / 2, ec = e.x + e.w / 2;
    if (!e.boss) {
      const before = p.x;
      p.x = pc < ec ? e.x - p.w : e.x + e.w;
      // 押し戻した先が壁なら敵の方を押す
      const tmp = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (moveX(tmp, 0.01) || moveX(tmp, -0.02)) { p.x = before; moveX(e, pc < ec ? 4 : -4); }
    }
    const towards = (pc < ec && dirIn > 0) || (pc > ec && dirIn < 0);
    if (towards && p.atkCool <= 0) playerAttack(e);
  }
}

function playerAttack(e) {
  const p = G.p;
  p.atkCool = Math.max(8, 20 - Math.floor(p.agi / 2));
  const cx = (p.x + p.w / 2 + e.x + e.w / 2) / 2, cy = Math.max(p.y, e.y) + 10;
  if (Math.random() < 0.08) { addText(cx, cy, 'MISS', '#aaaaff'); SFX.miss(); return; }
  const cw = curWeapon(), w = WEAPONS[cw.id];
  const wlBefore = weaponLevel(cw.exp);
  const atk = p.str + w.atk * (1 + 0.15 * wlBefore);
  let dmg = Math.max(1, Math.round(atk - e.def * 0.6 + rnd(-1, 2)));
  if (e.boss && !w.slayer) {
    dmg = 0;
    msgThrottle('slayer', 'ドラゴンの鱗は硬すぎる！ ドラゴンスレイヤーでなければ…', 'bad', 300);
  }
  cw.exp++;
  const wl = weaponLevel(cw.exp);
  if (wl > wlBefore) msg(`${w.name}の熟練度が上がった！（Lv${wl}）`, 'good');
  slash(cx, cy);
  damageEnemy(e, dmg);
  if (!e.boss && !e.dead) moveX(e, (e.x + e.w / 2 > p.x + p.w / 2 ? 1 : -1) * 6);
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
  p.xp += e.xp;
  p.gold += e.gold;
  SFX.kill();
  burst(e.x + e.w / 2, e.y + e.h / 2, e.boss ? '#ff8030' : '#ffffff', e.boss ? 60 : 14);
  addText(e.x + e.w / 2, e.y - 12, `+${e.xp}EXP`, '#8cf08c');
  if (e.karma) {
    p.karma += e.karma;
    msg(`罪なき${e.name}を殺してしまった… カルマが ${e.karma} 増えた。`, 'bad');
  } else {
    msg(`${e.name}を倒した。 経験値 ${e.xp}${e.gold ? ` / ${e.gold}G` : ''}`);
  }
  if (e.boss) {
    G.state.flags.dragon = true;
    G.endTimer = 180;
    msg('ドラゴンを倒した！！ 地の底に静寂が戻った…', 'info');
  }
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
  if (src && !p.climb) {
    const dir = (p.x + p.w / 2) < (src.x + src.w / 2) ? -1 : 1;
    moveX(p, dir * 10);
  }
  if (p.hp <= 0) playerDied();
}

function castMagic() {
  const p = G.p;
  if (p.mp < 3) { msgThrottle('nomp', 'MPが足りない。', 'bad', 60); SFX.bad(); return; }
  p.mp -= 3;
  SFX.magic();
  shots.push({
    x: p.x + p.w / 2 - 6 + p.dir * 10, y: p.y + 8, w: 12, h: 12,
    vx: p.dir * 6, vy: 0, life: 70, friendly: true, dmg: 6 + p.level * 3,
  });
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

function pickItem(it) {
  const p = G.p;
  const full = (n) => { if (n >= MAX_ITEM) { msgThrottle('full' + it.ch, 'これ以上持てない。'); return true; } return false; };
  switch (it.ch) {
    case '$': { const g = { d1: 50, d2: 150, d3: 300 }[area.id] || 50; p.gold += g; msg(`${g}G を拾った。`, 'good'); SFX.coin(); break; }
    case '!': if (full(p.potions)) return; p.potions++; msg('薬を手に入れた。', 'good'); SFX.item(); break;
    case '*': if (full(p.elixirs)) return; p.elixirs++; msg('魔法の水を手に入れた。', 'good'); SFX.item(); break;
    case '?': if (full(p.keys)) return; p.keys++; msg('鍵を手に入れた。', 'good'); SFX.item(); break;
    case '%': p.food = Math.min(MAX_FOOD, p.food + 40); msg('食料を見つけた。（+40）', 'good'); SFX.item(); break;
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

  if (e.ai === 'walk') {
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
  } else if (e.ai === 'boss') {
    updateBoss(e, dx);
  }

  // プレイヤーと重ならないよう押し戻す
  if (!e.boss && overlap(e, p)) {
    const target = (e.x + e.w / 2 < p.x + p.w / 2) ? p.x - e.w : p.x + p.w;
    moveX(e, clamp(target - e.x, -T + 1, T - 1));
  }
  // 接触攻撃
  if (!e.peaceful && e.cool <= 0 && p.inv <= 0 && (e.boss ? overlap(e, p) : touching(e, p, 2))) {
    hurtPlayer(e.atk, e);
    e.cool = e.rate;
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
    s.x += s.vx; s.y += s.vy; s.life--;
    if (isSolid(Math.floor((s.x + 6) / T), Math.floor((s.y + 6) / T))) { s.life = 0; burst(s.x + 6, s.y + 6, s.friendly ? '#80c0ff' : '#ff8030', 5); }
    if (s.life <= 0) continue;
    if (s.friendly) {
      for (const e of enemies) {
        if (e.dead || !overlap(s, e)) continue;
        let dmg = Math.max(1, Math.round(s.dmg - e.def / 4));
        if (e.boss) dmg = Math.floor(dmg / 2);
        damageEnemy(e, dmg);
        s.life = 0;
        burst(s.x + 6, s.y + 6, '#80c0ff', 8);
        break;
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
  for (const q of parts) { if (!q.slash) { q.x += q.vx; q.y += q.vy; q.vy += 0.12; } q.life--; }
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

  G.time++;
  const p = G.p;
  updatePlayer();
  if (mode !== 'play' || G.fade) return; // 店に入った・死んだ・扉に入った
  for (const e of enemies) if (!e.dead) updateEnemy(e);
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
  menu.data = d;
  if (menu.sel >= d.items.length) menu.sel = d.items.length - 1;
  if (menu.sel < 0) menu.sel = 0;
  $menu.innerHTML = `<div class="mbox">
    <h2>${d.title}</h2>
    ${d.text ? `<div class="mtext">${d.text}</div>` : ''}
    <ul>${d.items.map((it, i) => `<li data-i="${i}" class="${i === menu.sel ? 'sel' : ''} ${it.disabled ? 'dis' : ''}">
      <span>${it.label}</span>${it.sub ? `<small>${it.sub}</small>` : ''}</li>`).join('')}</ul>
    <div class="mfoot">↑↓ 選択　Z・Enter 決定${d.cancelable === false ? '' : '　X・Esc 戻る'}</div>
  </div>`;
  $menu.classList.remove('hidden');
  $menu.querySelectorAll('li').forEach(li => {
    const i = +li.dataset.i;
    li.addEventListener('mouseenter', () => { if (menu && menu.sel !== i) { menu.sel = i; renderMenu(); } });
    li.addEventListener('click', () => { if (menu) { menu.sel = i; chooseMenu(); } });
  });
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
  if (pressed.up) { menu.sel = (menu.sel + n - 1) % n; SFX.select(); renderMenu(); }
  if (pressed.down) { menu.sel = (menu.sel + 1) % n; SFX.select(); renderMenu(); }
  if (pressed.jump || pressed.ok) chooseMenu();
  else if ((pressed.magic || pressed.cancel) && menu.data.cancelable !== false) {
    if (menu.data.back) menu.data.back(); else closeMenu();
  }
}

function openTitle() {
  mode = 'title';
  openMenu(() => ({
    title: '地底の竜 -XANADU-like-',
    text: '町の東にある地下迷宮の奥深く、\n伝説の竜が棲むという。\n剣を取り、竜を討て！',
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
      '・敵には体当たりで攻撃する。武器は使うほど熟練度が上がり強くなる。',
      '・経験値がたまったら町の「寺院」でレベルを上げてもらう。',
      '・罪のない精霊を殺すとカルマが増え、寺院でレベルを上げてもらえなくなる。',
      '・迷宮では時間とともに食料が減る。尽きるとHPが減っていく。',
      '・宿屋で休むと全回復し、記録（セーブ）される。',
      '・鍵のかかった扉は鍵で開く。鍵は迷宮で拾うか道具屋で買える。',
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
      { label: 'タイトルへ（記録していない進行は失われます）', action: () => { G = null; return 'title'; } },
    ],
  }), 'play');
}

function fmtTime(frames) {
  const s = Math.floor(frames / 60);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function statusText() {
  const p = G.p, cw = curWeapon();
  return [
    `レベル ${p.level}　経験値 ${p.xp} / 次 ${needXp(p.level)}`,
    `HP ${p.hp}/${p.maxHp}　MP ${p.mp}/${p.maxMp}`,
    `STR ${p.str}　DEF ${p.def}（合計防御 ${totalDef()}）　AGI ${p.agi}`,
    `カルマ ${p.karma}　所持金 ${p.gold}G　食料 ${p.food}`,
    `武器 ${WEAPONS[cw.id].name}（熟練Lv${weaponLevel(cw.exp)}）`,
    `防具 ${ARMORS[p.armor].name}　盾 ${p.shield ? SHIELDS[p.shield].name : 'なし'}`,
    `鍵 ${p.keys}　薬 ${p.potions}　魔法の水 ${p.elixirs}`,
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
      { label: '薬を飲む', sub: `${p.potions}個`, disabled: !p.potions, action: () => { usePotion(); } },
      { label: '魔法の水を飲む', sub: `${p.elixirs}個`, disabled: !p.elixirs, action: () => { useElixir(); } },
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
        sub: `攻撃${WEAPONS[w.id].atk} 熟練Lv${weaponLevel(w.exp)}`,
        action: () => { p.weapon = i; },
      }));
    } else if (kind === 'armor') {
      items = p.armors.map(id => ({
        label: `${id === p.armor ? 'E ' : '　'}${ARMORS[id].name}`, sub: `防御${ARMORS[id].def}`,
        action: () => { p.armor = id; },
      }));
    } else {
      items = p.shields.map(id => ({
        label: `${id === p.shield ? 'E ' : '　'}${SHIELDS[id].name}`, sub: `防御${SHIELDS[id].def}`,
        action: () => { p.shield = id; },
      }));
    }
    items.push({ label: 'もどる', action: () => { openStatus(); } });
    return { title: { weapon: '武器', armor: '鎧', shield: '盾' }[kind], items, back: () => openStatus() };
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

  if (c === 'W') {
    openMenu(() => ({
      title: '武器屋「鋼の牙」',
      text: wallet() + talk(),
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
    const limited = (n, label, fn) => () => {
      if (n() >= MAX_ITEM) { shopTalk = `「${label}はもう持ちきれないよ。」`; SFX.bad(); return; }
      fn();
    };
    openMenu(() => ({
      title: area.id === 'town' ? '道具屋「旅のそなえ」' : '地下の商人',
      text: wallet() + `\n食料 ${p.food}　薬 ${p.potions}　魔法の水 ${p.elixirs}　鍵 ${p.keys}` + talk(),
      items: [
        { label: '食料 ×20', sub: '15G', action: buy(15, () => { p.food = Math.min(MAX_FOOD, p.food + 20); shopTalk = '「腹が減っては戦はできぬ、だ。」'; }) },
        { label: '食料 ×100', sub: '60G', action: buy(60, () => { p.food = Math.min(MAX_FOOD, p.food + 100); shopTalk = '「たっぷり持っていきな。」'; }) },
        { label: '薬（HP回復）', sub: '30G', action: limited(() => p.potions, '薬', buy(30, () => { p.potions++; shopTalk = '「薬だね。」'; })) },
        { label: '魔法の水（MP全回復）', sub: '50G', action: limited(() => p.elixirs, '魔法の水', buy(50, () => { p.elixirs++; shopTalk = '「魔法の水だね。」'; })) },
        { label: '鍵', sub: '80G', action: limited(() => p.keys, '鍵', buy(80, () => { p.keys++; shopTalk = '「鍵は迷宮の扉を開けるのに使うんだ。」'; })) },
        leave,
      ],
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
              let n = 0;
              while (p.xp >= needXp(p.level)) { levelUp(); n++; }
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
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}

function openEnding() {
  const p = G.p;
  SFX.level();
  openMenu(() => ({
    title: '— 竜は滅びた —',
    text: `地の底を支配していた竜は倒れ、\n町に平和が戻った。\n\nレベル ${p.level}　所持金 ${p.gold}G　カルマ ${p.karma}\nプレイ時間 ${fmtTime(G.time)}\n\nTHANK YOU FOR PLAYING!`,
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
  const p = G.p, cw = curWeapon();
  const need = needXp(p.level);
  const pct = (a, b) => Math.max(0, Math.min(100, (a / b) * 100));
  $hud.innerHTML = `
  <div class="hud-row">
    <b>Lv ${p.level}</b>
    <span class="bar hp"><i style="width:${pct(p.hp, p.maxHp)}%"></i><em>HP ${p.hp}/${p.maxHp}</em></span>
    <span class="bar mp"><i style="width:${pct(p.mp, p.maxMp)}%"></i><em>MP ${p.mp}/${p.maxMp}</em></span>
    <span class="${p.xp >= need ? 'ready' : ''}">EXP ${p.xp}/${need}${p.xp >= need ? '（寺院へ）' : ''}</span>
    <span>${area.def.name}</span>
  </div>
  <div class="hud-row">
    <span>金 ${p.gold}G</span>
    <span class="${p.food <= 10 ? 'warn' : ''}">食料 ${p.food}</span>
    <span class="${p.karma > 0 ? 'warn' : ''}">カルマ ${p.karma}</span>
    <span>鍵 ${p.keys}</span><span>薬 ${p.potions}</span><span>魔法の水 ${p.elixirs}</span>
    <span>STR ${p.str} DEF ${totalDef()} AGI ${p.agi}</span>
  </div>
  <div class="hud-row">
    <span>武器 ${WEAPONS[cw.id].name}（熟練Lv${weaponLevel(cw.exp)}）</span>
    <span>防具 ${ARMORS[p.armor].name}</span>
    <span>盾 ${p.shield ? SHIELDS[p.shield].name : 'なし'}</span>
  </div>`;
}

// ---------------------------------------------------------------- 描画
const THEMES = {
  town: { brick: '#7a5a3a', mortar: '#4a3420', hi: '#9a7650', stone: '#8a8a96', stoneDark: '#55556a', back: '#e8d8b0', backLine: '#8a6a40', grass: '#3cb043' },
  cave: { bgc: '#120c0a', brick: '#8a5a34', mortar: '#3a2414', hi: '#a87444', stone: '#6e6058', stoneDark: '#3e3430', back: '#2a1c16', backLine: '#1c120d' },
  ice:  { bgc: '#0a0e18', brick: '#4a6488', mortar: '#1e2a40', hi: '#6a88b0', stone: '#5a6a80', stoneDark: '#2a3448', back: '#18223a', backLine: '#101828' },
  deep: { bgc: '#0e0814', brick: '#6a3a7a', mortar: '#2a1236', hi: '#8a5a9a', stone: '#5a4a68', stoneDark: '#2e2238', back: '#1e1028', backLine: '#140a1c' },
  lair: { bgc: '#140404', brick: '#8a2a1a', mortar: '#3a0e08', hi: '#b04424', stone: '#6a3a30', stoneDark: '#3a1a14', back: '#2a0c08', backLine: '#1c0604' },
};
const SHOP_SIGNS = { W: '武', A: '防', F: '道', I: '宿', T: '寺' };

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
        ctx.fillStyle = '#a03828';
        ctx.fillRect(sx - 4, sy - 10, T + 8, 12);
        ctx.fillStyle = '#c04838';
        ctx.fillRect(sx - 4, sy - 10, T + 8, 3);
      } else if (tile(tx, ty + 1) === '.' && (tx % 3 !== 1)) { // 窓
        ctx.fillStyle = '#4a3420'; ctx.fillRect(sx + 7, sy + 8, 18, 16);
        ctx.fillStyle = '#ffe38a'; ctx.fillRect(sx + 9, sy + 10, 6, 5); ctx.fillRect(sx + 17, sy + 10, 6, 5);
        ctx.fillRect(sx + 9, sy + 17, 6, 5); ctx.fillRect(sx + 17, sy + 17, 6, 5);
      }
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
    ctx.fillStyle = '#000'; ctx.fillRect(sx + 3, sy + 2, T - 6, T - 2);
    ctx.fillStyle = '#6a4220'; ctx.fillRect(sx + 6, sy + 6, T - 12, T - 6);
    ctx.fillStyle = '#4a2a10'; ctx.fillRect(sx + 15, sy + 6, 2, T - 6);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(sx + 19, sy + 18, 3, 3);
    // 上向き矢印（↑で入れる）
    if (Math.floor(G.time / 30) % 2 === 0 && Math.abs(G.p.x + G.p.w / 2 - (sx + cam.x + 16)) < 24 && Math.abs(G.p.y - (sy + cam.y)) < 32) {
      ctx.fillStyle = '#fff'; ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('↑', sx + 16, sy - 6);
    }
  } else if (SHOP_CHARS.has(ch)) {
    ctx.fillStyle = '#3a2410'; ctx.fillRect(sx + 4, sy + 4, T - 8, T - 4);
    ctx.fillStyle = '#8a5a2a'; ctx.fillRect(sx + 7, sy + 7, T - 14, T - 7);
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
  const sprOf = { '$': 'gold', '!': 'potion', '*': 'elixir', '?': 'key', '%': 'food', '&': 'slayer' };
  for (const it of items) {
    const bob = Math.sin(G.time / 15 + it.bob) * 2;
    if (it.ch === '&') {
      ctx.fillStyle = `rgba(128,224,255,${0.25 + Math.sin(G.time / 10) * 0.15})`;
      ctx.beginPath(); ctx.arc(it.x + 12 - cam.x, it.y + 14 - cam.y, 20, 0, Math.PI * 2); ctx.fill();
    }
    drawSpr(sprOf[it.ch], it.x - 4 - cam.x, it.y - 4 + bob - cam.y, true);
  }
  // 敵
  for (const e of enemies) {
    if (e.flash && e.flash % 2) continue;
    if (e.peaceful) ctx.globalAlpha = 0.7;
    if (e.boss) {
      drawSpr('dragon', e.x + e.w / 2 - 32 - cam.x, e.y + e.h - 64 + 6 - cam.y, e.dir > 0, 4);
    } else {
      let name = e.spr;
      if (name === 'bat') name = Math.floor(e.t / 8) % 2 ? 'bat0' : 'bat1';
      const sq = name === 'slime' ? Math.sin(e.t / 6) : 0;
      drawSpr(name, e.x + e.w / 2 - 16 - cam.x, e.y + e.h - 32 + sq - cam.y, e.dir > 0);
    }
    ctx.globalAlpha = 1;
    if (!e.peaceful && e.hp < e.maxHp) {
      const bw = e.boss ? 60 : 24;
      const bx = e.x + e.w / 2 - bw / 2 - cam.x, by = e.y - 8 - cam.y;
      ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#e04050'; ctx.fillRect(bx, by, bw * Math.max(0, e.hp) / e.maxHp, 3);
    }
  }
  // プレイヤー
  const p = G.p;
  if (!(p.inv > 0 && Math.floor(p.inv / 3) % 2)) {
    const frame = p.climb ? (Math.floor(p.anim / 8) % 2) : (p.onGround && p.vx ? Math.floor(p.anim / 8) % 2 : 0);
    const face = p.climb ? Math.floor(p.anim / 8) % 2 === 0 : p.dir > 0;
    drawSpr(frame ? 'hero1' : 'hero0', p.x + p.w / 2 - 16 - cam.x, p.y + p.h - 32 - cam.y, face);
  }
  // 弾
  for (const s of shots) {
    const x = s.x + 6 - cam.x, y = s.y + 6 - cam.y;
    ctx.fillStyle = s.friendly ? 'rgba(80,160,255,0.5)' : 'rgba(255,120,30,0.5)';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.friendly ? '#c0e8ff' : '#ffe080';
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
  // ダメージ表示
  ctx.font = `bold 14px ${FONT}`; ctx.textAlign = 'center';
  for (const t of texts) {
    ctx.fillStyle = '#000'; ctx.fillText(t.text, t.x - cam.x + 1, t.y - cam.y + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.x - cam.x, t.y - cam.y);
  }
  ctx.textAlign = 'left';
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
