'use strict';
// 月夜の雀荘：4人打ちのリーチ麻雀（あなた + CPU 3人）
// ルール計算は rules.js（window.Mj）。ここは進行・CPU の思考・描画・操作。
(() => {
const R = window.Mj;
const $ = id => document.getElementById(id);
const cv = $('screen'), ctx = cv.getContext('2d');
const actionsEl = $('actions'), overlay = $('overlay');
// テスト用：URL の末尾に #auto を付けると 4 人とも CPU で一気に進める
//   #auto=shinobu,rin,rin,rin のように 4 人のキャラを指定できる（chars.js の id）
const AUTO_M = location.hash.match(/^#auto(?:=([a-z,]+))?/);
const AUTO = !!AUTO_M;
const AUTO_CHARS = AUTO_M && AUTO_M[1] ? AUTO_M[1].split(',') : null;
// テスト用：?exp=nodef,nolook のように強い思考の一部を切って比べる
const EXP = (new URLSearchParams(location.search).get('exp') || '').split(',');

const { CHARS, byId: CHAR, DEFAULT_STYLE, TOUR } = window.MJ_CHARS;
const charOf = s => (G && G.chars ? CHAR[G.chars[s]] : null);
const nameOf = s => (isHuman(s) ? 'あなた' : charOf(s) ? charOf(s).name : 'CPU');
const styleOf = s => (charOf(s) ? charOf(s).style : DEFAULT_STYLE);
const WIND = R.WIND;
const AKA_IDS = new Set([16, 52, 88]); // 赤ドラ（5萬・5筒・5索の 1 枚ずつ）
const kindOf = id => id >> 2;
const SPEED = { slow: 950, normal: 600, fast: 280 };
const LS = { settings: 'mahjong.settings', stats: 'mahjong.stats', save: 'mahjong.save', tour: 'mahjong.tour' };

function load(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 保存できなくても遊べる */ } }
function unstore(key) { try { localStorage.removeItem(key); } catch (e) { /* */ } }

const settings = Object.assign({ length: 'east', aka: true, speed: 'normal', hint: true, noCall: false, sound: true, rivals: ['haru', 'natsu', 'aki'] }, load(LS.settings, {}));
const saveSettings = () => store(LS.settings, settings);

// ---------- 進行の土台 ----------
let G = null;      // 対局（点数・局・本場など）。G.h が今の局
let gen = 0;       // タイトルへ戻るたびに増やし、進行中の処理を止める
class Abort extends Error {}
let dirty = true;
function sleep(ms) {
  if (AUTO && window.__freeze) return new Promise(() => {}); // テスト用：画面を止める
  const g = gen;
  return new Promise((res, rej) => setTimeout(() => (g === gen ? res() : rej(new Abort())), AUTO ? 0 : ms));
}
// 人間の操作待ち
let pending = null;
function ask(kind, opts) {
  const g = gen;
  return new Promise((res, rej) => {
    pending = {
      kind, opts, gen: g,
      resolve: v => { pending = null; ui.riichiMode = false; ui.selected = null; renderActions(); dirty = true; res(v); },
      reject: rej,
    };
    renderActions(); dirty = true;
  });
}
function abortAll() {
  gen++;
  if (pending) { const p = pending; pending = null; p.reject(new Abort()); }
  ui.riichiMode = false; ui.selected = null;
  renderActions();
}
const ui = { selected: null, hover: null, riichiMode: false, tenpaiMap: null, hits: [] };

const isHuman = s => !AUTO && s === 0;
const dealerSeat = () => (G.startDealer + G.roundNum) % 4;
const roundWind = () => 27 + Math.floor(G.roundNum / 4);
const seatWind = s => 27 + (s - dealerSeat() + 4) % 4;
const lastRound = () => (G.length === 'half' ? 7 : 3);
const roundName = () => WIND[Math.floor(G.roundNum / 4)] + (G.roundNum % 4 + 1) + '局';
function counts(ids) { const c = new Array(34).fill(0); for (const id of ids) c[id >> 2]++; return c; }
const liveLeft = () => G.h.liveEnd - G.h.livePos;
const isMenzen = p => p.melds.every(m => m.t === 'ankan');
const isAka = id => !!(G && G.aka) && AKA_IDS.has(id);
const kname = k => R.NAMES[k];

// ---------- 局の準備 ----------
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function newPlayer() {
  return { hand: [], melds: [], discards: [], riichi: false, riichiPaid: false, doubleRiichi: false, ippatsu: false, riichiSeq: -1,
    furitenTemp: false, furitenRiichi: false, waits: [], drawn: null, forbid: null };
}
function setupHand() {
  const wall = shuffle(Array.from({ length: 136 }, (_, i) => i));
  // 王牌（最後の 14 枚）：[0..3] 嶺上牌 [4..8] ドラ表示牌 [9..13] 裏ドラ表示牌
  const h = { wall, livePos: 0, liveEnd: 122, dead: wall.slice(122), rinshan: 0, doraN: 1, kans: 0,
    anyCall: false, cur: dealerSeat(), last: null, pops: [], reveal: [false, false, false, false], seq: 0, P: [] };
  for (let s = 0; s < 4; s++) h.P.push(newPlayer());
  for (let i = 0; i < 13; i++) for (let j = 0; j < 4; j++) h.P[(dealerSeat() + j) % 4].hand.push(wall[h.livePos++]);
  for (const p of h.P) { p.hand.sort((a, b) => a - b); p.waits = R.waits(counts(p.hand), 0); }
  return h;
}
const doraIndicators = () => G.h.dead.slice(4, 4 + G.h.doraN);
const uraIndicators = () => G.h.dead.slice(9, 9 + G.h.doraN);
const doraKinds = () => doraIndicators().map(id => R.doraOf(kindOf(id)));

function evalMelds(p) {
  return p.melds.map(m => ({ t: m.t === 'chi' ? 'chi' : m.t === 'pon' ? 'pon' : 'kan', k: m.k, open: m.t !== 'ankan' }));
}
// 和了できるか評価（ron があればその牌でロン、なければ手の中の drawn でツモ）
function evalWin(seat, ronId, f) {
  const h = G.h, p = h.P[seat];
  const ids = ronId == null ? p.hand : p.hand.concat([ronId]);
  const winId = ronId == null ? p.drawn : ronId;
  if (winId == null) return null;
  const allIds = ids.concat(...p.melds.map(m => m.ids));
  const dk = doraKinds();
  let dora = 0, aka = 0, ura = 0;
  for (const id of allIds) { for (const d of dk) if (kindOf(id) === d) dora++; if (isAka(id)) aka++; }
  if (p.riichi) {
    const uk = uraIndicators().map(id => R.doraOf(kindOf(id)));
    for (const id of allIds) for (const d of uk) if (kindOf(id) === d) ura++;
  }
  const cc = counts(ids);
  if (!R.isAgari(cc.slice(), p.melds.length)) return null;
  const first = f.first;
  return R.evaluate({
    cc, melds: evalMelds(p), win: kindOf(winId), tsumo: !!f.tsumo,
    seatWind: seatWind(seat), roundWind: roundWind(),
    riichi: p.riichi, doubleRiichi: p.doubleRiichi, ippatsu: p.ippatsu,
    last: !!f.last, rinshan: !!f.rinshan, chankan: !!f.chankan,
    tenhou: first && seat === dealerSeat(), chiihou: first && seat !== dealerSeat(),
    dora, aka, ura,
  });
}
function isFuriten(p) {
  return p.furitenTemp || p.furitenRiichi || p.discards.some(d => p.waits.includes(kindOf(d.id)));
}
function markPass(p) { p.furitenTemp = true; if (p.riichi) p.furitenRiichi = true; }

function kanOptions(seat) {
  const h = G.h, p = h.P[seat];
  if (h.kans >= 4 || liveLeft() === 0) return [];
  const c = counts(p.hand), out = [];
  if (p.riichi) {
    // リーチ後は、ツモった牌で暗槓しても待ちが変わらないときだけ
    const k = kindOf(p.drawn);
    if (c[k] === 4) {
      const before = counts(p.hand.filter(id => id !== p.drawn));
      const after = c.slice(); after[k] = 0;
      const w0 = R.waits(before, p.melds.length), w1 = R.waits(after, p.melds.length + 1);
      if (w0.length && w0.join() === w1.join()) out.push({ kan: 'ankan', k });
    }
    return out;
  }
  for (let k = 0; k < 34; k++) if (c[k] === 4) out.push({ kan: 'ankan', k });
  for (const m of p.melds) if (m.t === 'pon' && c[m.k]) out.push({ kan: 'kakan', k: m.k });
  return out;
}
// 捨てるとテンパイになる牌（リーチできる牌）
function riichiDiscards(p) {
  const out = [];
  const c = counts(p.hand);
  const ok = {};
  for (const id of p.hand) {
    const k = kindOf(id);
    if (ok[k] === undefined) { c[k]--; ok[k] = R.waits(c, p.melds.length).length > 0; c[k]++; }
    if (ok[k]) out.push(id);
  }
  return out;
}
function tenpaiMap(p) {
  const map = new Map(), c = counts(p.hand);
  for (const id of p.hand) {
    const k = kindOf(id);
    if (map.has(k)) continue;
    c[k]--; const w = R.waits(c, p.melds.length); c[k]++;
    if (w.length) map.set(k, w);
  }
  return map;
}

// ---------- 対局の流れ ----------
// opt.chars: 4 席のキャラ id（0 番はあなたなので null）、opt.mode: 'free' | 'tour'
function newMatch(snap, opt) {
  G = snap ? Object.assign({}, snap) : {
    scores: [25000, 25000, 25000, 25000], roundNum: 0, honba: 0, sticks: 0,
    startDealer: Math.floor(Math.random() * 4),
    length: opt.mode === 'tour' ? 'east' : settings.length, aka: settings.aka,
    chars: opt.chars, mode: opt.mode,
  };
  if (!G.chars) G.chars = [null, 'haru', 'natsu', 'aki'];
  G.h = null;
}
function snapshot() {
  return { scores: G.scores.slice(), roundNum: G.roundNum, honba: G.honba, sticks: G.sticks, startDealer: G.startDealer, length: G.length, aka: G.aka, chars: G.chars, mode: G.mode };
}
async function playMatch() {
  try {
    for (;;) {
      if (!AUTO) store(LS.save, snapshot());
      const res = await playHand();
      const dealer = dealerSeat();
      if (G.scores.some(s => s < 0)) break; // 飛び
      if (res.renchan) {
        G.honba++;
        // オーラスで親がトップなら終了（あがりやめ・テンパイやめ）
        if (G.roundNum === lastRound() && G.scores.every((s, i) => i === dealer || s < G.scores[dealer])) break;
      } else {
        G.honba = res.draw ? G.honba + 1 : 0;
        G.roundNum++;
        if (G.roundNum > lastRound()) break;
      }
    }
    unstore(LS.save);
    await showFinal();
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
  }
}
function ranking() {
  // 同点は起家に近い順
  return [0, 1, 2, 3].sort((a, b) => G.scores[b] - G.scores[a] || ((a - G.startDealer + 4) % 4) - ((b - G.startDealer + 4) % 4));
}

async function playHand() {
  const h = G.h = setupHand();
  ui.tenpaiMap = null;
  dirty = true;
  await sleep(500);
  let seat = dealerSeat();
  let drawn = drawLive(seat);
  let tctx = {};
  for (;;) {
    const act = await takeTurn(seat, drawn, tctx);
    if (act.type === 'tsumo') return finishWin(seat, act.ev, -1);
    if (act.type === 'kan') {
      const res = await doSelfKan(seat, act);
      if (res) return res;
      drawn = rinshanDraw(seat); tctx = { rinshan: true };
      continue;
    }
    await doDiscard(seat, act.id, act.riichi);
    const ron = await checkRon(seat, act.id, false);
    if (ron) return ron;
    const p = h.P[seat];
    if (act.riichi) {
      p.riichiPaid = true; p.ippatsu = true; p.riichiSeq = h.seq;
      if (AUTO) seatStat(seat, 'riichi');
      G.scores[seat] -= 1000; G.sticks++;
      dirty = true;
    }
    if (liveLeft() === 0) return exhaustiveDraw();
    const call = await checkCalls(seat, act.id);
    if (call) {
      performCall(call, seat, act.id);
      seat = call.seat;
      await sleep(SPEED[settings.speed] * 0.6);
      if (call.type === 'kan') { drawn = rinshanDraw(seat); tctx = { rinshan: true }; }
      else { drawn = null; tctx = { afterCall: true, forbid: call.forbid }; }
      continue;
    }
    seat = (seat + 1) % 4;
    drawn = drawLive(seat);
    tctx = {};
  }
}
function drawLive(seat) {
  const h = G.h, id = h.wall[h.livePos++];
  h.P[seat].hand.push(id); h.P[seat].drawn = id; h.cur = seat; dirty = true;
  return id;
}
function rinshanDraw(seat) {
  const h = G.h, id = h.dead[h.rinshan++];
  h.liveEnd--; h.doraN++;
  h.P[seat].hand.push(id); h.P[seat].drawn = id; h.cur = seat; dirty = true;
  return id;
}
function pop(seat, text) { G.h.pops.push({ seat, text, t: performance.now() }); dirty = true; }

async function takeTurn(seat, drawn, tctx) {
  const h = G.h, p = h.P[seat];
  h.cur = seat;
  if (drawn == null) p.drawn = null;
  const opts = { kans: [], forbid: tctx.forbid || null };
  p.forbid = opts.forbid;
  if (drawn != null) {
    const ev = evalWin(seat, null, { tsumo: true, rinshan: tctx.rinshan, last: !tctx.rinshan && liveLeft() === 0, first: p.discards.length === 0 && !h.anyCall });
    if (ev) opts.tsumo = ev;
    opts.kans = kanOptions(seat);
    if (!p.riichi && isMenzen(p) && G.scores[seat] >= 1000 && liveLeft() >= 4) {
      const rd = riichiDiscards(p);
      if (rd.length) opts.riichi = rd;
    }
  }
  dirty = true;
  if (isHuman(seat)) {
    ui.tenpaiMap = settings.hint && !p.riichi ? tenpaiMap(p) : null;
    if (p.riichi && !opts.tsumo && !opts.kans.length) {
      await sleep(450);
      return { type: 'discard', id: p.drawn };
    }
    const a = await ask('turn', opts);
    ui.tenpaiMap = null;
    return a;
  }
  await sleep(SPEED[settings.speed] * (p.riichi ? 0.6 : 1));
  return cpuTurn(seat, opts);
}

async function doDiscard(seat, id, riichi) {
  const h = G.h, p = h.P[seat];
  p.hand.splice(p.hand.indexOf(id), 1);
  p.hand.sort((a, b) => a - b);
  h.seq++;
  p.discards.push({ id, riichi: !!riichi, called: false, seq: h.seq, tsumogiri: id === p.drawn });
  p.drawn = null; p.forbid = null;
  p.furitenTemp = false;
  if (p.riichi && !riichi) p.ippatsu = false;
  if (riichi) {
    p.riichi = true;
    p.doubleRiichi = p.discards.length === 1 && !h.anyCall;
    pop(seat, 'リーチ'); snd('call');
  } else snd('tile');
  p.waits = R.waits(counts(p.hand), p.melds.length);
  h.last = { seat, id };
  dirty = true;
  await sleep(riichi ? 700 : 120);
}

async function checkRon(from, id, chankan) {
  const h = G.h;
  const k = kindOf(id);
  for (let i = 1; i <= 3; i++) {
    const s = (from + i) % 4, q = h.P[s];
    if (!q.waits.includes(k)) continue;
    const ev = evalWin(s, id, { tsumo: false, chankan, last: !chankan && liveLeft() === 0 });
    if (!ev || isFuriten(q)) { markPass(q); continue; }
    if (isHuman(s)) {
      const a = await ask('call', { ron: ev });
      if (a.type !== 'ron') { markPass(q); continue; }
    }
    return finishWin(s, ev, from, id);
  }
  return null;
}

function chiOptions(q, k) {
  if (k >= 27) return [];
  const n = k % 9, c = counts(q.hand), out = [];
  if (n >= 2 && c[k - 2] && c[k - 1]) out.push([k - 2, k - 1]);
  if (n >= 1 && n <= 7 && c[k - 1] && c[k + 1]) out.push([k - 1, k + 1]);
  if (n <= 6 && c[k + 1] && c[k + 2]) out.push([k + 1, k + 2]);
  return out;
}
function chiForbid(k, pair) {
  const f = [k], n = k % 9;
  if (pair[0] === k + 1 && n <= 5) f.push(k + 3);
  if (pair[1] === k - 1 && n >= 3) f.push(k - 3);
  return f;
}
async function checkCalls(from, id) {
  const h = G.h, k = kindOf(id);
  const next = (from + 1) % 4;
  const optsOf = s => {
    const q = h.P[s];
    if (q.riichi) return null;
    const c = counts(q.hand)[k];
    const o = { pon: c >= 2, kan: c >= 3 && h.kans < 4, chis: s === next ? chiOptions(q, k) : [] };
    return o.pon || o.kan || o.chis.length ? o : null;
  };
  // CPU の希望
  let cpuPon = null, cpuChi = null;
  for (let i = 1; i <= 3; i++) {
    const s = (from + i) % 4;
    if (isHuman(s)) continue;
    const o = optsOf(s);
    if (!o) continue;
    if (!cpuPon && o.pon && cpuWantsCall(s, k, [k, k])) cpuPon = { seat: s, type: 'pon', kinds: [k, k], forbid: [k] };
    if (!cpuChi && o.chis.length) {
      for (const pair of o.chis) if (cpuWantsCall(s, k, pair)) { cpuChi = { seat: s, type: 'chi', kinds: pair, forbid: chiForbid(k, pair) }; break; }
    }
  }
  // 人間
  const ho = isHuman(0) && from !== 0 ? optsOf(0) : null;
  if (ho && !settings.noCall && !(cpuPon && !ho.pon && !ho.kan)) {
    const a = await ask('call', ho);
    if (a.type === 'pon') return { seat: 0, type: 'pon', kinds: [k, k], forbid: [k] };
    if (a.type === 'kan') return { seat: 0, type: 'kan', kinds: [k, k, k] };
    if (a.type === 'chi') return { seat: 0, type: 'chi', kinds: a.pair, forbid: chiForbid(k, a.pair) };
  }
  return cpuPon || cpuChi;
}
function takeKinds(p, kinds) {
  const ids = [];
  for (const k of kinds) {
    // 赤ドラは鳴いた面子に入れて見せる
    const cands = p.hand.filter(id => kindOf(id) === k && !ids.includes(id));
    const pick = cands.find(isAka) ?? cands[0];
    ids.push(pick);
    p.hand.splice(p.hand.indexOf(pick), 1);
  }
  return ids;
}
function performCall(call, from, id) {
  const h = G.h, p = h.P[call.seat];
  const ids = takeKinds(p, call.kinds).concat([id]);
  const t = call.type === 'kan' ? 'minkan' : call.type;
  p.melds.push({ t, ids, k: Math.min(...ids.map(kindOf)), from, called: id });
  const fp = h.P[from];
  fp.discards[fp.discards.length - 1].called = true;
  h.anyCall = true;
  for (const q of h.P) q.ippatsu = false;
  if (t === 'minkan') h.kans++;
  if (AUTO) seatStat(call.seat, 'call');
  h.last = null;
  pop(call.seat, { pon: 'ポン', chi: 'チー', minkan: 'カン' }[t]);
  snd('call');
  dirty = true;
}
async function doSelfKan(seat, act) {
  const h = G.h, p = h.P[seat];
  if (act.kan === 'kakan') {
    const id = p.hand.find(x => kindOf(x) === act.k);
    pop(seat, 'カン'); snd('call');
    await sleep(500);
    // 槍槓（加槓した牌でロン）
    p.hand.splice(p.hand.indexOf(id), 1);
    p.drawn = null;
    dirty = true;
    const ron = await checkRon(seat, id, true);
    if (ron) return ron;
    const m = p.melds.find(mm => mm.t === 'pon' && mm.k === act.k);
    m.t = 'kakan'; m.added = id; m.ids.push(id);
  } else {
    const ids = p.hand.filter(x => kindOf(x) === act.k);
    for (const id of ids) p.hand.splice(p.hand.indexOf(id), 1);
    p.melds.push({ t: 'ankan', ids, k: act.k, from: seat, called: null });
    p.drawn = null;
    pop(seat, 'カン'); snd('call');
  }
  p.hand.sort((a, b) => a - b);
  h.kans++;
  h.anyCall = true;
  for (const q of h.P) q.ippatsu = false;
  dirty = true;
  await sleep(500);
  return null;
}

// ---------- 和了・流局 ----------
async function finishWin(seat, ev, from, ronId) {
  const h = G.h;
  const tsumo = from < 0;
  const dealer = dealerSeat(), isDealer = seat === dealer;
  const delta = [0, 0, 0, 0];
  const b = ev.base;
  let pointText;
  if (tsumo) {
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      const pay = R.ceil100(b * (o === dealer || isDealer ? 2 : 1)) + 100 * G.honba;
      delta[o] -= pay; delta[seat] += pay;
    }
    pointText = isDealer ? R.ceil100(b * 2) + '点オール' : R.ceil100(b) + '・' + R.ceil100(b * 2) + '点';
  } else {
    const pay = R.ceil100(b * (isDealer ? 6 : 4)) + 300 * G.honba;
    delta[from] -= pay; delta[seat] += pay;
    pointText = R.ceil100(b * (isDealer ? 6 : 4)) + '点';
  }
  delta[seat] += G.sticks * 1000;
  const before = G.scores.slice();
  for (let i = 0; i < 4; i++) G.scores[i] += delta[i];
  const sticks = G.sticks;
  G.sticks = 0;
  h.reveal[seat] = true;
  if (AUTO) { autoStat(tsumo ? 'tsumo' : 'ron', ev); seatStat(seat, 'win'); if (!tsumo) seatStat(from, 'dealin'); if (!ev.yaku.some(y => /立直/.test(y[0])) && isMenzen(h.P[seat])) seatStat(seat, 'dama'); if (ev.yaku.some(y => /一色/.test(y[0]))) seatStat(seat, 'somete'); }
  pop(seat, tsumo ? 'ツモ' : 'ロン');
  snd('win');
  dirty = true;
  await sleep(1300);
  await showResult({ type: 'win', seat, from, ev, tsumo, ronId, delta, before, pointText, sticks });
  return { renchan: isDealer, draw: false };
}
async function exhaustiveDraw() {
  const h = G.h;
  const ten = h.P.map(p => p.waits.length > 0);
  const n = ten.filter(Boolean).length;
  const delta = [0, 0, 0, 0];
  if (n > 0 && n < 4) for (let s = 0; s < 4; s++) delta[s] = ten[s] ? 3000 / n : -3000 / (4 - n);
  const before = G.scores.slice();
  for (let s = 0; s < 4; s++) { G.scores[s] += delta[s]; if (ten[s]) h.reveal[s] = true; }
  if (AUTO) autoStat('draw');
  pop(-1, '流局');
  dirty = true;
  await sleep(1300);
  await showResult({ type: 'draw', ten, delta, before });
  return { renchan: ten[dealerSeat()], draw: true };
}

// テスト用（#auto）の集計
function autoStat(kind, ev) {
  const st = window.__stats || (window.__stats = { hands: 0, tsumo: 0, ron: 0, draw: 0, open: 0, riichi: 0, yaku: {}, label: {} });
  st.hands++; st[kind]++;
  if (ev) {
    for (const y of ev.yaku) st.yaku[y[0]] = (st.yaku[y[0]] || 0) + 1;
    st.label[ev.label || ev.han + '翻'] = (st.label[ev.label || ev.han + '翻'] || 0) + 1;
  }
}

function seatStat(seat, key) {
  const st = window.__seat || (window.__seat = [{}, {}, {}, {}]);
  st[seat][key] = (st[seat][key] || 0) + 1;
}

// ---------- CPU の思考 ----------
function visibleFor(seat) {
  const h = G.h, v = new Array(34).fill(0);
  for (const q of h.P) {
    for (const d of q.discards) if (!d.called) v[kindOf(d.id)]++;
    for (const m of q.melds) for (const id of m.ids) v[kindOf(id)]++;
  }
  for (const id of doraIndicators()) v[kindOf(id)]++;
  for (const id of h.P[seat].hand) v[kindOf(id)]++;
  return v;
}
function near(c, t) {
  if (c[t]) return true;
  if (t >= 27) return false;
  const n = t % 9;
  return (n >= 1 && c[t - 1]) || (n <= 7 && c[t + 1]) || (n >= 2 && c[t - 2]) || (n <= 6 && c[t + 2]);
}
// 安全か（リーチした人の現物、リーチ後に誰かが通した牌）
function isSafe(k, t) {
  const q = G.h.P[t];
  if (q.discards.some(d => kindOf(d.id) === k)) return true;
  for (const p of G.h.P) for (const d of p.discards) if (d.seq > q.riichiSeq && kindOf(d.id) === k) return true;
  return false;
}
function dangerOf(k, t, vis) {
  if (isSafe(k, t)) return 0;
  if (k >= 27) return vis[k] >= 3 ? 1 : vis[k] === 2 ? 3 : 6;
  const n = k % 9;
  const lo = n >= 3 && isSafe(k - 3, t), hi = n <= 5 && isSafe(k + 3, t);
  if (n === 0 || n === 8) return (n === 0 ? hi : lo) ? 2 : 6;
  if (n === 1 || n === 7) return (n === 1 ? hi : lo) ? 3 : 8;
  if (n === 2 || n === 6) return (n === 2 ? hi : lo) ? 4 : 9;
  return lo && hi ? 4 : lo || hi ? 8 : 12;
}
function threatsOf(seat) {
  return [1, 2, 3].map(i => (seat + i) % 4).filter(s => G.h.P[s].riichiPaid);
}
// ふつうの CPU：シャンテン数 → 受け入れ枚数 → 癖（染め手・タンヤオ・ドラ）の順で切る牌を決める
function chooseDiscard(seat) {
  const st = styleOf(seat);
  if (st.strong) return strongDiscard(seat);
  const h = G.h, p = h.P[seat];
  const c = counts(p.hand), m = p.melds.length;
  const vis = visibleFor(seat);
  const dk = doraKinds();
  const threats = threatsOf(seat);
  // 七対子好き：対子が多ければ七対子のシャンテン数で考える
  let shf = cc => R.shanten(cc, m);
  if (st.chiitoi && m === 0 && R.shantenChiitoi(c) <= R.shanten(c, 0) + 1) shf = cc => R.shantenChiitoi(cc);
  // 染め手：手牌と鳴いた牌でいちばん多い色（字牌も数える）が 8 枚以上なら、ほかの色から切る
  let mainSuit = -1;
  if (st.somete) {
    const all = p.hand.concat(...p.melds.map(mm => mm.ids)).map(kindOf);
    const honors = all.filter(k => k >= 27).length;
    let best = 0;
    for (let su = 0; su < 3; su++) {
      const n = all.filter(k => k < 27 && Math.floor(k / 9) === su).length;
      if (n > best) { best = n; mainSuit = su; }
    }
    if (best + honors < 8) mainSuit = -1;
  }
  const offFirst = k => (mainSuit >= 0 && k < 27 && Math.floor(k / 9) !== mainSuit) || (st.tanyao && R.isYao(k));
  let kinds = [...new Set(p.hand.map(kindOf))];
  if (p.forbid) { const k2 = kinds.filter(k => !p.forbid.includes(k)); if (k2.length) kinds = k2; }
  const evals = kinds.map(k => {
    c[k]--;
    const s = shf(c);
    let uke = 0;
    if (s <= 4) {
      for (let t = 0; t < 34; t++) {
        const left = 4 - vis[t];
        if (left <= 0 || !near(c, t)) continue;
        c[t]++;
        if (shf(c) < s) uke += left;
        c[t]--;
      }
    }
    c[k]++;
    let keep = 0;
    if (dk.includes(k)) keep += 6;
    if (k >= 27) {
      const yh = k >= 31 || k === seatWind(seat) || k === roundWind();
      keep += c[k] >= 2 ? (yh ? 10 : 5) : (yh ? 1.5 : 0);
      if (vis[k] - c[k] >= 2) keep -= 1;
    } else {
      const n = k % 9;
      keep += n === 0 || n === 8 ? 1 : n === 1 || n === 7 ? 2 : 3;
    }
    const danger = threats.reduce((a, t) => a + dangerOf(k, t, vis), 0);
    return { k, s, uke, keep, danger, off: offFirst(k) ? 1 : 0 };
  });
  const byEff = (a, b) => a.s - b.s || b.off - a.off || (b.uke - st.keepW * b.keep) - (a.uke - st.keepW * a.keep) || a.keep - b.keep;
  evals.sort(byEff);
  let pick = evals[0];
  // はじめたて：ときどき 2〜5 番目にいい牌を切ってしまう
  if (st.blunder && Math.random() < st.blunder) pick = evals[Math.min(evals.length - 1, 1 + Math.floor(Math.random() * 4))];
  if (threats.length) {
    const minS = pick.s;
    const safest = evals.slice().sort((a, b) => a.danger - b.danger || byEff(a, b))[0];
    if (minS >= st.fold) pick = safest;
    else {
      const keepers = evals.filter(e => e.s === minS).sort((a, b) => a.danger - b.danger || byEff(a, b));
      const limit = minS === 0 ? st.push0 : minS === 1 ? st.push1 : st.push1 / 2;
      pick = keepers[0].danger <= limit ? keepers[0] : safest;
    }
  }
  return { id: pickId(p, pick.k), ev: pick };
}
// 同じ種類なら、赤ドラ以外・ツモった牌を優先して切る
function pickId(p, k) {
  const ids = p.hand.filter(id => kindOf(id) === k);
  return ids.find(x => x === p.drawn && !isAka(x)) ?? ids.find(x => !isAka(x)) ?? ids[0];
}

// ---------- 強い CPU（雀豪） ----------
// 警戒する相手：リーチ者、3 副露、2 副露でドラが多いか染め手に見える人
function strongThreats(seat) {
  const out = [], dk = doraKinds();
  for (let i = 1; i <= 3; i++) {
    const s = (seat + i) % 4, q = G.h.P[s];
    const dealer = s === dealerSeat() ? 1.5 : 1;
    if (q.riichiPaid) { out.push({ s, w: dealer, riichi: true }); continue; }
    const open = q.melds.filter(mm => mm.t !== 'ankan');
    if (!open.length) continue;
    const ks = open.flatMap(mm => mm.ids.map(kindOf));
    const doras = open.reduce((a, mm) => a + mm.ids.filter(id => dk.includes(kindOf(id)) || isAka(id)).length, 0);
    const suits = new Set(ks.filter(k => k < 27).map(k => Math.floor(k / 9)));
    const big = doras >= 2 || (suits.size === 1 && open.length >= 2);
    if (open.length >= 3 || (open.length >= 2 && big)) out.push({ s, w: (open.length >= 3 ? 0.4 : 0.25) * (big ? 1.5 : 1) * dealer, riichi: false });
  }
  return out;
}
function safeAgainst(k, th) {
  const q = G.h.P[th.s];
  if (q.discards.some(d => kindOf(d.id) === k)) return true;
  if (th.riichi) for (const p of G.h.P) for (const d of p.discards) if (d.seq > q.riichiSeq && kindOf(d.id) === k) return true;
  return false;
}
// 危険度：現物・スジ・字牌の見え方に加えて、壁（ノーチャンス・ワンチャンス）も読む
function dangerStrong(k, th, vis) {
  if (safeAgainst(k, th)) return 0;
  if (k >= 27) {
    const yh = k >= 31 || k === seatWind(th.s) || k === roundWind();
    return vis[k] >= 3 ? 0.5 : vis[k] === 2 ? 2 : yh ? 7 : 5;
  }
  const n = k % 9;
  const lo = n >= 3 && safeAgainst(k - 3, th), hi = n <= 5 && safeAgainst(k + 3, th);
  let d;
  if (n === 0 || n === 8) d = (n === 0 ? hi : lo) ? 2 : 6;
  else if (n === 1 || n === 7) d = (n === 1 ? hi : lo) ? 3 : 8;
  else if (n === 2 || n === 6) d = (n === 2 ? hi : lo) ? 4 : 9;
  else d = lo && hi ? 4 : lo || hi ? 8 : 12;
  const shapes = [];
  if (n <= 6) shapes.push([k + 1, k + 2]);
  if (n >= 2) shapes.push([k - 2, k - 1]);
  if (shapes.every(([a, b]) => vis[a] >= 4 || vis[b] >= 4)) d = Math.min(d, n === 0 || n === 8 ? 1.5 : 3);
  else if (shapes.some(([a, b]) => vis[a] >= 3 || vis[b] >= 3)) d *= 0.8;
  return d;
}
function strongDiscard(seat) {
  const h = G.h, p = h.P[seat], m = p.melds.length;
  const c = counts(p.hand), vis = visibleFor(seat), dk = doraKinds();
  const threats = EXP.includes('nodef') ? [] : strongThreats(seat);
  const left = t => Math.max(0, 4 - vis[t]);
  const ukeList = (cc, s) => {
    const out = [];
    for (let t = 0; t < 34; t++) {
      if (!left(t) || !near(cc, t)) continue;
      cc[t]++;
      if (R.shanten(cc, m) < s) out.push(t);
      cc[t]--;
    }
    return out;
  };
  // 1 枚引いたあと、いちばん待ちが広くなる切り方をしたときの待ち枚数
  const bestTenpai = cc => {
    let best = 0;
    for (let d = 0; d < 34; d++) {
      if (!cc[d]) continue;
      cc[d]--;
      if (R.shanten(cc, m) === 0) {
        let w = 0;
        for (const t of R.waits(cc, m)) w += left(t);
        if (w > best) best = w;
      }
      cc[d]++;
    }
    return best;
  };
  let kinds = [...new Set(p.hand.map(kindOf))];
  if (p.forbid) { const k2 = kinds.filter(k => !p.forbid.includes(k)); if (k2.length) kinds = k2; }
  const handDora = p.hand.concat(...p.melds.map(mm => mm.ids)).filter(id => dk.includes(kindOf(id)) || isAka(id)).length;
  const evals = kinds.map(k => {
    c[k]--;
    const s = R.shanten(c, m);
    const ul = s <= 5 ? ukeList(c, s) : [];
    c[k]++;
    let keep = 0;
    keep += 2.5 * dk.filter(d => d === k).length;
    if (k >= 27) {
      const yh = k >= 31 || k === seatWind(seat) || k === roundWind();
      keep += c[k] >= 2 ? (yh ? 4 : 1.5) : (yh ? 0.6 : 0);
      if (vis[k] - c[k] >= 2) keep -= 0.5;
    } else {
      const n = k % 9;
      keep += n === 0 || n === 8 ? 0 : n === 1 || n === 7 ? 0.5 : 1;
    }
    const danger = threats.reduce((a, th) => a + th.w * dangerStrong(k, th, vis), 0);
    return { k, s, ul, uke: ul.reduce((a, t) => a + left(t), 0), keep, danger, q: 0, han: 0 };
  });
  const minS = Math.min(...evals.map(e => e.s));
  // 先読み：テンパイなら待ちの広さと役、1シャンテンなら「引いたあとの待ちの広さ」の合計
  for (const e of evals) {
    if (e.s !== minS) { e.q = e.uke / 4; continue; }
    if (minS === 0) {
      e.han = damaHan(seat, pickId(p, e.k));
      e.q = e.uke * (isMenzen(p) || e.han > 0 ? 1 : 0.1);
    } else if (minS === 1 && !EXP.includes('nolook')) {
      c[e.k]--;
      let q = 0;
      for (const t of e.ul) { c[t]++; q += left(t) * bestTenpai(c); c[t]--; }
      c[e.k]++;
      e.q = q / 10;
    } else e.q = e.uke;
  }
  const byEff = (a, b) => a.s - b.s || (b.q - 0.6 * b.keep) - (a.q - 0.6 * a.keep) || a.danger - b.danger;
  let pick = evals.slice().sort(byEff)[0];
  if (threats.length) {
    // 押し引き：和了れそうな見込み × 自分の手の値段 と、放銃しそうな見込み × 相手の手の値段 をくらべる
    // （見込みの数字は、ふつうの対局でのおおよその和了率・放銃率に合わせてある）
    const dealer = seat === dealerSeat();
    const tf = Math.min(1, liveLeft() / 30);
    const score = e => {
      const yakuOk = isMenzen(p) || e.han > 0;
      const wc = e.s === 0 ? Math.min(0.55, 0.25 + 0.03 * e.uke) * (yakuOk ? 1 : 0.2)
        : e.s === 1 ? Math.min(0.2, 0.04 + 0.005 * e.uke) : e.s === 2 ? 0.03 : 0.01;
      const han = e.s === 0 ? e.han + (isMenzen(p) && !p.riichi ? 1.5 : 0) : 1 + handDora + (isMenzen(p) ? 1 : 0);
      const val = R.basePoints(Math.max(1, Math.round(han)), 30).base * (dealer ? 6 : 4);
      const deal = Math.min(0.5, e.danger * 0.011);
      return wc * tf * val - deal * 5500 + e.q * 0.5 - e.keep;
    };
    pick = evals.slice().sort((a, b) => score(b) - score(a) || byEff(a, b))[0];
  }
  return { id: pickId(p, pick.k), ev: pick };
}

function cpuTurn(seat, opts) {
  const p = G.h.P[seat], st = styleOf(seat);
  if (opts.tsumo) return { type: 'tsumo', ev: opts.tsumo };
  if (p.riichi) {
    if (opts.kans.length) return { type: 'kan', ...opts.kans[0] };
    return { type: 'discard', id: p.drawn };
  }
  const threat = threatsOf(seat).length > 0;
  for (const kn of opts.kans) {
    if (threat || st.call === 'none') break;
    if (kn.kan === 'kakan') return { type: 'kan', ...kn };
    const c = counts(p.hand);
    const s0 = R.shanten(c, p.melds.length);
    c[kn.k] = 0;
    if (R.shanten(c, p.melds.length + 1) <= s0) return { type: 'kan', ...kn };
  }
  const d = chooseDiscard(seat);
  let riichi = !!(opts.riichi && opts.riichi.includes(d.id) && d.ev.s === 0 && d.ev.uke > 0);
  if (riichi && st.strong) {
    // 雀豪：役があって満貫級（4翻以上）なら、または終盤で役があるならダマ
    const han = d.ev.han != null ? d.ev.han : damaHan(seat, d.id);
    if (han >= 4 || (han >= 1 && liveLeft() < 8)) riichi = false;
  } else if (riichi && (st.dama || st.damaBad)) {
    // リーチしなくても役があり、高い手か待ちが悪い（残り 4 枚以下）ならダマ
    const han = damaHan(seat, d.id);
    if ((st.dama && han >= st.dama) || (st.damaBad && han >= 1 && d.ev.uke <= 4)) riichi = false;
  }
  return { type: 'discard', id: d.id, riichi };
}
// リーチせずにロンしたときのいちばん安い翻数（役のない待ちがあれば 0）
function damaHan(seat, discardId) {
  const p = G.h.P[seat];
  const ids = p.hand.filter(id => id !== discardId);
  const cc = counts(ids);
  const dk = doraKinds();
  const allIds = ids.concat(...p.melds.map(m => m.ids));
  let dora = 0, aka = 0;
  for (const id of allIds) { for (const d of dk) if (kindOf(id) === d) dora++; if (isAka(id)) aka++; }
  let min = 99;
  for (const w of R.waits(cc, p.melds.length)) {
    const c2 = cc.slice(); c2[w]++;
    const ev = R.evaluate({ cc: c2, melds: evalMelds(p), win: w, tsumo: false, seatWind: seatWind(seat), roundWind: roundWind(),
      dora: dora + dk.filter(d => d === w).length, aka, ura: 0 });
    if (!ev) return 0;
    min = Math.min(min, ev.yakuman ? 13 : ev.han);
  }
  return min === 99 ? 0 : min;
}
function minShantenAfter(c, m) {
  let best = 9;
  for (let k = 0; k < 34; k++) {
    if (!c[k]) continue;
    c[k]--; const s = R.shanten(c, m); c[k]++;
    if (s < best) best = s;
  }
  return best;
}
// 鳴いても役がありそうか（役牌・断么九・染め手）
function openYakuPossible(seat, k, pair) {
  const p = G.h.P[seat];
  const yh = x => x >= 31 || x === seatWind(seat) || x === roundWind();
  if (p.melds.some(m => yh(m.k) && m.t !== 'chi')) return true;
  if (pair[0] === pair[1] && yh(k)) return true;
  const c = counts(p.hand);
  const meldKinds = p.melds.flatMap(m => m.ids.map(kindOf));
  const used = [k, ...pair, ...meldKinds];
  // 断么九
  const handYao = p.hand.filter(id => R.isYao(kindOf(id))).length - pair.filter(R.isYao).length;
  if (used.every(x => !R.isYao(x)) && handYao <= (styleOf(seat).call === 'eager' ? 2 : 1)) return true;
  // 混一色・清一色
  for (let s = 0; s < 3; s++) {
    const inSuit = x => x >= 27 || Math.floor(x / 9) === s;
    if (used.every(inSuit)) {
      let off = 0;
      for (let x = 0; x < 27; x++) if (!inSuit(x)) off += c[x];
      if (off <= 2) return true;
    }
  }
  return false;
}
function cpuWantsCall(seat, k, pair) {
  const p = G.h.P[seat];
  const c = counts(p.hand);
  const s0 = R.shanten(c, p.melds.length);
  const st = styleOf(seat);
  if (st.call === 'none') return false;
  const threat = st.strong ? strongThreats(seat).some(t => t.riichi) : threatsOf(seat).length > 0;
  if (threat && (st.call === 'careful' || s0 >= (st.call === 'eager' ? 3 : 2))) return false;
  const yh = k >= 31 || k === seatWind(seat) || k === roundWind();
  const yakuhaiPon = pair[0] === pair[1] && pair[0] === k && yh;
  if (st.call === 'yakuhai' && !yakuhaiPon) return false;
  if (st.chiitoi && p.melds.length === 0 && R.shantenChiitoi(c) <= s0 && !yakuhaiPon) return false;
  if (!openYakuPossible(seat, k, pair)) return false;
  for (const x of pair) c[x]--;
  const s1 = minShantenAfter(c, p.melds.length + 1);
  if (st.strong) {
    // 雀豪：役牌はポン。それ以外は手が進み、テンパイが近いかドラがあるときだけ
    if (yakuhaiPon && s1 <= s0) return true;
    const dk = doraKinds();
    const doras = p.hand.concat(...p.melds.map(mm => mm.ids)).filter(id => dk.includes(kindOf(id)) || isAka(id)).length + (dk.includes(k) ? 1 : 0);
    return s1 < s0 && (s0 <= 2 || doras >= 2 || p.melds.length > 0);
  }
  if (st.call === 'careful') return s1 < s0 && s0 <= 3;
  if (yakuhaiPon && s1 <= s0) return true;
  // 鳴き屋は、もう鳴いているなら手が進まなくても形を崩さない鳴き（同じシャンテン数）もする
  if (st.call === 'eager' && p.melds.length && s1 <= s0) return true;
  return s1 < s0;
}

// ---------- 人間の操作 ----------
function canDiscard(id) {
  if (!pending || pending.kind !== 'turn') return false;
  const p = G.h.P[0];
  if (p.riichi) return id === p.drawn;
  if (ui.riichiMode) return pending.opts.riichi.includes(id);
  const f = pending.opts.forbid;
  if (f && f.includes(kindOf(id))) {
    // 全部が食い替えで切れないときは何でも切れる
    return p.hand.every(x => f.includes(kindOf(x)));
  }
  return true;
}
function humanDiscard(id) {
  if (!canDiscard(id)) return;
  pending.resolve({ type: 'discard', id, riichi: ui.riichiMode });
}
function mkBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'act ' + (cls || '');
  if (typeof label === 'string') b.textContent = label; else b.append(...label);
  b.addEventListener('click', e => { e.stopPropagation(); ensureAudio(); fn(); });
  actionsEl.appendChild(b);
  return b;
}
function renderActions() {
  actionsEl.innerHTML = '';
  if (!pending) { actionsEl.classList.remove('show'); return; }
  const o = pending.opts, done = v => pending && pending.resolve(v);
  if (pending.kind === 'turn') {
    const p = G.h.P[0];
    if (o.tsumo) mkBtn('ツモ', 'win', () => done({ type: 'tsumo', ev: o.tsumo }));
    if (o.riichi && !ui.riichiMode) mkBtn('リーチ', 'riichi', () => { ui.riichiMode = true; ui.selected = null; renderActions(); dirty = true; });
    if (ui.riichiMode) mkBtn('リーチ取消', '', () => { ui.riichiMode = false; renderActions(); dirty = true; });
    for (const kn of o.kans) mkBtn(o.kans.length > 1 ? ['カン ', tileCanvas(kn.k, false, 18)] : 'カン', 'call', () => done({ type: 'kan', ...kn }));
    if (p.riichi) mkBtn('ツモ切り', 'skip', () => done({ type: 'discard', id: p.drawn }));
  } else if (pending.kind === 'call') {
    if (o.ron) mkBtn('ロン', 'win', () => done({ type: 'ron' }));
    if (o.pon) mkBtn('ポン', 'call', () => done({ type: 'pon' }));
    if (o.kan) mkBtn('カン', 'call', () => done({ type: 'kan' }));
    for (const pair of o.chis || []) {
      const lbl = o.chis.length > 1 ? ['チー ', tileCanvas(pair[0], false, 16), tileCanvas(pair[1], false, 16)] : 'チー';
      mkBtn(lbl, 'call', () => done({ type: 'chi', pair }));
    }
    mkBtn('スキップ', 'skip', () => done({ type: 'skip' }));
  }
  actionsEl.classList.toggle('show', actionsEl.children.length > 0);
}

function evPoint(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hitTile(pt) {
  for (const h of ui.hits) if (pt.x >= h.x && pt.x < h.x + h.w && pt.y >= h.y - h.raise && pt.y < h.y + h.h) return h;
  return null;
}
cv.addEventListener('pointerdown', e => {
  ensureAudio();
  if (!G || !G.h) return;
  const hit = hitTile(evPoint(e));
  if (!hit || !canDiscard(hit.id)) { if (ui.selected != null) { ui.selected = null; dirty = true; } return; }
  if (e.pointerType === 'mouse' || ui.selected === hit.id) humanDiscard(hit.id);
  else { ui.selected = hit.id; dirty = true; }
});
cv.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || !G || !G.h) return;
  const hit = hitTile(evPoint(e));
  const id = hit && canDiscard(hit.id) ? hit.id : null;
  if (id !== ui.hover) { ui.hover = id; dirty = true; }
  cv.style.cursor = id != null ? 'pointer' : 'default';
});
cv.addEventListener('pointerleave', () => { if (ui.hover != null) { ui.hover = null; dirty = true; } });

// ---------- 牌の絵 ----------
const SERIF = '"Noto Serif JP","Hiragino Mincho ProN","Yu Mincho",serif';
const COL = { r: '#c8202a', g: '#16773a', b: '#1f4ea8', k: '#1b1b28' };
const PINS = {
  1: [[.5, .5, 'r', .40]],
  2: [[.5, .26, 'g', .23], [.5, .74, 'b', .23]],
  3: [[.22, .17, 'b', .19], [.5, .5, 'r', .19], [.78, .83, 'g', .19]],
  4: [[.28, .26, 'b', .2], [.72, .26, 'g', .2], [.28, .74, 'g', .2], [.72, .74, 'b', .2]],
  5: [[.25, .19, 'b', .18], [.75, .19, 'g', .18], [.5, .5, 'r', .18], [.25, .81, 'g', .18], [.75, .81, 'b', .18]],
  6: [[.3, .14, 'g', .16], [.7, .14, 'g', .16], [.3, .56, 'r', .16], [.7, .56, 'r', .16], [.3, .86, 'r', .16], [.7, .86, 'r', .16]],
  7: [[.2, .1, 'g', .14], [.5, .2, 'g', .14], [.8, .3, 'g', .14], [.3, .6, 'r', .15], [.7, .6, 'r', .15], [.3, .87, 'r', .15], [.7, .87, 'r', .15]],
  8: [.12, .37, .63, .88].flatMap(y => [[.28, y, 'b', .15], [.72, y, 'b', .15]]),
  9: [[.17, 'b'], [.5, 'r'], [.83, 'g']].flatMap(([y, c]) => [[.2, y, c, .145], [.5, y, c, .145], [.8, y, c, .145]]),
};
const SOUS = {
  2: { L: .36, s: [[.5, .25], [.5, .75]] },
  3: { L: .36, s: [[.5, .25], [.3, .75], [.7, .75]] },
  4: { L: .36, s: [[.3, .25], [.7, .25], [.3, .75], [.7, .75]] },
  5: { L: .34, s: [[.22, .24], [.78, .24], [.5, .5, 'r'], [.22, .76], [.78, .76]] },
  6: { L: .36, s: [[.2, .25], [.5, .25], [.8, .25], [.2, .75], [.5, .75], [.8, .75]] },
  7: { L: .26, s: [[.5, .15, 'r'], [.2, .5], [.5, .5], [.8, .5], [.2, .83], [.5, .83], [.8, .83]] },
  8: { L: .36, W: .1, s: [[.14, .25], [.38, .25], [.62, .25], [.86, .25], [.14, .75], [.38, .75], [.62, .75], [.86, .75]] },
  9: { L: .26, s: [[.2, .17], [.5, .17, 'r'], [.8, .17], [.2, .5], [.5, .5, 'r'], [.8, .5], [.2, .83], [.5, .83, 'r'], [.8, .83]] },
};
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function paintFace(c, k, red, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fffef8'); g.addColorStop(1, '#ece5cf');
  c.fillStyle = g; rrect(c, 0, 0, W, H, W * 0.12); c.fill();
  const pad = W * 0.08, ix = pad, iy = pad * 1.15, iw = W - pad * 2, ih = H - pad * 2.3;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (k < 9) {
    c.fillStyle = red ? COL.r : COL.k;
    c.font = `700 ${ih * 0.4}px ${SERIF}`;
    c.fillText('一二三四五六七八九'[k], W / 2, iy + ih * 0.25);
    c.fillStyle = COL.r;
    c.font = `700 ${ih * 0.46}px ${SERIF}`;
    c.fillText('萬', W / 2, iy + ih * 0.72);
  } else if (k < 18) {
    for (const [px, py, cl, rr] of PINS[k - 8]) {
      const x = ix + px * iw, y = iy + py * ih, r = rr * iw, col = red ? COL.r : COL[cl];
      c.fillStyle = col; circle(c, x, y, r);
      c.fillStyle = '#fffef6'; circle(c, x, y, r * 0.74);
      c.fillStyle = col; circle(c, x, y, r * 0.52);
      c.fillStyle = '#fffef6'; circle(c, x, y, r * 0.2);
      if (k === 9) { c.fillStyle = COL.g; for (let a = 0; a < 8; a++) circle(c, x + Math.cos(a * Math.PI / 4) * r * 0.63, y + Math.sin(a * Math.PI / 4) * r * 0.63, r * 0.07); }
    }
  } else if (k < 27) {
    const n = k - 17;
    if (n === 1) {
      // 一索は鳥
      const cx = W / 2, cy = iy + ih * 0.52;
      c.strokeStyle = COL.b; c.lineWidth = iw * 0.05; c.lineCap = 'round';
      for (let a = -2; a <= 2; a++) { c.beginPath(); c.moveTo(cx, cy + ih * 0.05); c.lineTo(cx + a * iw * 0.13, cy + ih * 0.38); c.stroke(); }
      c.fillStyle = COL.g; c.beginPath(); c.ellipse(cx, cy, iw * 0.2, ih * 0.18, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = COL.r; circle(c, cx + iw * 0.05, cy - ih * 0.24, iw * 0.13);
      c.beginPath(); c.moveTo(cx + iw * 0.16, cy - ih * 0.26); c.lineTo(cx + iw * 0.3, cy - ih * 0.22); c.lineTo(cx + iw * 0.15, cy - ih * 0.19); c.fill();
      c.fillStyle = '#fff'; circle(c, cx + iw * 0.08, cy - ih * 0.26, iw * 0.03);
    } else {
      const d = SOUS[n], sl = d.L * ih, sw = (d.W || 0.14) * iw;
      for (const [px, py, cl] of d.s) {
        const x = ix + px * iw, y = iy + py * ih;
        c.fillStyle = red ? COL.r : cl === 'r' ? COL.r : COL.g;
        rrect(c, x - sw / 2, y - sl / 2, sw, sl, sw * 0.45); c.fill();
        c.strokeStyle = 'rgba(255,255,245,0.85)'; c.lineWidth = Math.max(1, sw * 0.16);
        c.beginPath(); c.moveTo(x, y - sl * 0.34); c.lineTo(x, y + sl * 0.34); c.stroke();
        c.beginPath(); c.moveTo(x - sw / 2, y); c.lineTo(x + sw / 2, y); c.stroke();
      }
    }
  } else if (k === 31) {
    c.strokeStyle = COL.b; c.lineWidth = iw * 0.07;
    rrect(c, ix + iw * 0.16, iy + ih * 0.13, iw * 0.68, ih * 0.74, iw * 0.06); c.stroke();
  } else {
    c.fillStyle = k === 32 ? COL.g : k === 33 ? COL.r : COL.k;
    c.font = `700 ${ih * 0.62}px ${SERIF}`;
    c.fillText(['東', '南', '西', '北', '', '發', '中'][k - 27], W / 2, iy + ih * 0.53);
  }
}
const faceCache = new Map();
let DPR = 1;
function faceImg(k, red, w) {
  const pw = Math.max(4, Math.round(w * DPR)), key = k + '|' + (red ? 1 : 0) + '|' + pw;
  let img = faceCache.get(key);
  if (!img) {
    img = document.createElement('canvas');
    img.width = pw; img.height = Math.round(pw * 1.36);
    paintFace(img.getContext('2d'), k, red, img.width, img.height);
    faceCache.set(key, img);
  }
  return img;
}
// 牌を 1 枚描く。o.side 横向き / o.back 裏 / o.stand 立てた牌（厚みを大きく） / o.dim 暗く / o.mark 枠
function drawTile(c, x, y, w, id, o) {
  o = o || {};
  const h = w * 1.36, d = Math.max(2, w * (o.stand ? 0.2 : 0.12));
  const W = o.side ? h : w, H = o.side ? w : h, r = w * 0.12;
  c.fillStyle = '#145c3c';
  rrect(c, x, y, W, H + d, r); c.fill();
  if (o.back) {
    c.fillStyle = '#e6dfc6'; rrect(c, x, y + H * 0.15, W, H + d * 0.85 - H * 0.15, r); c.fill();
    c.fillStyle = '#1f8a5a'; rrect(c, x, y, W, H * 0.92, r); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.12)'; rrect(c, x + W * 0.12, y + H * 0.1, W * 0.76, H * 0.7, r * 0.6); c.fill();
    return W;
  }
  c.fillStyle = '#d9d1b4'; rrect(c, x, y, W, H + d * 0.45, r); c.fill();
  const img = faceImg(kindOf(id), o.red !== undefined ? o.red : isAka(id), w);
  if (o.side) {
    c.save(); c.translate(x, y + H); c.rotate(-Math.PI / 2); c.drawImage(img, 0, 0, w, h); c.restore();
  } else c.drawImage(img, x, y, w, h);
  if (o.dim) { c.fillStyle = 'rgba(10,20,15,0.42)'; rrect(c, x, y, W, H + d, r); c.fill(); }
  if (o.mark) { c.strokeStyle = o.mark; c.lineWidth = Math.max(2, w * 0.08); rrect(c, x + 1, y + 1, W - 2, H - 2, r); c.stroke(); }
  return W;
}
// DOM に置く小さな牌（結果画面・ボタン用）
function tileCanvas(k, red, w, o) {
  const el = document.createElement('canvas');
  o = o || {};
  const h = w * 1.36, W = o.side ? h : w, H = (o.side ? w : h) + Math.max(2, w * 0.12);
  el.width = Math.ceil(W * DPR); el.height = Math.ceil(H * DPR);
  el.style.width = W + 'px'; el.style.height = H + 'px';
  el.className = 'tile';
  const c = el.getContext('2d');
  c.scale(DPR, DPR);
  drawTile(c, 0, 0, w, k * 4, Object.assign({ red: !!red }, o));
  return el;
}
const tileOf = (id, w, o) => tileCanvas(kindOf(id), isAka(id), w, o);

// ---------- 描画 ----------
function layout(W, H) {
  const L = { W, H, portrait: W < H * 1.2 };
  if (L.portrait) {
    L.tw = Math.max(16, Math.min(Math.floor((W - 12) / 14.6), 58));
    L.mw = Math.round(L.tw * 0.78);
    L.infoH = 56;
    const handRow = L.tw * 1.36 + L.tw * 0.2, meldRow = L.mw * 1.36 + L.mw * 0.12;
    L.handY = H - 10 - handRow - L.tw * 0.15;
    L.meldY = L.handY - 8 - meldRow;
    const top = L.infoH + 2, bottom = L.meldY - 2, avail = bottom - top;
    // 縦長の画面では卓を縦に伸ばして、牌を少し大きくする
    L.pw = Math.min((W - 4) / 18.4, avail / 20.5);
    L.hx = W / 2 - 2; L.hy = Math.min(avail / 2, L.pw * 12);
    L.cx = W / 2; L.cy = top + avail / 2;
    L.handX = (W - L.tw * 14.4) / 2;
    L.meldRight = W - 6;
    L.hintY = L.meldY + meldRow / 2;
    L.actionsBottom = H - L.meldY + 4;
  } else {
    L.tw = Math.max(16, Math.min(Math.floor((W - 20) / 26), Math.floor(H * 0.085), 60));
    L.mw = Math.round(L.tw * 0.8);
    const handRow = L.tw * 1.36 + L.tw * 0.2;
    L.handY = H - 10 - handRow - L.tw * 0.1;
    L.meldY = L.handY + handRow - (L.mw * 1.36 + L.mw * 0.12);
    const top = 4, bottom = L.handY - L.tw * 0.5;
    const S = Math.min(bottom - top, W - 2 * 150);
    L.pw = S / 20.5; L.hx = L.hy = S / 2;
    L.cx = W / 2; L.cy = top + (bottom - top) / 2;
    const total = 14.4 * L.tw + 14 * L.mw;
    L.handX = Math.max(8, (W - total) / 2);
    L.meldRight = Math.min(W - 8, L.handX + total);
    L.hintY = L.handY - L.tw * 0.45;
    L.actionsBottom = H - L.handY + L.tw * 0.35 + 18;
    L.side = W / 2 - L.hx >= 150;
  }
  L.C = L.pw * 6.6; L.ow = L.pw * 0.8;
  return L;
}
let L = null;
function resize() {
  DPR = Math.min(3, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  L = layout(W, H);
  actionsEl.style.bottom = L.actionsBottom + 'px';
  dirty = true;
}
window.addEventListener('resize', resize);

function render() {
  const W = L.W, H = L.H;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#1d5a42'); bg.addColorStop(1, '#0b281d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ui.hits = [];
  if (!G || !G.h) return;
  // 卓
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  rrect(ctx, L.cx - L.hx, L.cy - L.hy, L.hx * 2, L.hy * 2, L.pw); ctx.fill();
  drawCenter();
  for (let s = 0; s < 4; s++) {
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.rotate(-s * Math.PI / 2);
    drawPond(s);
    if (s !== 0) drawOpponent(s);
    ctx.restore();
  }
  drawInfo();
  drawMine();
  drawPops();
}
function meldTiles(m, owner) {
  if (m.t === 'ankan') return m.ids.map((id, i) => ({ id, back: i === 0 || i === 3 }));
  const rel = (m.from - owner + 4) % 4; // 1 下家（右）2 対面 3 上家（左）
  const others = m.ids.filter(id => id !== m.called && id !== m.added).sort((a, b) => a - b);
  const list = others.map(id => ({ id }));
  const pos = rel === 3 ? 0 : rel === 2 ? 1 : list.length;
  list.splice(pos, 0, { id: m.called, side: true });
  if (m.added != null) list.splice(pos + 1, 0, { id: m.added, side: true, stack: true });
  return list;
}
const meldWidth = (m, owner, w) => meldTiles(m, owner).reduce((a, t) => a + (t.stack ? 0 : t.side ? w * 1.36 : w), 0);
// 右端 xr から左へ、鳴いた面子を並べる。y は立てた牌の上端
function drawMelds(p, owner, xr, y, w) {
  let x = xr;
  for (const m of p.melds) {
    const tiles = meldTiles(m, owner);
    x -= meldWidth(m, owner, w);
    let xx = x;
    for (const t of tiles) {
      if (t.stack) { drawTile(ctx, xx - w * 1.36, y + w * 0.36 - w, w, t.id, { side: true }); continue; }
      const yy = t.side ? y + w * 0.36 : y;
      xx += drawTile(ctx, xx, yy, w, t.id, { side: t.side, back: t.back });
    }
    x -= w * 0.25;
  }
  return x;
}
function drawPond(s) {
  const p = G.h.P[s], pw = L.pw, ph = pw * 1.36;
  const x0 = -L.C / 2 + pw * 0.2, y0 = L.C / 2 + pw * 0.2;
  const list = p.discards.filter(d => !d.called);
  const ri = p.discards.findIndex(d => d.riichi);
  const sideD = ri >= 0 ? p.discards.slice(ri).find(d => !d.called) : null;
  let row = 0, col = 0, x = x0;
  const last = G.h.last;
  for (const d of list) {
    if (row < 2 && col === 6) { row++; col = 0; x = x0; }
    const side = d === sideD;
    const y = y0 + row * ph;
    const isLast = last && last.seat === s && last.id === d.id;
    x += drawTile(ctx, x, side ? y + ph - pw : y, pw, d.id, { side, mark: isLast ? '#ff5a4a' : null });
    col++;
  }
}
function drawOpponent(s) {
  const h = G.h, p = h.P[s], w = L.ow;
  const y = (s % 2 ? L.hx : L.hy) - w * 1.56 - L.pw * 0.25;
  const reveal = h.reveal[s];
  const n = p.hand.length;
  const hasDrawn = n % 3 === 2 && p.drawn != null;
  const meldsW = p.melds.reduce((a, m) => a + meldWidth(m, s, w) + w * 0.25, 0);
  const total = n * w + (hasDrawn ? w * 0.3 : 0) + (meldsW ? w * 0.4 + meldsW : 0);
  let x = -total / 2;
  const tiles = hasDrawn ? p.hand.filter(id => id !== p.drawn).concat([p.drawn]) : p.hand;
  tiles.forEach((id, i) => {
    if (hasDrawn && i === n - 1) x += w * 0.3;
    drawTile(ctx, x, y, w, id, { back: !reveal, stand: true });
    x += w;
  });
  if (p.melds.length) drawMelds(p, s, total / 2, y + w * 0.08, w);
}
function drawCenter() {
  const C = L.C, cx = L.cx, cy = L.cy, h = G.h;
  ctx.fillStyle = '#0c3324';
  rrect(ctx, cx - C / 2, cy - C / 2, C, C, C * 0.08); ctx.fill();
  ctx.strokeStyle = '#2d7456'; ctx.lineWidth = 2; ctx.stroke();
  const fs = Math.max(10, C * 0.092);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let s = 0; s < 4; s++) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-s * Math.PI / 2);
    const p = h.P[s];
    const wind = WIND[seatWind(s) - 27];
    const turn = h.cur === s;
    ctx.font = `${fs}px DotGothic16, monospace`;
    ctx.fillStyle = turn ? '#ffd84a' : seatWind(s) === 27 ? '#ff9a7a' : '#d8eee0';
    const label = wind + ' ' + nameOf(s) + ' ' + G.scores[s];
    ctx.fillText(label, 0, C / 2 - fs * 0.85);
    const ch = isHuman(s) ? null : charOf(s);
    if (ch) { ctx.fillStyle = ch.color; circle(ctx, -ctx.measureText(label).width / 2 - fs * 0.55, C / 2 - fs * 0.85, fs * 0.28); }
    if (turn) { ctx.fillStyle = '#ffd84a'; ctx.fillRect(-C * 0.3, C / 2 - fs * 0.2, C * 0.6, 2); }
    if (p.riichiPaid) {
      const sw = C * 0.5, sh = Math.max(4, fs * 0.32), sy = C / 2 - fs * 1.85;
      ctx.fillStyle = '#f4f1e6'; rrect(ctx, -sw / 2, sy - sh / 2, sw, sh, sh / 2); ctx.fill();
      ctx.fillStyle = COL.r; circle(ctx, 0, sy, sh * 0.32);
    }
    ctx.restore();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `${fs * 1.05}px DotGothic16, monospace`;
  ctx.fillText(roundName(), cx, cy - fs * 0.6);
  ctx.fillStyle = '#9fd4b8';
  ctx.font = `${fs * 0.85}px DotGothic16, monospace`;
  ctx.fillText('残り ' + liveLeft(), cx, cy + fs * 0.55);
}
function drawDoraRow(x, y, w) {
  const ind = doraIndicators();
  for (let i = 0; i < 5; i++) {
    if (i < ind.length) drawTile(ctx, x, y, w, ind[i]);
    else drawTile(ctx, x, y, w, 0, { back: true });
    x += w + 1;
  }
}
function drawInfo() {
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const line2 = `${G.honba}本場  供託${G.sticks}`;
  if (L.portrait) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, L.W, L.infoH);
    ctx.fillStyle = '#fff'; ctx.font = '16px DotGothic16, monospace';
    ctx.fillText(roundName() + ' ' + G.honba + '本場', 10, 18);
    ctx.fillStyle = '#9fd4b8'; ctx.font = '13px DotGothic16, monospace';
    ctx.fillText(`供託${G.sticks}  あなた:${WIND[seatWind(0) - 27]}家`, 10, 40);
    const w = Math.max(12, Math.min(22, (L.W - 150 - 100) / 5.4));
    const x = Math.max(140, L.W - 100 - 5 * (w + 1));
    ctx.fillStyle = '#d8eee0'; ctx.font = '11px DotGothic16, monospace';
    ctx.fillText('ドラ表示', x, 9);
    drawDoraRow(x, 17, w);
  } else {
    const side = L.side;
    const x = side ? 18 : L.cx - L.hx + 8, y = side ? 22 : L.cy - L.hy + 14;
    const sc = side ? 1 : 0.75;
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(26 * sc)}px DotGothic16, monospace`;
    ctx.fillText(roundName(), x, y);
    ctx.fillStyle = '#9fd4b8'; ctx.font = `${Math.round(15 * sc)}px DotGothic16, monospace`;
    ctx.fillText(line2, x, y + 30 * sc);
    ctx.fillText(`あなた: ${WIND[seatWind(0) - 27]}家`, x, y + 52 * sc);
    ctx.fillStyle = '#d8eee0';
    ctx.fillText('ドラ表示牌', x, y + 80 * sc);
    drawDoraRow(x, y + 94 * sc, Math.round(26 * sc));
  }
}
function drawMine() {
  const h = G.h, p = h.P[0], tw = L.tw;
  const n = p.hand.length;
  const hasDrawn = n % 3 === 2 && p.drawn != null;
  const tiles = hasDrawn ? p.hand.filter(id => id !== p.drawn).concat([p.drawn]) : p.hand;
  let x = L.handX;
  const myTurn = pending && pending.kind === 'turn';
  tiles.forEach((id, i) => {
    if (hasDrawn && i === n - 1) x += tw * 0.35;
    const can = myTurn && canDiscard(id);
    const raise = can && (ui.selected === id || ui.hover === id) ? tw * 0.28 : 0;
    const y = L.handY - raise;
    drawTile(ctx, x, y, tw, id, { stand: true, dim: myTurn && !can, mark: ui.selected === id && can ? '#ffd84a' : null });
    if (myTurn && can && ui.tenpaiMap && ui.tenpaiMap.has(kindOf(id))) {
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath(); ctx.moveTo(x + tw / 2 - 5, y - 9); ctx.lineTo(x + tw / 2 + 5, y - 9); ctx.lineTo(x + tw / 2, y - 3); ctx.fill();
    }
    ui.hits.push({ id, x, y: L.handY, w: tw, h: tw * 1.56, raise: tw * 0.3 });
    x += tw;
  });
  if (p.melds.length) drawMelds(p, 0, L.meldRight, L.meldY, L.mw);
  // ヒント（待ち・フリテン）
  let hint = '';
  const focus = ui.selected != null ? ui.selected : ui.hover;
  if (settings.hint) {
    if (myTurn && focus != null && ui.tenpaiMap && ui.tenpaiMap.has(kindOf(focus))) hint = '切ると待ち: ' + ui.tenpaiMap.get(kindOf(focus)).map(kname).join(' ');
    else if (!myTurn && p.waits.length && n % 3 === 1) hint = '待ち: ' + p.waits.map(kname).join(' ') + (isFuriten(p) ? '（フリテン）' : '');
  }
  if (p.riichi && !hint) hint = 'リーチ中';
  if (ui.riichiMode) hint = 'リーチ：切る牌を選んでください';
  if (myTurn && !hint && !AUTO) hint = navigator.maxTouchPoints > 0 ? '切る牌を 2 回タップ' : '切る牌をクリック';
  if (hint) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '13px DotGothic16, monospace';
    const tw2 = ctx.measureText(hint).width + 14;
    const hx = L.handX, hy = L.hintY;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; rrect(ctx, hx, hy - 11, tw2, 22, 8); ctx.fill();
    ctx.fillStyle = '#ffe9a0'; ctx.fillText(hint, hx + 7, hy + 1);
  }
}
function drawPops() {
  const now = performance.now(), h = G.h;
  h.pops = h.pops.filter(pp => now - pp.t < 1300);
  for (const pp of h.pops) {
    let x = L.cx, y = L.cy;
    if (pp.seat >= 0) {
      const d = L.C / 2 + L.pw * 2.4, a = -pp.seat * Math.PI / 2;
      x = L.cx - d * Math.sin(a); y = L.cy + d * Math.cos(a);
    }
    const t = (now - pp.t) / 1300;
    const fs = Math.max(20, L.pw * 1.4) * (t < 0.1 ? 0.7 + t * 3 : 1);
    ctx.font = `${fs}px DotGothic16, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(pp.text).width + fs;
    ctx.globalAlpha = t > 0.8 ? (1 - t) * 5 : 1;
    ctx.fillStyle = 'rgba(20,10,10,0.82)'; rrect(ctx, x - tw / 2, y - fs * 0.75, tw, fs * 1.5, fs * 0.4); ctx.fill();
    ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffe36a'; ctx.fillText(pp.text, x, y + 1);
    ctx.globalAlpha = 1;
  }
  if (h.pops.length) dirty = true;
}
function loop() {
  if (dirty && L) { dirty = false; render(); }
  requestAnimationFrame(loop);
}

// ---------- 画面（タイトル・結果など） ----------
function showOverlay(html, cls) {
  overlay.className = 'show ' + (cls || '');
  overlay.innerHTML = '<div class="panel">' + html + '</div>';
  overlay.scrollTop = 0;
  return overlay.querySelector('.panel');
}
function hideOverlay() { overlay.className = ''; overlay.innerHTML = ''; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function waitClick(el) { const g = gen; return new Promise((res, rej) => el.addEventListener('click', () => (g === gen ? res() : rej(new Abort())), { once: true })); }

function handRow(p, seat, winId, w) {
  const row = document.createElement('div');
  row.className = 'tiles';
  const hand = p.hand.filter(id => id !== winId).sort((a, b) => a - b);
  for (const id of hand) row.appendChild(tileOf(id, w));
  if (winId != null) { const gap = document.createElement('span'); gap.className = 'gap'; row.appendChild(gap); row.appendChild(tileOf(winId, w, { mark: '#ffd84a' })); }
  for (const m of p.melds) {
    const gap = document.createElement('span'); gap.className = 'gap'; row.appendChild(gap);
    for (const t of meldTiles(m, seat)) {
      row.appendChild(t.back ? tileCanvas(0, false, w, { back: true }) : tileOf(t.id, w, { side: t.side }));
    }
  }
  return row;
}
function scoreTable(before, delta) {
  const rows = ranking().map(s => {
    const d = delta[s];
    return `<tr><td>${WIND[seatWind(s) - 27]}</td><td>${nameOf(s)}</td><td class="num">${before[s]}</td><td class="num ${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' + d : d || ''}</td><td class="num">${G.scores[s]}</td></tr>`;
  }).join('');
  return `<table class="scores">${rows}</table>`;
}
async function showResult(r) {
  if (AUTO) { await sleep(0); return; }
  const h = G.h;
  // 手牌 + 鳴き（横向きの牌は 1.36 枚ぶん）+ すき間が 1 行に収まる大きさ
  const units = p => p.hand.length + 1 + p.melds.reduce((a, m) => a + m.ids.length + 0.36 + (m.added != null ? 0.36 : 0) + 0.4, 0) + 0.4;
  const avail = Math.min(window.innerWidth - 24, 560) - 44;
  const fit = p => Math.max(14, Math.min(30, Math.floor(avail / units(p) - 1)));
  const tw = fit(h.P[r.seat != null ? r.seat : 0]);
  if (r.type === 'win') {
    const ev = r.ev, p = h.P[r.seat];
    const title = `${nameOf(r.seat)}の${r.tsumo ? 'ツモ' : 'ロン'}和了` + (r.tsumo ? '' : `<small>（${nameOf(r.from)}から）</small>`);
    const yaku = ev.yaku.map(y => `<tr><td>${esc(y[0])}</td><td class="num">${ev.yakuman ? (y[1] > 1 ? y[1] + '倍' : '') + '役満' : y[1] + '翻'}</td></tr>`).join('');
    const total = ev.yakuman ? ev.label : `${ev.fu}符 ${ev.han}翻` + (ev.label ? ' ' + ev.label : '');
    showOverlay(`<h2>${title}</h2><div id="rh"></div><div class="dora"><span>ドラ表示</span><span id="rd"></span>${p.riichi ? '<span>裏ドラ</span><span id="ru"></span>' : ''}</div>
      <table class="yaku">${yaku}</table><p class="total">${total}<b>${r.pointText}</b></p>
      ${r.sticks ? `<p class="small">供託 ${r.sticks * 1000}点も獲得</p>` : ''}${scoreTable(r.before, r.delta)}<button class="big" id="next">次へ</button>`, 'result');
    $('rh').appendChild(handRow(p, r.seat, r.tsumo ? p.drawn : r.ronId, tw));
    for (const id of doraIndicators()) $('rd').appendChild(tileOf(id, 20));
    if (p.riichi) for (const id of uraIndicators()) $('ru').appendChild(tileOf(id, 20));
  } else {
    const list = [0, 1, 2, 3].map(s => `<div class="tp"><p>${WIND[seatWind(s) - 27]} ${nameOf(s)}：${r.ten[s] ? '<b class="plus">テンパイ</b>' : 'ノーテン'}</p><div id="th${s}"></div></div>`).join('');
    showOverlay(`<h2>流局</h2>${list}${scoreTable(r.before, r.delta)}<button class="big" id="next">次へ</button>`, 'result');
    for (let s = 0; s < 4; s++) if (r.ten[s] || s === 0) $('th' + s).appendChild(handRow(h.P[s], s, null, Math.min(24, fit(h.P[s]))));
  }
  await waitClick($('next'));
  hideOverlay();
}
function loadStats() {
  const st = load(LS.stats, {});
  return Object.assign({ games: 0, ranks: [0, 0, 0, 0], best: null, tourPlays: 0, tourWins: 0, tourBest: -1 }, st);
}
async function showFinal() {
  // 残った供託はトップへ
  const order = ranking();
  if (G.sticks) { G.scores[order[0]] += G.sticks * 1000; G.sticks = 0; }
  const myRank = ranking().indexOf(0);
  if (AUTO) {
    const rk = window.__rank || (window.__rank = {});
    ranking().forEach((s, i) => { const id = G.chars[s]; (rk[id] || (rk[id] = [0, 0, 0, 0]))[i]++; });
    window.__autoDone = (window.__autoDone || 0) + 1;
    startMatch(null, autoOpt());
    return;
  }
  const st = loadStats();
  st.games++; st.ranks[myRank]++;
  if (st.best == null || G.scores[0] > st.best) st.best = G.scores[0];
  store(LS.stats, st);
  if (G.mode === 'tour') return tourAfterMatch(myRank);
  const msg = ['おめでとう！トップです！', '2位。あと一歩！', '3位。次はがんばろう', 'ラス…。次こそ！'][myRank];
  showOverlay(`<h2>対局終了</h2><p class="msg">${msg}</p>${finalTable()}
    <div class="btns"><button class="big" id="again">同じ相手ともう一度</button></div>
    <div class="btns"><button id="pick">相手を選ぶ</button><button id="totitle">タイトルへ</button></div>`, 'result');
  const chars = G.chars;
  $('again').onclick = () => { hideOverlay(); startMatch(null, { mode: 'free', chars }); };
  $('pick').onclick = () => showSelect();
  $('totitle').onclick = () => showTitle();
}
function finalTable() {
  const rows = ranking().map((s, i) => `<tr class="${s === 0 ? 'me' : ''}"><td>${i + 1}位</td><td>${s === 0 ? 'あなた' : charLabel(G.chars[s])}</td><td class="num">${G.scores[s]}</td></tr>`).join('');
  return `<table class="scores final">${rows}</table>`;
}
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const charLabel = id => `<i class="dot" style="background:${CHAR[id].color}"></i>${CHAR[id].name}`;
function charCard(id, on, tag) {
  const c = CHAR[id];
  return `<${tag || 'button'} class="char${on ? ' on' : ''}" data-id="${id}">
    <i class="face" style="background:${c.color}">${c.name[0]}</i>
    <span class="nm"><b>${c.name}</b><em>${stars(c.stars)}</em></span>
    <span class="lb">${c.label}</span><small>${c.desc}</small></${tag || 'button'}>`;
}
function autoOpt() {
  if (AUTO_CHARS) return { mode: 'free', chars: AUTO_CHARS.slice(0, 4) };
  const ids = shuffle(CHARS.map(c => c.id)).slice(0, 4);
  return { mode: 'free', chars: ids };
}

// ---------- フリー対局：相手を選ぶ ----------
function showSelect() {
  abortAll(); G = null; dirty = true;
  let sel = (settings.rivals || []).filter(id => CHAR[id]).slice(0, 3);
  const p = showOverlay(`<h2>対戦相手を 3 人選ぶ</h2>
    <div class="chars">${CHARS.map(c => charCard(c.id, sel.includes(c.id))).join('')}</div>
    ${opt('対局', 'length', [['east', '東風戦'], ['half', '半荘戦']])}
    <div class="btns"><button id="rand">おまかせ</button><button class="big" id="go">対局開始</button></div>
    <div class="btns"><button id="back">もどる</button></div>`, 'select');
  bindOpts(p);
  const refresh = () => {
    p.querySelectorAll('.char').forEach(b => b.classList.toggle('on', sel.includes(b.dataset.id)));
    $('go').disabled = sel.length !== 3;
    $('go').textContent = sel.length === 3 ? '対局開始' : `あと ${3 - sel.length} 人`;
  };
  p.querySelector('.chars').addEventListener('click', e => {
    const b = e.target.closest('.char'); if (!b) return;
    const id = b.dataset.id;
    if (sel.includes(id)) sel = sel.filter(x => x !== id);
    else { sel.push(id); if (sel.length > 3) sel.shift(); }
    refresh();
  });
  $('rand').onclick = () => { sel = shuffle(CHARS.map(c => c.id)).slice(0, 3); refresh(); };
  $('go').onclick = () => {
    if (sel.length !== 3) return;
    settings.rivals = sel.slice(); saveSettings();
    ensureAudio(); hideOverlay();
    startMatch(null, { mode: 'free', chars: [null, ...shuffle(sel.slice())] });
  };
  $('back').onclick = () => showTitle();
  refresh();
}

// ---------- トーナメント ----------
// 予選・準決勝は 2 位以内で勝ち上がり、決勝は 1 位で優勝
function newTour() {
  const used = new Set(), ops = [];
  // 決勝から順に相手を決める（なるべく同じ相手と二度当たらないように）
  for (let i = TOUR.length - 1; i >= 0; i--) {
    const t = TOUR[i];
    const pool = shuffle(t.pool.filter(id => !used.has(id))).concat(shuffle(t.pool.filter(id => used.has(id))));
    const list = t.fixed.slice();
    for (const id of pool) if (list.length < 3 && !list.includes(id)) list.push(id);
    list.forEach(id => used.add(id));
    ops[i] = list;
  }
  return { stage: 0, ops, results: [] };
}
function showTour() {
  abortAll(); G = null; dirty = true;
  let T = load(LS.tour, null);
  if (!T) {
    T = newTour(); store(LS.tour, T);
    const st = loadStats(); st.tourPlays++; store(LS.stats, st);
  }
  const stages = TOUR.map((t, i) => {
    const r = T.results.find(x => x.stage === i);
    const state = r ? `<b class="plus">${r.rank + 1}位で通過</b>` : i === T.stage ? '<b class="now">つぎの対局</b>' : '';
    const rule = t.pass === 1 ? '1位で優勝' : `${t.pass}位以内で勝ち上がり`;
    return `<div class="stage${i === T.stage ? ' cur' : ''}${r ? ' done' : ''}">
      <p class="sh"><span>${i + 1}. ${t.name}</span><small>${rule}</small>${state}</p>
      <div class="chars mini">${T.ops[i].map(id => charCard(id, false, 'div')).join('')}</div></div>`;
  }).join('');
  showOverlay(`<h2>トーナメント</h2><p class="small">1 戦ずつ東風戦。勝ち上がるほど相手が強くなります</p>${stages}
    <div class="btns"><button class="big" id="go">${TOUR[T.stage].name}を打つ</button></div>
    <div class="btns"><button id="totitle">タイトルへ（続きは保存）</button><button id="retire">棄権する</button></div>`, 'tour');
  $('go').onclick = () => { ensureAudio(); hideOverlay(); startMatch(null, { mode: 'tour', chars: [null, ...shuffle(T.ops[T.stage].slice())] }); };
  $('totitle').onclick = () => showTitle();
  $('retire').onclick = () => {
    if (!confirm('棄権するとトーナメントは終わります。よろしいですか？')) return;
    const st = loadStats(); st.tourBest = Math.max(st.tourBest, T.stage - 1); store(LS.stats, st);
    unstore(LS.tour); showTitle();
  };
}
function tourAfterMatch(rank) {
  const T = load(LS.tour, null) || newTour();
  const t = TOUR[T.stage];
  const pass = rank < t.pass;
  const st = loadStats();
  if (pass) T.results.push({ stage: T.stage, rank, score: G.scores[0] });
  let html;
  if (pass && T.stage === TOUR.length - 1) {
    st.tourWins++; st.tourBest = TOUR.length - 1;
    unstore(LS.tour);
    html = `<h2>優勝！</h2><p class="msg">おめでとう！ 月夜の雀荘のチャンピオンです</p>${finalTable()}
      <p class="small">トーナメント優勝 ${st.tourWins}回</p>
      <div class="btns"><button class="big" id="next">タイトルへ</button></div>`;
  } else if (pass) {
    st.tourBest = Math.max(st.tourBest, T.stage);
    T.stage++;
    store(LS.tour, T);
    html = `<h2>${t.name} 突破！</h2><p class="msg">${rank + 1}位で勝ち上がり。次は${TOUR[T.stage].name}です</p>${finalTable()}
      <div class="btns"><button class="big" id="next">つぎへ</button></div>`;
  } else {
    st.tourBest = Math.max(st.tourBest, T.stage - 1);
    unstore(LS.tour);
    html = `<h2>${t.name}で敗退…</h2><p class="msg">${rank + 1}位。${t.pass === 1 ? '1位' : t.pass + '位以内'}で勝ち上がりでした</p>${finalTable()}
      <div class="btns"><button class="big" id="next">タイトルへ</button></div>`;
  }
  store(LS.stats, st);
  showOverlay(html, 'result');
  $('next').onclick = () => (pass && T.stage < TOUR.length && load(LS.tour, null) ? showTour() : showTitle());
}

function opt(name, key, choices) {
  return `<div class="opt"><span>${name}</span><div class="seg" data-key="${key}">` +
    choices.map(([v, l]) => `<button data-v="${v}" class="${String(settings[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('') + '</div></div>';
}
function bindOpts(root) {
  root.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const key = seg.dataset.key; let v = b.dataset.v;
    if (v === 'true') v = true; else if (v === 'false') v = false;
    settings[key] = v; saveSettings();
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (key === 'sound') updateSoundBtn();
    dirty = true;
  }));
}
function showTitle() {
  abortAll();
  G = null; dirty = true;
  const snap = load(LS.save, null);
  const tour = load(LS.tour, null);
  const st = loadStats();
  const stats = st.games ? `<p class="small">これまで ${st.games}局（1位 ${st.ranks[0]}回・2位 ${st.ranks[1]}回・3位 ${st.ranks[2]}回・4位 ${st.ranks[3]}回）` +
    (st.tourPlays ? `<br>トーナメント 優勝 ${st.tourWins}回 / 挑戦 ${st.tourPlays}回` : '') + '</p>' : '';
  const contInfo = snap ? `${snap.mode === 'tour' ? 'トーナメント・' : ''}${WIND[Math.floor(snap.roundNum / 4)]}${snap.roundNum % 4 + 1}局 ${snap.honba}本場のはじめから（あなた ${snap.scores[0]}点）` : '';
  const p = showOverlay(`<h1>月夜の雀荘</h1><p class="sub">4人打ちリーチ麻雀　${CHARS.length}人のライバル</p>
    ${snap ? `<div class="btns"><button class="big" id="cont">続きから</button></div><p class="small">${contInfo}</p>` : ''}
    <div class="btns modes"><button class="big" id="free">フリー対局<small>相手を選んで打つ</small></button>
      <button class="big" id="tour">トーナメント<small>${tour ? `続き：${TOUR[tour.stage].name}から` : '予選→準決勝→決勝'}</small></button></div>
    ${opt('赤ドラ', 'aka', [[true, 'あり'], [false, 'なし']])}
    ${opt('CPUの速さ', 'speed', [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']])}
    ${opt('待ちのヒント', 'hint', [[true, 'あり'], [false, 'なし']])}
    <div class="btns"><button id="howto">遊び方・役一覧</button><button id="roster">キャラクター</button></div>${stats}
    <p class="back"><a href="../index.html">← ゲーム一覧へ</a></p>`, 'title');
  bindOpts(p);
  if (snap) $('cont').onclick = () => { ensureAudio(); hideOverlay(); startMatch(snap); };
  const leaveSnap = next => {
    if (snap && !confirm('保存してある対局の続きは消えます。よろしいですか？')) return;
    unstore(LS.save);
    next();
  };
  $('free').onclick = () => leaveSnap(showSelect);
  $('tour').onclick = () => leaveSnap(showTour);
  $('howto').onclick = () => showHowto(showTitle);
  $('roster').onclick = () => {
    showOverlay(`<h2>キャラクター</h2><div class="chars">${CHARS.map(c => charCard(c.id, false, 'div')).join('')}</div>
      <button class="big" id="back">もどる</button>`, 'select');
    $('back').onclick = () => showTitle();
  };
}
function startMatch(snap, opt) {
  abortAll();
  newMatch(snap, opt || {});
  dirty = true;
  playMatch();
}
const YAKU_LIST = [
  ['1翻', '立直（リーチ）・一発・門前清自摸和（メンゼンツモ）・断么九（タンヤオ）・平和（ピンフ）・一盃口・役牌（白・發・中・自風・場風）・嶺上開花・槍槓・海底摸月・河底撈魚'],
  ['2翻', 'ダブル立直・七対子・三色同順※・一気通貫※・混全帯么九（チャンタ）※・対々和・三暗刻・三色同刻・三槓子・小三元・混老頭'],
  ['3翻', '二盃口・純全帯么九（ジュンチャン）※・混一色（ホンイツ）※'],
  ['6翻', '清一色（チンイツ）※'],
  ['役満', '国士無双・四暗刻・大三元・小四喜・大四喜・字一色・緑一色・清老頭・九蓮宝燈・四槓子・天和・地和'],
];
function showHowto(back) {
  const yaku = YAKU_LIST.map(([h, l]) => `<tr><th>${h}</th><td>${l}</td></tr>`).join('');
  showOverlay(`<h2>遊び方</h2>
    <ul class="howto">
      <li>あなた（下）と CPU 3人で打つ、ふつうのリーチ麻雀です。持ち点 25000点。東風戦は東1〜4局、半荘戦は南4局まで（フリー対局で選べます）。だれかが 0点未満になったら終わり</li>
      <li>自分の番は牌を 1 枚ツモって、1 枚切ります。<b>パソコン</b>はクリック、<b>スマホ</b>は同じ牌を 2 回タップで切ります</li>
      <li>和了れるとき・鳴けるときは下にボタンが出ます（ツモ・ロン・リーチ・ポン・チー・カン・スキップ）。メニュー（≡）で鳴きの確認を「しない」にもできます</li>
      <li>リーチはメンゼンでテンパイのとき。押すと切れる牌だけが明るくなります。リーチ後はツモ切りが自動</li>
      <li><b>フリー対局</b>は ${CHARS.length}人のキャラクターから相手を 3 人選んで打ちます。<b>トーナメント</b>は予選・準決勝（2位以内で勝ち上がり）と決勝（1位で優勝）の 3 戦。どれも東風戦です</li>
      <li>キャラクターごとに打ち方の癖があります（タイトルの「キャラクター」で見られます）。★5 の<b>シノブ</b>は先読みと押し引きの計算をする強敵です</li>
      <li>和了には役が 1 つ以上必要です。ドラは役になりません</li>
      <li>待ちのヒントが「あり」なら、切るとテンパイになる牌に ▼ が付き、テンパイ中は待ち牌が表示されます</li>
      <li>フリテン（自分の捨て牌に待ち牌がある・見逃した）だとロンできません。ツモは OK</li>
      <li>食いタンあり・後付けあり・喰い替えなし・ダブロンなし（頭ハネ）・途中流局なし・西入なし。オーラスは親がトップならあがりやめ</li>
    </ul>
    <h3>役一覧（※は鳴くと 1翻下がる）</h3><table class="ylist">${yaku}</table>
    <button class="big" id="back">もどる</button>`, 'howto');
  $('back').onclick = back;
}
function showMenu() {
  if (!G) return;
  const p = showOverlay(`<h2>メニュー</h2>
    ${opt('鳴きの確認', 'noCall', [[false, 'する'], [true, 'しない']])}
    ${opt('待ちのヒント', 'hint', [[true, 'あり'], [false, 'なし']])}
    ${opt('CPUの速さ', 'speed', [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']])}
    <div class="btns"><button class="big" id="resume">対局にもどる</button></div>
    <div class="btns"><button id="rules">遊び方・役一覧</button><button id="quit">タイトルへ</button></div>
    <p class="small">タイトルへ戻っても、この局のはじめから続きができます</p>`, 'menu');
  bindOpts(p);
  $('resume').onclick = () => { hideOverlay(); renderActions(); };
  $('rules').onclick = () => showHowto(showMenu);
  $('quit').onclick = () => showTitle();
}
$('menuBtn').addEventListener('click', () => { ensureAudio(); if (G && !overlay.classList.contains('show')) showMenu(); });

// ---------- 音 ----------
let actx = null;
function ensureAudio() {
  if (!settings.sound) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { actx = null; }
}
function tone(f, t0, dur, type, vol) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square'; o.frequency.value = f;
  g.gain.setValueAtTime(vol || 0.06, actx.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + 0.02);
}
function snd(kind) {
  if (!settings.sound || !actx || AUTO) return;
  try {
    if (kind === 'tile') {
      const len = 0.05, buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2; g.gain.value = 0.5;
      src.buffer = buf; src.connect(f).connect(g).connect(actx.destination); src.start();
    } else if (kind === 'call') { tone(660, 0, 0.09); tone(880, 0.09, 0.14); }
    else if (kind === 'win') { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.08)); }
  } catch (e) { /* 音が出なくても続ける */ }
}
function updateSoundBtn() { $('soundBtn').classList.toggle('off', !settings.sound); }
$('soundBtn').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); updateSoundBtn(); ensureAudio(); });
updateSoundBtn();

// ---------- 起動 ----------
resize();
requestAnimationFrame(loop);
// 牌の字のフォントが読み込めたら描き直す
if (document.fonts && document.fonts.load) {
  Promise.all([document.fonts.load(`700 20px "Noto Serif JP"`, '一萬東'), document.fonts.load('16px DotGothic16')])
    .then(() => { faceCache.clear(); dirty = true; }).catch(() => {});
}
if (AUTO) { settings.speed = 'fast'; startMatch(null, autoOpt()); } else showTitle();
window.__mj = { get G() { return G; } }; // デバッグ用
window.__mjHits = () => ui.hits.filter(h => canDiscard(h.id));
})();
