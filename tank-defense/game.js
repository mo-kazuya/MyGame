'use strict';
// 鉄壁の砲台：道を進んでくる戦車の群れを、砲台を建てて基地の手前で食い止めるタワーディフェンス。
// 空き地に砲台（機関砲・大砲・電磁波・ミサイル）を建て、倒した戦車の報酬で強化していく。
// ステージ制：決められた数のウェーブをしのぎ切るとクリア。基地の耐久が 0 になったらゲームオーバー。
//
// ゲームの中の座標はいつも横長（16×10 マス）で扱い、縦長の画面では描くときに x と y を入れ替える
// （対角線で折り返す）。こうすると縦持ちのスマホでもマスが大きく見える。
// 文字・体力ゲージ・基地の旗のように向きが変わると困るものは uprightAt() で画面の向きのまま描く。

(function () {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const field = document.getElementById('field');
  const overlay = document.getElementById('overlay');
  const tools = document.getElementById('tools');
  const nextBtn = document.getElementById('next');
  const pauseBtn = document.getElementById('pause');
  const soundBtn = document.getElementById('sound');
  const speedBtn = document.getElementById('speed');
  const moneyEl = document.getElementById('money');
  const livesEl = document.getElementById('lives');
  const waveEl = document.getElementById('wave');
  const skillsEl = document.getElementById('skills');

  const TILE = 40, COLS = 16, ROWS = 10;
  const W = COLS * TILE, H = ROWS * TILE;
  const SPEEDS = [1, 2, 3];   // ゲーム全体のスピード
  const SELL_RATE = 0.7;      // 売ったときに戻ってくる割合

  // ---------- 砲台 ----------
  // 値はレベル（0・1）ごと。cost[0] は建てる値段、cost[1] は Lv2 への強化の値段。
  // range は射程（マス）、rate は撃つ間隔（秒）、dmg は 1 発の威力。
  // Lv3 への強化では br の a・b のどちらかの「型」を選ぶ（書いてない値は Lv2 のまま）。型だけが持つ値：
  //   ap 装甲を無視する割合／fire 着弾点が燃える強さ（毎秒）／minRange これより近くは撃てない／
  //   stun 止める秒数（stunEvery 秒ごと）／weak 下げる装甲／count 一度に撃つミサイルの数／heavy 体力が多いほど強い
  const TURRETS = {
    mg: {
      name: '機関砲', color: '#7dd36a', cost: [50, 45],
      range: [2.3, 2.5], rate: [0.22, 0.18], dmg: [7, 11],
      desc: '連射が速い。装甲の厚い戦車は苦手',
      br: {
        a: { name: '徹甲弾', cost: 90, dmg: 17, rate: 0.14, range: 2.8, ap: 0.75, desc: '装甲の 3/4 を無視する。重戦車にも効く' },
        b: { name: '二連装', cost: 90, dmg: 12, rate: 0.07, range: 2.4, desc: '倍の速さで撃つ。群れに強いが射程は短い' },
      },
    },
    cannon: {
      name: '大砲', color: '#ffb43c', cost: [100, 85],
      range: [2.6, 2.8], rate: [1.5, 1.35], dmg: [42, 75], splash: [0.9, 1.0],
      desc: '着弾したまわりをまとめて吹き飛ばす',
      br: {
        a: { name: '焼夷弾', cost: 160, dmg: 105, rate: 1.2, range: 3.1, splash: 1.2, fire: 22, desc: '着弾した所が 3 秒燃え、装甲を無視して焼く' },
        b: { name: '長距離砲', cost: 170, dmg: 175, rate: 1.6, range: 4.6, splash: 1.0, minRange: 1.5, desc: 'とても遠くまで届くが、近すぎる戦車は撃てない' },
      },
    },
    emp: {
      name: '電磁波', color: '#6ad0ff', cost: [80, 70],
      range: [1.8, 2.1], rate: [1.2, 1.1], dmg: [4, 8], slow: [0.35, 0.45],
      desc: 'まわりの戦車をまとめて遅くする。装甲を無視。遅くした戦車には大砲が 1.3 倍効く',
      br: {
        a: { name: '衝撃波', cost: 140, dmg: 14, rate: 1.0, range: 2.4, slow: 0.55, stun: 1.2, stunEvery: 6, desc: '6 秒ごとに、まわりの戦車を 1.2 秒止める' },
        b: { name: '弱体化', cost: 130, dmg: 10, rate: 1.0, range: 2.6, slow: 0.45, weak: 5, desc: 'まわりの戦車の装甲を 5 下げる。機関砲と好相性' },
      },
    },
    missile: {
      name: 'ミサイル', color: '#ff6a6a', cost: [150, 120],
      range: [4.0, 4.5], rate: [2.2, 2.0], dmg: [95, 170],
      desc: '遠くまで届き、追いかけて当たる。重戦車に強い',
      br: {
        a: { name: '多弾頭', cost: 220, dmg: 120, rate: 1.9, range: 5.0, count: 3, desc: '3 発に分かれて、別々の戦車をねらう' },
        b: { name: '対装甲', cost: 230, dmg: 250, rate: 1.9, range: 5.0, heavy: true, desc: '体力の多い戦車ほど大ダメージ（最大 2.5 倍）' },
      },
    },
  };
  const TURRET_ORDER = ['mg', 'cannon', 'emp', 'missile'];
  // 砲台の値（Lv3 で型を選んでいればその型の値）
  function stat(t, k) {
    const D = TURRETS[t.type];
    if (t.lv === 2 && t.br && k in D.br[t.br]) return D.br[t.br][k];
    const v = D[k];
    return Array.isArray(v) ? v[Math.min(t.lv, v.length - 1)] : v;
  }
  const upCost = (t, br) => t.lv === 0 ? TURRETS[t.type].cost[1] : TURRETS[t.type].br[br || 'a'].cost;
  // ねらい方（砲台をタップして切り替える）
  const AIMS = [['first', '先頭'], ['last', '最後尾'], ['strong', '最強'], ['fast', '最速']];

  // ---------- 支援（ウェーブ中だけ待ち時間が減る） ----------
  const SKILLS = {
    air:  { name: '空爆', key: 'Q', cd: 45, desc: '空爆：タップした場所に爆弾を落とす' },
    mine: { name: '地雷', key: 'W', cd: 20, desc: '地雷：道をタップして置く。戦車が踏むと爆発' },
    rush: { name: '一斉', key: 'E', cd: 60, desc: '一斉射撃：8 秒間、すべての砲台が倍の速さで撃つ' },
  };
  const SKILL_ORDER = ['air', 'mine', 'rush'];
  const airDmg = n => 150 + 30 * n, mineDmg = n => 100 + 22 * n;
  const RUSH_TIME = 8;
  const INTEREST = 0.05, INTEREST_MAX = 30;            // ウェーブを守り切るたびの利息（手持ちの 5%、最大 $30）
  const earlyBonus = (n, left) => Math.round(Math.min(left, 8) * (2 + n * 0.5)); // 早めに次を呼んだボーナス

  // ---------- 戦車 ----------
  // speed はマス／秒。armor は 1 発ごとに威力から引かれる（最低でも威力の 1/4 は通る）。dmg は基地に着いたときの被害
  const TANKS = {
    scout: { name: '偵察車',   hp: 32,   speed: 2.3,  armor: 0,  reward: 4,   dmg: 1,  r: 9,  color: '#d8c27a' },
    light: { name: '軽戦車',   hp: 80,   speed: 1.35, armor: 2,  reward: 7,   dmg: 1,  r: 11, color: '#8fae5a' },
    heavy: { name: '重戦車',   hp: 300,  speed: 0.7,  armor: 7,  reward: 16,  dmg: 2,  r: 14, color: '#73848f' },
    boss:  { name: '超重戦車', hp: 1700, speed: 0.45, armor: 10, reward: 100, dmg: 10, r: 19, color: '#8a5048' },
  };

  // ---------- ステージ ----------
  // paths は戦車の通り道（マスの [列, 行] を角ごとに並べる。最初の点は画面の外、最後の点が基地）。
  // 道が 2 本あるステージでは、戦車が交互に分かれて出てくる。
  // rocks・water には砲台を建てられない。hp はこのステージの戦車の体力の倍率。
  // ground は地面の色（書かなければ草原、'sand' は砂漠、'snow' は雪原）
  const STAGES = [
    {
      name: '草原の一本道', waves: 8, hp: 1.0, money: 220, lives: 20,
      paths: [[[-1, 1], [6, 1], [6, 5], [12, 5], [12, 8], [15, 8]]],
      rocks: [[2, 3], [10, 3], [14, 2], [9, 8]], water: [[3, 7], [4, 7], [3, 8], [4, 8]],
      note: 'まずは機関砲と大砲で。曲がり角のそばに建てると長く撃ち続けられる',
    },
    {
      name: 'つづら折りの谷', waves: 10, hp: 1.35, money: 240, lives: 20,
      paths: [[[-1, 1], [12, 1], [12, 3], [3, 3], [3, 7], [12, 7], [12, 9]]],
      rocks: [[14, 0], [7, 5], [15, 8], [0, 8]], water: [[8, 5], [9, 5], [8, 6]],
      note: '曲がりくねった長い道。重戦車が出てきたらミサイルの出番',
    },
    {
      name: '挟み撃ち', waves: 12, hp: 1.6, money: 280, lives: 20,
      paths: [
        [[-1, 1], [6, 1], [6, 5], [15, 5]],
        [[-1, 8], [9, 8], [9, 5], [15, 5]],
      ],
      rocks: [[2, 4], [12, 2], [13, 8], [3, 6]], water: [[11, 7], [12, 7], [11, 8]],
      note: '戦車が 2 つの道からやって来る。道が合流するところを固めよう',
    },
    {
      name: '最終防衛線', waves: 15, hp: 1.9, money: 320, lives: 20,
      paths: [
        [[7, -1], [7, 2], [2, 2], [2, 7], [13, 7], [13, 2], [10, 2], [10, 4]],
        [[4, 10], [4, 7], [13, 7], [13, 2], [10, 2], [10, 4]],
      ],
      rocks: [[0, 0], [15, 9], [7, 5], [15, 0]], water: [[5, 4], [5, 5]],
      note: '基地は真ん中。上と下から押し寄せる戦車の大軍を、15 ウェーブ守り切れ',
    },
    {
      name: '砂漠の三叉路', waves: 15, hp: 2.2, money: 340, lives: 20, ground: 'sand',
      paths: [
        [[-1, 1], [4, 1], [4, 3], [10, 3], [10, 5], [15, 5]],
        [[-1, 6], [3, 6], [3, 8], [8, 8], [8, 5], [15, 5]],
        [[13, 10], [13, 7], [11, 7], [11, 5], [15, 5]],
      ],
      rocks: [[1, 3], [7, 1], [14, 8], [6, 6]], water: [[0, 9], [1, 9], [1, 8]],
      note: '3 本の道。下から来る道はとても短い。地雷と空爆で抜け道をふさごう',
    },
    {
      name: '雪原の大回廊', waves: 18, hp: 3.3, money: 320, lives: 20, ground: 'snow',
      paths: [[[-1, 0], [14, 0], [14, 9], [1, 9], [1, 2], [12, 2], [12, 7], [3, 7], [3, 4], [9, 4]]],
      rocks: [[0, 5], [7, 5], [15, 4]], water: [[5, 5], [6, 5], [5, 6]],
      note: 'うず巻きの長い道を、とても硬い戦車がやって来る。型の組み合わせで 18 ウェーブ耐え抜け',
    },
  ];

  // ウェーブの中身。n は 1 から数えたウェーブの番号、total はそのステージのウェーブ数。
  // 偵察車の群れ → 軽戦車 → 重戦車 の 3 つを繰り返しながら、だんだん数が増える。最後のウェーブには超重戦車
  function makeWave(n, total) {
    const list = [];
    const add = (type, num, gap) => { for (let i = 0; i < num; i++) list.push({ type, gap }); };
    const k = n % 3;
    if (k === 1) add('scout', 5 + Math.round(n * 1.3), 0.55);
    if (k === 2) { add('light', 3 + Math.round(n * 0.8), 0.95); add('scout', Math.floor(n / 2), 0.5); }
    if (k === 0) { add('light', 2 + Math.floor(n / 2), 0.9); add('heavy', 1 + Math.floor(n / 3), 1.8); }
    if (n >= 5 && k !== 0) add('heavy', Math.floor((n - 2) / 3), 1.8);
    if (n === total || n % 10 === 0) { add('light', 3, 0.8); add('boss', 1 + Math.floor(n / 12), 3.5); }
    return list;
  }
  const hpScale = n => (1 + 0.15 * (n - 1)) * STAGES[stageNo].hp;
  const rewardScale = n => 1 + 0.03 * (n - 1);
  const waveBonus = n => 20 + n * 5;

  // マスの種類
  const GRASS = 0, ROAD = 1, ROCK = 2, WATER = 3, BASE = 4;

  let dpr = 1, scale = 1, offX = 0, offY = 0, portrait = false;
  let state = 'title'; // title / play / pause / ending / over / clear
  // 遊べるステージと星の数（保存した値は、下の「小さな道具」ができてから読み込む）
  let stageNo = 0, unlocked = 0, stars = [];
  let grid = [], paths = [], base = { c: 0, r: 0, x: 0, y: 0 }, bg = null, bgScale = 0;
  let turrets = [], enemies = [], shells = [], missiles = [];
  let tracers = [], rings = [], particles = [], decals = [], texts = [];
  let fires = [], mines = [], strikes = [];   // 燃えている所・地雷・空爆
  let skillCd = {}, skillMode = null, rushT = 0; // 支援の待ち時間・場所を選んでいる支援・一斉射撃の残り時間
  let pendingBr = null;  // Lv3 の型を選ぶとき、1 回目のタップで説明を出し、2 回目で決める
  let money = 0, lives = 0, wave = 0, inWave = false, spawnQ = [], spawnT = 0;
  let sel = null;        // 選んでいるもの：{ c, r }（空き地）か { turret }
  let placeType = null;  // 下の一覧で選んだ砲台（この状態で空き地をタップすると建つ）
  let hover = null;      // マウスが指しているマス（建てる前の見本を描く）
  let toast = null, shake = 0, endT = 0, clock = 0;
  let gameSpeed = loadSpeedSetting();

  // ---------- 小さな道具 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function loadNum(key, max) {
    try { return clamp(Math.floor(+localStorage.getItem(key) || 0), 0, max); } catch (e) { return 0; }
  }
  function loadStars() {
    try {
      const a = JSON.parse(localStorage.getItem('tankdef.stars') || '[]');
      return STAGES.map((s, i) => clamp(Math.floor(+a[i] || 0), 0, 3));
    } catch (e) { return STAGES.map(() => 0); }
  }
  function loadSpeedSetting() {
    try {
      const v = +localStorage.getItem('tankdef.speed');
      return SPEEDS.includes(v) ? v : 1;
    } catch (e) { return 1; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) { /* 保存できなくても遊べる */ }
  }
  unlocked = loadNum('tankdef.stage', STAGES.length - 1);
  stars = loadStars();

  // ---------- 音（WebAudio で簡単な効果音） ----------
  let actx = null, muted = false, noiseBuf = null;
  try { muted = localStorage.getItem('tankdef.muted') === '1'; } catch (e) { /* 無視 */ }
  soundBtn.classList.toggle('off', muted);
  function unlockAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null, delay = 0) {
    if (muted || !actx) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur);
  }
  // 爆発音などの「ザッ」という音（ノイズを低い音だけ通して鳴らす）
  function noise(dur, vol, freq) {
    if (muted || !actx) return;
    const t = actx.currentTime;
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noiseBuf;
    f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(actx.destination);
    s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }
  // 砲台がたくさんあると同じ音が重なりすぎるので、同じ音は少し間をあけて鳴らす
  const lastSfx = {};
  function play(name, gap, fn) {
    if (!actx || muted) return;
    const now = actx.currentTime;
    if (now - (lastSfx[name] || -1) < gap) return;
    lastSfx[name] = now;
    fn();
  }
  const sfx = {
    mg: () => play('mg', 0.06, () => tone(900, 0.04, 'square', 0.025, 500)),
    cannon: () => play('cannon', 0.08, () => { tone(160, 0.22, 'sawtooth', 0.08, 50); noise(0.2, 0.12, 900); }),
    missile: () => play('missile', 0.1, () => noise(0.35, 0.07, 2500)),
    emp: () => play('emp', 0.1, () => tone(300, 0.3, 'sine', 0.08, 1200)),
    boom: () => play('boom', 0.05, () => noise(0.35, 0.16, 600)),
    bigBoom: () => { noise(1.0, 0.3, 400); tone(90, 0.8, 'sawtooth', 0.15, 30); },
    build: () => { tone(330, 0.08, 'square', 0.07); tone(494, 0.12, 'square', 0.07, null, 0.07); },
    upgrade: () => [523, 659, 784].forEach((f, i) => tone(f, 0.1, 'triangle', 0.1, null, i * 0.07)),
    sell: () => { tone(784, 0.08, 'triangle', 0.08); tone(523, 0.12, 'triangle', 0.08, null, 0.07); },
    hit: () => { tone(220, 0.3, 'square', 0.12, 80); noise(0.3, 0.15, 800); },
    wave: () => { tone(392, 0.15, 'square', 0.08); tone(392, 0.15, 'square', 0.08, null, 0.2); tone(587, 0.3, 'square', 0.08, null, 0.4); },
    bonus: () => [659, 784, 988].forEach((f, i) => tone(f, 0.1, 'triangle', 0.09, null, i * 0.08)),
    clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.5 : 0.14, 'triangle', 0.13, null, i * 0.13)),
    over: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'square', 0.08, null, i * 0.22)),
    no: () => tone(150, 0.12, 'square', 0.06),
  };

  // ---------- 画面サイズ ----------
  function resize() {
    const cw = field.clientWidth, ch = field.clientHeight;
    if (!cw || !ch) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    portrait = ch > cw;
    const vw = portrait ? H : W, vh = portrait ? W : H;
    scale = Math.min((cw - 8) / vw, (ch - 8) / vh);
    offX = (cw - vw * scale) / 2;
    offY = (ch - vh * scale) / 2;
    const want = clamp(Math.ceil(scale * dpr), 1, 4);
    if (want !== bgScale) { bgScale = want; renderBackground(); }
  }
  // ゲームの座標 → 画面の座標（縦長の画面では x と y を入れ替える）
  function toScreen(x, y) {
    return portrait ? { x: offX + y * scale, y: offY + x * scale } : { x: offX + x * scale, y: offY + y * scale };
  }
  function toWorld(px, py) {
    const u = (px - offX) / scale, v = (py - offY) / scale;
    return portrait ? { x: v, y: u } : { x: u, y: v };
  }
  let shakeX = 0, shakeY = 0;
  function worldTf() {
    const s = scale * dpr, ox = (offX + shakeX) * dpr, oy = (offY + shakeY) * dpr;
    if (portrait) ctx.setTransform(0, s, s, 0, ox, oy);
    else ctx.setTransform(s, 0, 0, s, ox, oy);
  }
  // (x, y) を原点にして、画面の向きのまま（入れ替えずに）描く
  function uprightAt(x, y) {
    const p = toScreen(x, y), s = scale * dpr;
    ctx.setTransform(s, 0, 0, s, (p.x + shakeX) * dpr, (p.y + shakeY) * dpr);
  }

  // ---------- マップ ----------
  function buildMap() {
    const S = STAGES[stageNo];
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(GRASS));
    const mark = (c, r, v) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r][c] = v; };
    paths = S.paths.map(wps => {
      for (let i = 0; i + 1 < wps.length; i++) {
        let [c, r] = wps[i];
        const [c1, r1] = wps[i + 1];
        const sc = Math.sign(c1 - c), sr = Math.sign(r1 - r);
        mark(c, r, ROAD);
        while (c !== c1 || r !== r1) { c += sc; r += sr; mark(c, r, ROAD); }
      }
      const pts = wps.map(([c, r]) => ({ x: (c + 0.5) * TILE, y: (r + 0.5) * TILE }));
      const segs = [];
      let len = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], L = dist(a.x, a.y, b.x, b.y);
        segs.push({ x: a.x, y: a.y, dx: (b.x - a.x) / L, dy: (b.y - a.y) / L, L, start: len });
        len += L;
      }
      return { wps, pts, segs, len };
    });
    const [bc, br] = S.paths[0][S.paths[0].length - 1];
    base = { c: bc, r: br, x: (bc + 0.5) * TILE, y: (br + 0.5) * TILE };
    grid[br][bc] = BASE;
    S.rocks.forEach(([c, r]) => mark(c, r, ROCK));
    S.water.forEach(([c, r]) => mark(c, r, WATER));
    bgScale = 0;
    resize();
  }
  function pathPos(p, d) {
    let s = p.segs[p.segs.length - 1];
    for (const g of p.segs) if (d < g.start + g.L) { s = g; break; }
    const k = clamp(d - s.start, 0, s.L);
    return { x: s.x + s.dx * k, y: s.y + s.dy * k, a: Math.atan2(s.dy, s.dx) };
  }
  const inMap = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
  const turretAt = (c, r) => turrets.find(t => t.c === c && t.r === r);
  const buildable = (c, r) => inMap(c, r) && grid[r][c] === GRASS && !turretAt(c, r);

  // 地面（草地・道・岩・池）は変わらないので、ステージが始まるときに別のキャンバスへ描いておく
  function renderBackground() {
    if (!paths.length) return;
    bg = document.createElement('canvas');
    bg.width = W * bgScale; bg.height = H * bgScale;
    const g = bg.getContext('2d');
    g.scale(bgScale, bgScale);
    let seed = 11 + stageNo * 7;
    // 地面の色：[r, g, b]・草の濃い色と薄い色・花を咲かせるか
    const G = {
      grass: { rgb: [74, 116, 54], dark: 'rgba(40,80,30,0.5)', light: 'rgba(150,190,100,0.45)', flowers: true },
      sand: { rgb: [186, 156, 96], dark: 'rgba(120,90,50,0.45)', light: 'rgba(230,205,150,0.5)', flowers: false },
      snow: { rgb: [196, 206, 214], dark: 'rgba(130,150,170,0.45)', light: 'rgba(255,255,255,0.7)', flowers: false },
    }[STAGES[stageNo].ground || 'grass'];
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // 草地。マスごとに少し色を変え、建てられる場所がわかるようにうっすら枠を付ける
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = ((c + r) % 2 ? 0 : 6) + rnd() * 6;
      g.fillStyle = `rgb(${G.rgb[0] + v},${G.rgb[1] + v},${G.rgb[2] + v * 0.5})`;
      g.fillRect(c * TILE, r * TILE, TILE, TILE);
    }
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, y = rnd() * H;
      g.strokeStyle = rnd() < 0.5 ? G.dark : G.light;
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 5); g.moveTo(x + 2, y); g.lineTo(x + 3, y - 4); g.stroke();
    }
    for (let i = 0; i < (G.flowers ? 18 : 0); i++) {
      g.fillStyle = ['#f0e070', '#ffffff', '#f0a0c0'][i % 3];
      g.beginPath(); g.arc(rnd() * W, rnd() * H, 1.6, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
    for (let c = 1; c < COLS; c++) { g.beginPath(); g.moveTo(c * TILE, 0); g.lineTo(c * TILE, H); g.stroke(); }
    for (let r = 1; r < ROWS; r++) { g.beginPath(); g.moveTo(0, r * TILE); g.lineTo(W, r * TILE); g.stroke(); }
    // 池
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== WATER) continue;
      const x = c * TILE, y = r * TILE;
      // 水を塗ってから、となりが池でない辺にだけ砂の縁を付ける
      g.fillStyle = '#3a78b8'; g.fillRect(x, y, TILE, TILE);
      const n = (dc, dr) => inMap(c + dc, r + dr) && grid[r + dr][c + dc] === WATER;
      g.fillStyle = '#c8b070';
      if (!n(1, 0)) g.fillRect(x + TILE - 3, y, 3, TILE);
      if (!n(-1, 0)) g.fillRect(x, y, 3, TILE);
      if (!n(0, 1)) g.fillRect(x, y + TILE - 3, TILE, 3);
      if (!n(0, -1)) g.fillRect(x, y, TILE, 3);
      g.strokeStyle = 'rgba(200,230,255,0.6)'; g.lineWidth = 1.5;
      for (let k = 0; k < 2; k++) {
        const wx = x + 8 + rnd() * 18, wy = y + 10 + k * 14;
        g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + 4, wy - 3, wx + 8, wy); g.stroke();
      }
    }
    // 道（角が丸い太い線で描き、その上に履帯の跡を付ける）
    const strokePaths = (w, color) => {
      g.lineWidth = w; g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'square';
      for (const p of paths) {
        g.beginPath();
        p.pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y));
        g.stroke();
      }
    };
    strokePaths(TILE * 0.98, '#7a5a34');
    strokePaths(TILE * 0.84, '#b08a58');
    strokePaths(TILE * 0.5, '#bc9664');
    g.setLineDash([3, 4]);
    for (const off of [-8, 8]) {
      g.strokeStyle = 'rgba(90,60,30,0.35)'; g.lineWidth = 3;
      for (const p of paths) {
        g.beginPath();
        p.pts.forEach((q, i) => {
          // 道の向きに直角な方向へずらして、左右の履帯の跡にする（角では前後の道の両方の向きにずらす）
          const a = p.segs[i - 1], b = p.segs[i];
          let x = q.x, y = q.y;
          for (const s of [a, b]) if (s) { x -= s.dy * off; y += s.dx * off; }
          if (a && b && a.dx * b.dx + a.dy * b.dy > 0.5) { x = (x + q.x) / 2; y = (y + q.y) / 2; }
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke();
      }
    }
    g.setLineDash([]);
    for (let i = 0; i < 70; i++) {
      const c = Math.floor(rnd() * COLS), r = Math.floor(rnd() * ROWS);
      if (grid[r][c] !== ROAD) continue;
      g.fillStyle = rnd() < 0.5 ? 'rgba(90,60,30,0.4)' : 'rgba(220,190,140,0.5)';
      g.fillRect(c * TILE + 6 + rnd() * 26, r * TILE + 6 + rnd() * 26, 2.5, 2.5);
    }
    // 岩
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== ROCK) continue;
      const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(x + 3, y + 5, 15, 10, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8a8a86';
      g.beginPath();
      g.moveTo(x - 15, y + 6); g.lineTo(x - 11, y - 8); g.lineTo(x - 2, y - 13); g.lineTo(x + 10, y - 9);
      g.lineTo(x + 15, y + 2); g.lineTo(x + 9, y + 10); g.lineTo(x - 8, y + 11); g.closePath(); g.fill();
      g.fillStyle = '#b0b0aa';
      g.beginPath(); g.moveTo(x - 10, y - 6); g.lineTo(x - 2, y - 11); g.lineTo(x + 6, y - 8); g.lineTo(x - 3, y - 3); g.closePath(); g.fill();
      g.fillStyle = '#6a6a66';
      g.beginPath(); g.moveTo(x + 15, y + 2); g.lineTo(x + 9, y + 10); g.lineTo(x - 8, y + 11); g.lineTo(x + 4, y + 4); g.closePath(); g.fill();
    }
    // 戦車が入ってくる入口の矢印
    for (const p of paths) {
      const s = p.segs[0];
      const x = p.pts[0].x + s.dx * TILE * 1.05, y = p.pts[0].y + s.dy * TILE * 1.05;
      g.save(); g.translate(x, y); g.rotate(Math.atan2(s.dy, s.dx));
      g.fillStyle = 'rgba(200,40,30,0.75)';
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-4, -10); g.lineTo(-4, -4); g.lineTo(-12, -4); g.lineTo(-12, 4); g.lineTo(-4, 4); g.lineTo(-4, 10); g.closePath(); g.fill();
      g.restore();
    }
  }

  // ---------- ゲームの進行 ----------
  function startStage(n) {
    stageNo = n;
    const S = STAGES[n];
    money = S.money; lives = S.lives; wave = 0; inWave = false; spawnQ = []; spawnT = 0;
    turrets = []; enemies = []; shells = []; missiles = [];
    tracers = []; rings = []; particles = []; decals = []; texts = [];
    fires = []; mines = []; strikes = []; rushT = 0; skillMode = null; pendingBr = null;
    skillCd = { air: 0, mine: 0, rush: 0 };
    sel = null; placeType = null; hover = null; shake = 0;
    buildMap();
    state = 'play';
    hideOverlay();
    renderTray();
    showToast('空き地をタップして砲台を建てよう', 3.5);
  }

  // 次のウェーブを呼ぶ。前のウェーブの戦車が出そろっていれば、倒し切る前でも呼べる（早いほどボーナス）
  const canCallNext = () => state === 'play' && wave < STAGES[stageNo].waves && (!inWave || !spawnQ.length);
  function startWave() {
    if (!canCallNext()) return;
    if (inWave) {
      const left = enemies.filter(e => e.hp > 0).length;
      const eb = earlyBonus(wave, left);
      const msg = payWaveBonus();
      money += eb;
      addText(base.x, base.y - 20, `早期 +${eb}`, '#ffd84a');
      showToast(`次を呼んだ！ 早期ボーナス +${eb}（${msg}）`, 2.4);
    }
    wave++;
    inWave = true;
    const n = paths.length;
    spawnQ = makeWave(wave, STAGES[stageNo].waves).map((u, i) => ({ ...u, path: i % n }));
    spawnT = 0.3;
    sfx.wave();
    const last = wave === STAGES[stageNo].waves;
    if (!toast || toast.t < 1.5) showToast(last ? `最終ウェーブ！${spawnQ.some(u => u.type === 'boss') ? ' 超重戦車が来る！' : ''}` : `ウェーブ ${wave}`, 2);
  }
  // ウェーブを守り切ったボーナスと利息を払う。トースト用の文を返す
  function payWaveBonus() {
    const b = waveBonus(wave);
    const it = Math.min(INTEREST_MAX, Math.floor(money * INTEREST));
    money += b + it;
    sfx.bonus();
    return `ボーナス +${b}・利息 +${it}`;
  }

  function spawnEnemy(u) {
    const T = TANKS[u.type];
    const p = paths[u.path];
    const hp = Math.round(T.hp * hpScale(wave));
    const e = {
      T, type: u.type, path: p, d: 0, hp, maxHp: hp,
      reward: Math.round(T.reward * rewardScale(wave)),
      x: 0, y: 0, a: 0, slow: 0, slowT: 0, stunT: 0, weak: 0, weakT: 0, hit: 0, wob: rand(0, 6),
      off: u.type === 'boss' ? 0 : rand(-5, 5), // 道の真ん中から少し左右にずらして、重なって見えないように
    };
    const q = pathPos(p, 0);
    e.x = q.x; e.y = q.y; e.a = q.a;
    enemies.push(e);
  }

  function build(type, c, r) {
    const D = TURRETS[type];
    if (!buildable(c, r)) return false;
    if (money < D.cost[0]) { showToast('資金が足りません'); sfx.no(); return false; }
    money -= D.cost[0];
    const t = { type, c, r, x: (c + 0.5) * TILE, y: (r + 0.5) * TILE, lv: 0, br: null, aim: 0, cd: 0, scd: 0, a: -Math.PI / 2, flash: 0, spent: D.cost[0], pop: 0.25 };
    // 最初は一番近い道のほうを向けておく
    let best = Infinity;
    for (const p of paths) for (const q of p.pts) {
      const d = dist(q.x, q.y, t.x, t.y);
      if (d < best) { best = d; t.a = Math.atan2(q.y - t.y, q.x - t.x); }
    }
    turrets.push(t);
    sfx.build();
    puff(t.x, t.y, '#d8d0b0', 10);
    return true;
  }
  // 強化。Lv2 → Lv3 は型（br：'a' か 'b'）を選ぶ
  function upgrade(t, br) {
    if (t.lv >= 2) return;
    if (t.lv === 1 && !br) { showToast('Lv3 は 2 つの型から選ぶ（A / B）'); return; }
    const cost = upCost(t, br);
    if (money < cost) { showToast('資金が足りません'); sfx.no(); return; }
    money -= cost; t.spent += cost; t.lv++; t.pop = 0.25;
    if (t.lv === 2) { t.br = br; showToast(`${TURRETS[t.type].br[br].name}型になった！`, 2); }
    pendingBr = null;
    sfx.upgrade();
    rings.push({ x: t.x, y: t.y, r: 6, max: 26, t: 0, life: 0.4, color: '#ffd84a' });
    renderTray();
  }
  // 型のボタン：1 回目は説明を出し、同じボタンをもう一度押すと決まる
  function chooseBranch(t, br) {
    if (t.lv !== 1) return;
    if (pendingBr && pendingBr.t === t && pendingBr.br === br) { upgrade(t, br); return; }
    pendingBr = { t, br };
    const B = TURRETS[t.type].br[br];
    showToast(`${B.name}：${B.desc}（もう一度押すと決定）`, 3.5);
    renderTray();
  }
  function cycleAim(t) {
    if (t.type === 'emp') return;
    t.aim = (t.aim + 1) % AIMS.length;
    showToast(`ねらい：${AIMS[t.aim][1]}`, 1.2);
    renderTray();
  }
  function sell(t) {
    const back = Math.floor(t.spent * SELL_RATE);
    money += back;
    turrets = turrets.filter(o => o !== t);
    sfx.sell();
    addText(t.x, t.y, `+${back}`, '#ffd84a');
    puff(t.x, t.y, '#d8d0b0', 10);
    sel = null;
    renderTray();
  }

  // 射程に入っている戦車を、ねらい方の順に並べる（minR より近い戦車は除く）
  const effSpeed = e => e.stunT > 0 ? 0 : e.T.speed * (1 - e.slow);
  const AIM_KEY = {
    first: e => e.path.len - e.d,       // 基地までの残りが短い順
    last: e => -(e.path.len - e.d),
    strong: e => -e.hp,
    fast: e => -effSpeed(e),
  };
  function targets(x, y, range, aim = 'first', minR = 0) {
    const list = [];
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const d = dist(e.x, e.y, x, y);
      if (d > range + e.T.r * 0.5 || d < minR) continue;
      list.push(e);
    }
    const key = AIM_KEY[aim];
    return list.sort((a, b) => key(a) - key(b));
  }
  const pickTarget = (x, y, range, aim, minR) => targets(x, y, range, aim, minR)[0] || null;

  // 戦車にダメージ。pierce は装甲を無視、ap は装甲を無視する割合、quiet は白く光らせない（燃えているとき）
  function hurt(e, dmg, pierce, ap = 0, quiet = false) {
    if (e.hp <= 0) return;
    const armor = Math.max(0, e.T.armor - (e.weakT > 0 ? e.weak : 0)) * (1 - ap);
    e.hp -= pierce ? dmg : Math.max(dmg * 0.25, dmg - armor);
    if (!quiet) e.hit = 0.08;
    if (e.hp <= 0) {
      money += e.reward;
      addText(e.x, e.y - 6, `+${e.reward}`, '#ffd84a');
      explode(e.x, e.y, e.T.r);
      if (e.type === 'boss') { sfx.bigBoom(); shake = Math.max(shake, 0.4); } else sfx.boom();
    }
  }
  // 範囲攻撃（大砲・空爆・地雷）。cannon なら、電磁波で遅くなった戦車に 1.3 倍
  function blast(x, y, R, dmg, cannon) {
    for (const e of enemies) {
      if (e.hp <= 0 || dist(e.x, e.y, x, y) > R + e.T.r * 0.5) continue;
      const combo = cannon && (e.slowT > 0 || e.stunT > 0);
      hurt(e, combo ? dmg * 1.3 : dmg);
    }
  }

  // ---------- 支援 ----------
  function chooseSkill(k) {
    if (state !== 'play') return;
    if (skillCd[k] > 0) { showToast(`${SKILLS[k].name}：あと ${Math.ceil(skillCd[k])} 秒（ウェーブ中に減る）`); sfx.no(); return; }
    placeType = null;
    if (sel) { sel = null; renderTray(); }
    if (k === 'rush') {
      skillCd.rush = SKILLS.rush.cd;
      rushT = RUSH_TIME;
      sfx.upgrade();
      for (const t of turrets) rings.push({ x: t.x, y: t.y, r: 4, max: 24, t: 0, life: 0.5, color: '#ffd84a' });
      showToast('一斉射撃！ 8 秒間、連射が倍に', 2);
      skillMode = null;
      return;
    }
    skillMode = skillMode === k ? null : k;
    if (skillMode) showToast(k === 'air' ? '空爆する場所をタップ' : '地雷を置く道をタップ', 2.5);
    refreshTray();
  }
  function useSkillAt(x, y) {
    const k = skillMode;
    if (k === 'air') {
      strikes.push({ x, y, t: 0, dmg: airDmg(wave) });
      tone(1200, 0.5, 'sine', 0.05, 600);
    } else if (k === 'mine') {
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      if (!inMap(c, r) || grid[r][c] !== ROAD) { showToast('地雷は道の上に置こう'); sfx.no(); return; }
      const mx = (c + 0.5) * TILE, my = (r + 0.5) * TILE;
      if (mines.some(m => m.x === mx && m.y === my)) { showToast('ここにはもう置いてある'); sfx.no(); return; }
      mines.push({ x: mx, y: my, dmg: mineDmg(wave), t: 0 });
      tone(500, 0.08, 'square', 0.06);
    }
    skillCd[k] = SKILLS[k].cd;
    skillMode = null;
    toast = null;
  }

  function step(dt) {
    clock += dt;
    // 出撃
    if (spawnQ.length) {
      spawnT -= dt;
      while (spawnT <= 0 && spawnQ.length) {
        const u = spawnQ.shift();
        spawnEnemy(u);
        spawnT += u.gap;
      }
    }
    // 支援の待ち時間はウェーブ中だけ減る（ウェーブの合間に待って貯めることはできない）
    if (inWave) for (const k of SKILL_ORDER) skillCd[k] = Math.max(0, skillCd[k] - dt);
    rushT = Math.max(0, rushT - dt);
    // 戦車
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
      if (e.weakT > 0) { e.weakT -= dt; if (e.weakT <= 0) e.weak = 0; }
      e.hit = Math.max(0, e.hit - dt);
      if (e.stunT > 0) { e.stunT -= dt; continue; } // 止まっている
      e.d += e.T.speed * TILE * (1 - e.slow) * dt;
      const q = pathPos(e.path, e.d);
      e.a += angleDiff(q.a, e.a) * Math.min(1, dt * 7);
      e.x = q.x - Math.sin(q.a) * e.off;
      e.y = q.y + Math.cos(q.a) * e.off;
      if (e.d >= e.path.len) {
        e.hp = 0; e.reached = true;
        if (state === 'play') {
          lives = Math.max(0, lives - e.T.dmg);
          sfx.hit();
          shake = Math.max(shake, 0.3);
          explode(base.x, base.y, 12);
          addText(base.x, base.y - 14, `-${e.T.dmg}`, '#ff6a5a');
          if (lives <= 0) lose();
        }
      }
    }
    // 砲台
    for (const t of turrets) updateTurret(t, dt);
    // 砲弾
    for (const s of shells) {
      s.t += dt;
      if (s.t >= s.dur) {
        s.done = true;
        const R = s.splash * TILE;
        blast(s.tx, s.ty, R, s.dmg, true);
        explode(s.tx, s.ty, 10, true);
        rings.push({ x: s.tx, y: s.ty, r: 4, max: R, t: 0, life: 0.25, color: 'rgba(255,200,120,0.8)' });
        if (s.fire) fires.push({ x: s.tx, y: s.ty, r: R * 0.85, t: 0, life: 3, dps: s.fire });
      }
    }
    shells = shells.filter(s => !s.done);
    // 燃えている所（装甲を無視して少しずつ焼く）
    for (const f of fires) {
      f.t += dt;
      for (const e of enemies) if (e.hp > 0 && dist(e.x, e.y, f.x, f.y) <= f.r + e.T.r * 0.4) hurt(e, f.dps * dt, true, 0, true);
      if (Math.random() < dt * 14) particles.push({ x: f.x + rand(-f.r, f.r) * 0.7, y: f.y + rand(-f.r, f.r) * 0.7, vx: rand(-5, 5), vy: rand(-25, -10), t: 0, life: 0.5, size: 2.5, grow: 3, color: ['255,170,50', '255,90,30'][Math.random() < 0.5 ? 0 : 1], alpha: 0.8 });
    }
    fires = fires.filter(f => f.t < f.life);
    // ミサイル（ねらった戦車がいなくなったら別の戦車を探す）
    for (const m of missiles) {
      if (!m.target || m.target.hp <= 0) m.target = pickTarget(m.x, m.y, 6 * TILE);
      if (m.target) {
        const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        m.a += clamp(angleDiff(want, m.a), -6 * dt, 6 * dt);
      }
      m.v = Math.min(9 * TILE, m.v + 12 * TILE * dt);
      m.x += Math.cos(m.a) * m.v * dt;
      m.y += Math.sin(m.a) * m.v * dt;
      m.life -= dt;
      m.smoke -= dt;
      if (m.smoke <= 0) {
        m.smoke = 0.025;
        particles.push({ x: m.x - Math.cos(m.a) * 6, y: m.y - Math.sin(m.a) * 6, vx: rand(-8, 8), vy: rand(-8, 8), t: 0, life: 0.5, size: 3, grow: 7, color: '200,200,200', alpha: 0.5 });
      }
      if (m.target && dist(m.x, m.y, m.target.x, m.target.y) < m.target.T.r + 4) {
        m.done = true;
        // 対装甲型は、体力の多い戦車ほど大きなダメージ（体力 800 ごとに +1 倍、最大 2.5 倍）
        const k = m.heavy ? 1 + Math.min(1.5, m.target.maxHp / 800) : 1;
        hurt(m.target, m.dmg * k);
        explode(m.x, m.y, m.heavy ? 12 : 9, true);
      } else if (m.life <= 0 || m.x < -60 || m.x > W + 60 || m.y < -60 || m.y > H + 60) {
        m.done = true;
        explode(m.x, m.y, 6, true);
      }
    }
    missiles = missiles.filter(m => !m.done);
    // 空爆（飛行機が飛んできて、0.8 秒後に爆弾が落ちる）
    for (const s of strikes) {
      const was = s.t;
      s.t += dt;
      if (was < 0.8 && s.t >= 0.8) {
        blast(s.x, s.y, 1.5 * TILE, s.dmg, false);
        for (let i = 0; i < 4; i++) explode(s.x + rand(-18, 18), s.y + rand(-18, 18), 12);
        rings.push({ x: s.x, y: s.y, r: 6, max: 1.5 * TILE, t: 0, life: 0.35, color: 'rgba(255,180,90,0.9)' });
        sfx.bigBoom();
        shake = Math.max(shake, 0.3);
      }
    }
    strikes = strikes.filter(s => s.t < 1.6);
    // 地雷（戦車が近づくと爆発）
    for (const m of mines) {
      m.t += dt;
      if (enemies.some(e => e.hp > 0 && dist(e.x, e.y, m.x, m.y) < 0.45 * TILE + e.T.r * 0.5)) {
        m.done = true;
        blast(m.x, m.y, 1.1 * TILE, m.dmg, false);
        explode(m.x, m.y, 14);
        rings.push({ x: m.x, y: m.y, r: 4, max: 1.1 * TILE, t: 0, life: 0.3, color: 'rgba(255,200,120,0.9)' });
        sfx.boom();
      }
    }
    mines = mines.filter(m => !m.done);
    enemies = enemies.filter(e => e.hp > 0);
    // 効果
    for (const p of particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * 2.5; p.vy *= 1 - dt * 2.5;
    }
    particles = particles.filter(p => p.t < p.life);
    for (const o of tracers) o.t += dt;
    tracers = tracers.filter(o => o.t < 0.06);
    for (const o of rings) o.t += dt;
    rings = rings.filter(o => o.t < o.life);
    for (const o of decals) o.t += dt;
    decals = decals.filter(o => o.t < 8);
    for (const o of texts) { o.t += dt; o.y -= 22 * dt; }
    texts = texts.filter(o => o.t < 0.9);
    for (const t of turrets) t.pop = Math.max(0, t.pop - dt);

    // ウェーブを守り切った
    if (state === 'play' && inWave && !spawnQ.length && !enemies.length) {
      inWave = false;
      const S = STAGES[stageNo];
      if (wave >= S.waves) { win(); return; }
      const msg = payWaveBonus();
      showToast(`ウェーブ ${wave} 突破！ ${msg}`, 2.4);
    }
  }

  function updateTurret(t, dt) {
    t.cd -= dt;
    t.flash = Math.max(0, t.flash - dt);
    const range = stat(t, 'range') * TILE;
    const rate = stat(t, 'rate') * (rushT > 0 ? 0.5 : 1);
    if (t.type === 'emp') {
      // 電磁波は向きがなく、射程に戦車がいれば周り全部にまとめて効く
      const stun = stat(t, 'stun');
      if (stun) t.scd -= dt;
      if (t.cd > 0 && !(stun && t.scd <= 0)) return;
      const hits = enemies.filter(e => e.hp > 0 && dist(e.x, e.y, t.x, t.y) <= range + e.T.r * 0.5);
      if (!hits.length) return;
      if (stun && t.scd <= 0) {
        // 衝撃波：まわりの戦車を止める（超重戦車は短く）
        t.scd = stat(t, 'stunEvery');
        rings.push({ x: t.x, y: t.y, r: 8, max: range, t: 0, life: 0.5, color: 'rgba(255,240,120,0.95)' });
        tone(180, 0.35, 'square', 0.07, 60);
        for (const e of hits) e.stunT = Math.max(e.stunT, e.type === 'boss' ? stun / 3 : stun);
        if (t.cd > 0) return;
      }
      t.cd = rate;
      t.flash = 0.25;
      const weak = stat(t, 'weak');
      rings.push({ x: t.x, y: t.y, r: 8, max: range, t: 0, life: 0.45, color: weak ? 'rgba(200,130,255,0.9)' : 'rgba(120,220,255,0.9)', fill: true });
      sfx.emp();
      const slow = stat(t, 'slow');
      for (const e of hits) {
        e.slow = Math.max(e.slowT > 0 ? e.slow : 0, slow);
        e.slowT = 1.6;
        if (weak) { e.weak = Math.max(e.weakT > 0 ? e.weak : 0, weak); e.weakT = 1.6; }
        hurt(e, stat(t, 'dmg'), true);
      }
      return;
    }
    const aim = AIMS[t.aim][0];
    const minR = (stat(t, 'minRange') || 0) * TILE;
    const target = pickTarget(t.x, t.y, range, aim, minR);
    if (!target) return;
    const want = Math.atan2(target.y - t.y, target.x - t.x);
    t.a += angleDiff(want, t.a) * Math.min(1, dt * 14);
    if (t.cd > 0 || Math.abs(angleDiff(want, t.a)) > 0.3) return;
    t.cd = rate;
    t.flash = 0.07;
    const dmg = stat(t, 'dmg');
    const mx = t.x + Math.cos(t.a) * 17, my = t.y + Math.sin(t.a) * 17;
    if (t.type === 'mg') {
      hurt(target, dmg, false, stat(t, 'ap') || 0);
      tracers.push({ x1: mx, y1: my, x2: target.x + rand(-3, 3), y2: target.y + rand(-3, 3), t: 0 });
      sparks(target.x, target.y, 2, t.br === 'a' ? '255,140,90' : '255,230,150');
      sfx.mg();
    } else if (t.type === 'cannon') {
      // 砲弾が飛んでいる間に戦車が進む分を見込んで撃つ
      const v = (t.br === 'b' ? 9 : 7) * TILE;
      let dur = dist(mx, my, target.x, target.y) / v;
      const q = pathPos(target.path, target.d + effSpeed(target) * TILE * dur);
      dur = dist(mx, my, q.x, q.y) / v;
      shells.push({ x0: mx, y0: my, tx: q.x, ty: q.y, t: 0, dur, dmg, splash: stat(t, 'splash'), fire: stat(t, 'fire') || 0 });
      puff(mx, my, '220,220,220', 4, true);
      sfx.cannon();
    } else if (t.type === 'missile') {
      const n = stat(t, 'count') || 1;
      const list = n > 1 ? targets(t.x, t.y, range, aim) : [target];
      for (let i = 0; i < n; i++) {
        const a = t.a + (i - (n - 1) / 2) * 0.5;
        missiles.push({ x: mx, y: my, a, v: 2 * TILE, target: list[i % list.length], dmg, heavy: !!stat(t, 'heavy'), life: 4, smoke: 0 });
      }
      sfx.missile();
    }
  }

  function lose() {
    state = 'ending';
    endT = 1.6;
    sel = null; placeType = null;
    renderTray();
    sfx.bigBoom();
    shake = 0.8;
    for (let i = 0; i < 4; i++) explode(base.x + rand(-12, 12), base.y + rand(-12, 12), 16);
  }
  function win() {
    state = 'ending';
    endT = 1.2;
    sel = null; placeType = null;
    renderTray();
    const S = STAGES[stageNo];
    const st = lives >= S.lives ? 3 : lives >= S.lives / 2 ? 2 : 1;
    lastStars = st;
    if (st > stars[stageNo]) { stars[stageNo] = st; save('tankdef.stars', JSON.stringify(stars)); }
    if (stageNo + 1 < STAGES.length && unlocked < stageNo + 1) { unlocked = stageNo + 1; save('tankdef.stage', unlocked); }
    sfx.clear();
  }
  let lastStars = 0;

  // ---------- 効果 ----------
  function explode(x, y, size, small) {
    const n = small ? 8 : 14 + size;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(20, 70) * (size / 10);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.25, 0.5), size: rand(2, 4) * size / 10, grow: 2, color: ['255,220,90', '255,150,40', '240,80,30'][i % 3], alpha: 1 });
    }
    puff(x, y, '90,90,90', small ? 3 : 8, small);
    if (!small) decals.push({ x, y, r: size * 1.1, t: 0 });
  }
  function puff(x, y, color, n, small) {
    if (color[0] === '#') color = '216,208,176';
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(8, small ? 20 : 35);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.5, 0.9), size: rand(3, 5), grow: 10, color, alpha: 0.55 });
    }
  }
  function sparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(30, 80);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.15, size: 1.5, grow: 0, color, alpha: 1 });
    }
  }
  function addText(x, y, text, color) { texts.push({ x, y, text, color, t: 0 }); }
  function showToast(text, t = 1.8) { toast = { text, t }; }

  // ---------- 描画 ----------
  function draw() {
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16200f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!bg) return;
    worldTf();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.drawImage(bg, 0, 0, W, H);
    for (const o of decals) {
      ctx.fillStyle = `rgba(30,20,10,${0.35 * (1 - o.t / 8)})`;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
    }
    for (const f of fires) {
      const k = 1 - f.t / f.life;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(255,190,60,${0.55 * k})`);
      g.addColorStop(0.6, `rgba(240,90,30,${0.4 * k})`);
      g.addColorStop(1, 'rgba(160,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.92 + 0.08 * Math.sin(clock * 18 + f.x)), 0, Math.PI * 2); ctx.fill();
    }
    for (const m of mines) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(m.x + 1, m.y + 2, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a4a3a';
      ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6a6a58';
      ctx.beginPath(); ctx.arc(m.x, m.y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = Math.sin(m.t * 6) > 0 ? '#ff4a3a' : '#7a2a20';
      ctx.beginPath(); ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    drawSelection();
    for (const e of enemies) drawTank(e);
    for (const t of turrets) {
      ctx.save(); ctx.translate(t.x, t.y);
      if (rushT > 0) {
        ctx.fillStyle = `rgba(255,220,80,${0.18 + 0.12 * Math.sin(clock * 14)})`;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
      }
      const k = 1 + t.pop * 0.6;
      ctx.scale(k, k);
      drawTurret(ctx, t.type, t.lv, t.a, t.flash, clock, t.br);
      ctx.restore();
    }
    drawGhost();
    drawStrikes();
    for (const o of tracers) {
      ctx.strokeStyle = `rgba(255,240,160,${1 - o.t / 0.06})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
    }
    for (const s of shells) {
      const k = s.t / s.dur;
      const x = s.x0 + (s.tx - s.x0) * k, y = s.y0 + (s.ty - s.y0) * k;
      const h = Math.sin(k * Math.PI) * Math.min(26, s.dur * 60); // 山なりに飛ぶ高さ（影との差で見せる）
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(x - h * 0.4, y - h * 0.6, 3.6 + h * 0.05, 0, Math.PI * 2); ctx.fill();
    }
    for (const m of missiles) {
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
      ctx.fillStyle = '#ffd060';
      ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-11 - Math.random() * 4, 0); ctx.lineTo(-6, 2); ctx.fill();
      ctx.fillStyle = '#eee'; ctx.fillRect(-6, -2, 10, 4);
      ctx.fillStyle = '#d03a2a'; ctx.beginPath(); ctx.moveTo(4, -2); ctx.lineTo(8, 0); ctx.lineTo(4, 2); ctx.fill();
      ctx.restore();
    }
    for (const o of rings) {
      const k = o.t / o.life, r = o.r + (o.max - o.r) * k;
      ctx.globalAlpha = 1 - k;
      if (o.fill) { ctx.fillStyle = 'rgba(120,220,255,0.15)'; ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = o.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const p of particles) {
      const k = p.t / p.life;
      ctx.fillStyle = `rgba(${p.color},${p.alpha * (1 - k)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size + p.grow * k, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    drawBase();
    // 体力ゲージと文字は画面の向きのまま描く
    for (const e of enemies) {
      if (e.hp >= e.maxHp && e.slowT <= 0) continue;
      uprightAt(e.x, e.y);
      const w = e.T.r * 2, y = -e.T.r - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-w / 2 - 1, y - 1, w + 2, 5);
      const k = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = k > 0.5 ? '#6ae05a' : k > 0.25 ? '#ffd84a' : '#ff5a4a';
      ctx.fillRect(-w / 2, y, w * k, 3);
      if (e.slowT > 0) { ctx.fillStyle = '#6ad0ff'; ctx.fillRect(-w / 2, y + 3, w, 1); }
    }
    ctx.font = '11px DotGothic16, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const o of texts) {
      uprightAt(o.x, o.y);
      ctx.globalAlpha = 1 - Math.max(0, o.t - 0.5) / 0.4;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(o.text, 0, 0);
      ctx.fillStyle = o.color; ctx.fillText(o.text, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (toast) {
      // 画面の幅に入りきらない文は、何行かに分けて出す
      ctx.font = '16px DotGothic16, monospace';
      const maxW = cw - 40, lines = [];
      let line = '';
      for (const ch of toast.text) {
        if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ''; }
        line += ch;
      }
      lines.push(line);
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 26;
      ctx.globalAlpha = Math.min(1, toast.t * 3);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cw / 2 - w / 2, 10, w, 12 + lines.length * 20);
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, cw / 2, 27 + i * 20));
      ctx.globalAlpha = 1;
    }
    if (state === 'ending') {
      ctx.font = '38px DotGothic16, monospace';
      const won = lives > 0;
      const text = won ? 'STAGE CLEAR!' : '基地陥落…';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(text, cw / 2, ch / 2);
      ctx.fillStyle = won ? '#ffd84a' : '#ff6a5a'; ctx.fillText(text, cw / 2, ch / 2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawSelection() {
    let range = 0, x = 0, y = 0;
    if (sel && sel.turret) {
      const t = sel.turret;
      x = t.x; y = t.y; range = stat(t, 'range') * TILE;
      const minR = stat(t, 'minRange');
      if (minR) {
        ctx.fillStyle = 'rgba(255,60,40,0.15)';
        ctx.beginPath(); ctx.arc(x, y, minR * TILE, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2;
      ctx.strokeRect(t.c * TILE + 1, t.r * TILE + 1, TILE - 2, TILE - 2);
    } else if (sel) {
      const a = 0.5 + 0.4 * Math.sin(clock * 6);
      ctx.strokeStyle = `rgba(255,216,74,${a})`; ctx.lineWidth = 2.5;
      ctx.strokeRect(sel.c * TILE + 2, sel.r * TILE + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(sel.c * TILE + 2, sel.r * TILE + 2, TILE - 4, TILE - 4);
    }
    if (range) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  // マウスで指しているマスに、建てる予定の砲台を半透明で描く
  function drawGhost() {
    if (skillMode && hover && state === 'play') {
      const p = hover.p;
      if (skillMode === 'air') {
        ctx.strokeStyle = 'rgba(255,90,60,0.85)'; ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(255,90,60,0.12)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 * TILE, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (skillMode === 'mine' && inMap(hover.c, hover.r)) {
        const ok = grid[hover.r][hover.c] === ROAD;
        ctx.fillStyle = ok ? 'rgba(255,255,255,0.18)' : 'rgba(255,60,40,0.25)';
        ctx.fillRect(hover.c * TILE, hover.r * TILE, TILE, TILE);
        if (ok) {
          ctx.strokeStyle = 'rgba(255,200,120,0.6)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc((hover.c + 0.5) * TILE, (hover.r + 0.5) * TILE, 1.1 * TILE, 0, Math.PI * 2); ctx.stroke();
        }
      }
      return;
    }
    if (!placeType || !hover || state !== 'play') return;
    const { c, r } = hover;
    if (!inMap(c, r)) return;
    const ok = buildable(c, r);
    const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
    ctx.fillStyle = ok ? 'rgba(255,255,255,0.12)' : 'rgba(255,60,40,0.25)';
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
    if (!ok) return;
    const range = TURRETS[placeType].range[0] * TILE;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, range, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.save(); ctx.translate(x, y); drawTurret(ctx, placeType, 0, -Math.PI / 2, 0, clock); ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 空爆：ねらった場所の印と、横切る飛行機（影と機体）
  function drawStrikes() {
    for (const s of strikes) {
      if (s.t < 0.8) {
        const k = s.t / 0.8;
        ctx.strokeStyle = `rgba(255,70,50,${0.5 + 0.5 * Math.sin(clock * 20)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.5 * TILE * (1.2 - k * 0.2), 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y); ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8); ctx.stroke();
      }
      const px = s.x + (s.t - 0.8) * 520, py = s.y;
      for (const [ox, oy, col] of [[10, 22, 'rgba(0,0,0,0.3)'], [0, 0, '#5a6a7a']]) {
        ctx.save(); ctx.translate(px + ox, py + oy);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(16, 0); ctx.lineTo(4, -3); ctx.lineTo(-2, -16); ctx.lineTo(-7, -16); ctx.lineTo(-4, -3);
        ctx.lineTo(-13, -3); ctx.lineTo(-17, -8); ctx.lineTo(-19, -8); ctx.lineTo(-17, 0);
        ctx.lineTo(-19, 8); ctx.lineTo(-17, 8); ctx.lineTo(-13, 3); ctx.lineTo(-4, 3); ctx.lineTo(-7, 16);
        ctx.lineTo(-2, 16); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  // 砲台の絵（原点が砲台の真ん中）。下の一覧のアイコンにも使う。br は Lv3 の型
  function drawTurret(g, type, lv, a, flash, time, br) {
    const D = TURRETS[type];
    // 台座
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-14, -12, 30, 30);
    g.fillStyle = '#5a5e58'; g.fillRect(-15, -15, 30, 30);
    g.fillStyle = '#7a7e76'; g.fillRect(-13, -13, 26, 26);
    g.fillStyle = '#4a4e48';
    for (const [bx, by] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) g.fillRect(bx - 1.5, by - 1.5, 3, 3);
    // レベルの印
    g.fillStyle = '#ffd84a';
    for (let i = 0; i < lv; i++) g.fillRect(-12 + i * 6, 10, 4, 3);
    if (br) { g.fillStyle = br === 'a' ? '#ff8a4a' : '#c08aff'; g.fillRect(6, 9, 7, 5); }
    if (type === 'emp') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      g.fillStyle = '#2a4a6a';
      g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill();
      g.strokeStyle = br === 'a' ? '#ffe070' : br === 'b' ? '#c08aff' : D.color; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 7.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = flash > 0 ? '#ffffff' : br === 'b' ? `rgba(210,160,255,${0.6 + 0.4 * pulse})` : `rgba(150,230,255,${0.6 + 0.4 * pulse})`;
      g.beginPath(); g.arc(0, 0, 4 + pulse * 1.2 + lv * 0.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(150,230,255,0.7)'; g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const q = i * Math.PI / 2 + time * 1.5;
        g.beginPath(); g.arc(0, 0, 12.5, q, q + 0.6); g.stroke();
      }
      return;
    }
    g.save(); g.rotate(a);
    if (type === 'mg') {
      g.fillStyle = '#2a3a28';
      const len = 15 + lv * 2;
      g.fillRect(2, -4.5, len, 2.6); g.fillRect(2, 1.9, len, 2.6);
      if (br === 'b') { g.fillRect(2, -7.5, len - 2, 2.4); g.fillRect(2, 5.1, len - 2, 2.4); }
      if (lv >= 2) { if (br === 'a') g.fillStyle = '#8a4a2a'; g.fillRect(2, -1.3, len + 2, 2.6); }
      if (flash > 0) { g.fillStyle = '#ffe080'; g.beginPath(); g.arc(len + 4, 0, 4.5, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = D.color; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a8a3a'; g.beginPath(); g.arc(-1.5, 0, 4, 0, Math.PI * 2); g.fill();
    } else if (type === 'cannon') {
      const recoil = flash > 0 ? -4 : 0;
      g.fillStyle = '#333';
      const bl = br === 'b' ? 26 : 16 + lv * 2;
      g.fillRect(4 + recoil, -3.5 - lv * 0.5, bl, 7 + lv);
      if (br === 'a') g.fillStyle = '#c0401a';
      g.fillRect(1 + bl + recoil, -4.5 - lv * 0.5, 4, 9 + lv);
      g.fillStyle = D.color;
      g.beginPath();
      for (let i = 0; i < 8; i++) { const q = i * Math.PI / 4 + Math.PI / 8; g.lineTo(Math.cos(q) * 10.5, Math.sin(q) * 10.5); }
      g.closePath(); g.fill();
      g.fillStyle = '#c07a20'; g.beginPath(); g.arc(-2, 0, 4.5, 0, Math.PI * 2); g.fill();
    } else if (type === 'missile') {
      g.fillStyle = '#5a3a3a'; g.fillRect(-9, -11, 18, 22);
      g.fillStyle = D.color; g.fillRect(-8, -10, 16, 20);
      const n = br === 'a' ? 6 : br === 'b' ? 2 : 2 + lv;
      const w = br === 'b' ? 3 : 1.8;
      for (let i = 0; i < n; i++) {
        const y = -10 + (20 / n) * (i + 0.5);
        g.fillStyle = '#eee'; g.fillRect(-4, y - w, 13, w * 2);
        g.fillStyle = br === 'b' ? '#3a3a3a' : '#d03a2a'; g.beginPath(); g.moveTo(9, y - w); g.lineTo(12.5 + w, y); g.lineTo(9, y + w); g.fill();
      }
    }
    g.restore();
  }

  function drawTank(e) {
    const T = e.T, r = T.r;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.a);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-r + 2, -r * 0.8 + 3, r * 2, r * 1.6);
    const body = e.hit > 0 ? '#ffffff' : T.color;
    if (e.type === 'scout') {
      // 偵察車：タイヤ 4 つの装甲車
      ctx.fillStyle = '#222';
      for (const [wx, wy] of [[-5, -7], [5, -7], [-5, 7], [5, 7]]) ctx.fillRect(wx - 3, wy - 2, 6, 4);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.moveTo(r, -4); ctx.lineTo(r, 4); ctx.lineTo(r - 3, 6); ctx.lineTo(-r, 6); ctx.lineTo(-r, -6); ctx.lineTo(r - 3, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-r + 2, -4, r, 8);
      ctx.fillStyle = '#333'; ctx.fillRect(0, -1, 9, 2);
    } else {
      const len = r * 1.1, wid = r * 0.85;
      // 履帯（進むと模様が流れる）
      ctx.fillStyle = '#2a2a26';
      ctx.fillRect(-len, -wid, len * 2, wid * 0.42);
      ctx.fillRect(-len, wid * 0.58, len * 2, wid * 0.42);
      ctx.fillStyle = '#4a4a44';
      const ph = (e.d * 0.5) % 4;
      for (let x = -len + ph; x < len; x += 4) {
        ctx.fillRect(x, -wid, 1.5, wid * 0.42);
        ctx.fillRect(x, wid * 0.58, 1.5, wid * 0.42);
      }
      ctx.fillStyle = body;
      ctx.fillRect(-len * 0.92, -wid * 0.62, len * 1.84, wid * 1.24);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-len * 0.92, wid * 0.2, len * 1.84, wid * 0.42);
      // 砲塔と砲身
      ctx.fillStyle = '#2a2a26';
      if (e.type === 'boss') { ctx.fillRect(0, -5, r * 1.5, 3); ctx.fillRect(0, 2, r * 1.5, 3); } else ctx.fillRect(0, -1.6 - r * 0.05, r * 1.35, 3.2 + r * 0.1);
      ctx.fillStyle = e.hit > 0 ? '#ffffff' : shade(T.color, -18);
      ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(-r * 0.22, -r * 0.15, r * 0.22, 0, Math.PI * 2); ctx.fill();
      if (e.type === 'boss') {
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath(); ctx.arc(-r * 0.1, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (e.slowT > 0) {
      ctx.strokeStyle = `rgba(120,220,255,${0.4 + 0.3 * Math.sin(clock * 20 + e.wob)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.stroke();
    }
    if (e.weakT > 0) {
      ctx.strokeStyle = 'rgba(200,130,255,0.75)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(0, 0, r + 4.5, clock * 3, clock * 3 + Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.stunT > 0) {
      // 止まっている：まわりに電気のジグザグ
      ctx.strokeStyle = '#fff07a'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const q = clock * 9 + i * 2.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(q) * (r + 1), Math.sin(q) * (r + 1));
        ctx.lineTo(Math.cos(q + 0.25) * (r + 6), Math.sin(q + 0.25) * (r + 6));
        ctx.lineTo(Math.cos(q + 0.5) * (r + 2), Math.sin(q + 0.5) * (r + 2));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function shade(hex, d) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => clamp(v + d, 0, 255);
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  // 基地（旗が付いた要塞）。旗が横倒しにならないよう画面の向きのまま描く
  function drawBase() {
    uprightAt(base.x, base.y);
    const hurtK = state === 'title' ? 1 : lives / STAGES[stageNo].lives;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-15, -9, 33, 28);
    ctx.fillStyle = '#6a6a72'; ctx.fillRect(-17, -11, 34, 28);
    ctx.fillStyle = '#8a8a94';
    for (let i = 0; i < 4; i++) ctx.fillRect(-17 + i * 9.5, -15, 6, 5);
    ctx.fillStyle = '#9a9aa4'; ctx.fillRect(-15, -9, 30, 6);
    ctx.fillStyle = '#3a3a42'; ctx.fillRect(-5, 4, 10, 13);
    if (state !== 'ending' || lives > 0) {
      ctx.fillStyle = '#333'; ctx.fillRect(-1, -32, 2, 22);
      const wv = Math.sin(clock * 6) * 2;
      ctx.fillStyle = hurtK > 0.5 ? '#3a8ad8' : hurtK > 0.25 ? '#ffb43c' : '#e04a3a';
      ctx.beginPath(); ctx.moveTo(1, -32); ctx.quadraticCurveTo(8, -32 + wv, 15, -29); ctx.quadraticCurveTo(8, -26 + wv, 1, -24); ctx.fill();
    }
  }

  // ---------- 上下の帯 ----------
  const shown = {};
  function setText(el, key, v) { if (shown[key] !== v) { shown[key] = v; el.textContent = v; } }
  function updateBars() {
    const S = STAGES[stageNo], title = state === 'title';
    setText(moneyEl, 'money', title ? '-' : `$${money}`);
    setText(livesEl, 'lives', title ? '-' : `${Math.max(0, lives)}/${S.lives}`);
    setText(waveEl, 'wave', title ? '-' : `${wave}/${S.waves}`);
    const canNext = canCallNext();
    if (shown.next !== canNext) {
      shown.next = canNext;
      nextBtn.disabled = !canNext;
      nextBtn.classList.toggle('early', canNext && inWave);
    }
    const left = enemies.length + spawnQ.length;
    const label = !inWave || state !== 'play' ? `▶ 出撃<small>ウェーブ ${Math.min(wave + 1, S.waves)}</small>`
      : canNext ? `▶ 次を呼ぶ<small>残り ${left} 両</small><small>早期 +$${earlyBonus(wave, enemies.length)}</small>`
      : `戦闘中<small>残り ${left} 両</small>`;
    if (shown.nextLabel !== label) { shown.nextLabel = label; nextBtn.innerHTML = label; }
    if (shown.trayMoney !== money) { shown.trayMoney = money; refreshTray(); }
    updateSkills();
  }
  // 支援のボタン（戦場の右下）。待ち時間はボタンを暗く塗って見せる
  function renderSkills() {
    skillsEl.innerHTML = SKILL_ORDER.map(k =>
      `<button data-skill="${k}" title="${SKILLS[k].desc}（${SKILLS[k].key}）"><span>${SKILLS[k].name}</span><i class="cd"></i><span class="key">${SKILLS[k].key}</span></button>`).join('');
  }
  function updateSkills() {
    const show = state !== 'title';
    if (shown.skills !== show) { shown.skills = show; skillsEl.classList.toggle('hidden', !show); }
    if (!show) return;
    for (const b of skillsEl.children) {
      const k = b.dataset.skill;
      const cd = skillCd[k] || 0;
      const v = `${cd > 0 ? Math.ceil(cd) : ''}|${skillMode === k}|${rushT > 0 && k === 'rush'}|${(cd / SKILLS[k].cd).toFixed(2)}`;
      if (b._v === v) continue;
      b._v = v;
      b.style.setProperty('--p', (cd / SKILLS[k].cd).toFixed(3));
      b.querySelector('.cd').textContent = cd > 0 ? Math.ceil(cd) : '';
      b.classList.toggle('wait', cd > 0);
      b.classList.toggle('on', skillMode === k || (k === 'rush' && rushT > 0));
    }
  }

  function iconCanvas(type, lv, size, br) {
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const g = c.getContext('2d');
    g.setTransform(size * 2 / 36, 0, 0, size * 2 / 36, size, size);
    drawTurret(g, type, lv, -Math.PI / 4, 0, 0.3, br);
    return c;
  }
  // 下の帯：ふだんは砲台の一覧、砲台を選んでいるときはその砲台の強化・売却
  function renderTray() {
    tools.innerHTML = '';
    if (sel && sel.turret) {
      const t = sel.turret, D = TURRETS[t.type];
      const B = t.br && D.br[t.br];
      const info = document.createElement('div');
      info.className = 'info';
      info.appendChild(iconCanvas(t.type, t.lv, 20, t.br));
      const txt = document.createElement('div');
      const stats = t.type === 'emp'
        ? `減速 ${Math.round(stat(t, 'slow') * 100)}%・射程 ${stat(t, 'range')}`
        : `威力 ${stat(t, 'dmg')}${stat(t, 'count') ? '×' + stat(t, 'count') : ''}・射程 ${stat(t, 'range')}`;
      const note = B ? B.desc : t.lv === 1 ? '次の強化で型を 2 つから選ぶ' : '';
      txt.innerHTML = `<b>${B ? B.name : D.name} Lv${t.lv + 1}</b><small>${stats}</small>${note ? `<small class="note">${note}</small>` : ''}`;
      info.appendChild(txt);
      tools.appendChild(info);
      const mk = (cls, act, html) => {
        const b = document.createElement('button');
        b.className = 'act ' + cls; b.dataset.act = act; b.innerHTML = html;
        tools.appendChild(b);
        return b;
      };
      if (t.lv === 1) {
        for (const k of ['a', 'b']) {
          const o = D.br[k];
          const b = mk('up br' + (pendingBr && pendingBr.t === t && pendingBr.br === k ? ' pend' : ''), 'br',
            `${o.name}<span class="key"> (${k.toUpperCase()})</span><br>$${o.cost}`);
          b.dataset.br = k; b.title = o.desc;
        }
      } else {
        const up = mk('up', 'up', t.lv >= 2 ? '強化<br>最大' : `強化<span class="key"> (U)</span><br>$${D.cost[1]}`);
        up.disabled = t.lv >= 2;
      }
      if (t.type !== 'emp') mk('aim', 'aim', `ねらい<span class="key"> (T)</span><br>${AIMS[t.aim][1]}`).title = 'ねらう戦車を切り替える';
      mk('sell', 'sell', `売却<span class="key"> (S)</span><br>+$${Math.floor(t.spent * SELL_RATE)}`);
      const cl = mk('close', 'close', '✕'); cl.title = '閉じる';
    } else {
      TURRET_ORDER.forEach((type, i) => {
        const D = TURRETS[type];
        const b = document.createElement('button');
        b.className = 'card'; b.dataset.type = type;
        b.title = `${D.name}（${i + 1}）：${D.desc}`;
        b.appendChild(iconCanvas(type, 0, 17));
        const tx = document.createElement('span'); tx.className = 'tx';
        tx.innerHTML = `<span class="nm">${D.name}</span><span class="cost">$${D.cost[0]}</span>`;
        b.appendChild(tx);
        tools.appendChild(b);
      });
    }
    refreshTray();
  }
  function refreshTray() {
    for (const b of tools.querySelectorAll('.card')) {
      const type = b.dataset.type;
      b.classList.toggle('poor', money < TURRETS[type].cost[0]);
      b.classList.toggle('on', placeType === type);
      b.classList.toggle('pick', !!(sel && !sel.turret));
    }
    if (sel && sel.turret && sel.turret.lv < 2) {
      for (const up of tools.querySelectorAll('.up')) up.classList.toggle('poor', money < upCost(sel.turret, up.dataset.br));
    }
  }
  function chooseType(type) {
    if (state !== 'play') return;
    if (sel && !sel.turret) {
      // 先に空き地を選んであれば、そこに建てる
      if (build(type, sel.c, sel.r)) { sel = null; renderTray(); }
      return;
    }
    skillMode = null;
    placeType = placeType === type ? null : type;
    if (placeType) showToast(`${TURRETS[type].name}：建てる場所をタップ`, 2.5);
    if (sel) { sel = null; renderTray(); } else refreshTray();
  }

  tools.addEventListener('click', e => {
    unlockAudio();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.type) chooseType(b.dataset.type);
    else if (b.dataset.act === 'up' && sel && sel.turret) upgrade(sel.turret);
    else if (b.dataset.act === 'br' && sel && sel.turret) chooseBranch(sel.turret, b.dataset.br);
    else if (b.dataset.act === 'aim' && sel && sel.turret) cycleAim(sel.turret);
    else if (b.dataset.act === 'sell' && sel && sel.turret) sell(sel.turret);
    else if (b.dataset.act === 'close') { sel = null; renderTray(); }
  });
  nextBtn.addEventListener('click', () => { unlockAudio(); startWave(); });
  skillsEl.addEventListener('click', e => {
    unlockAudio();
    const b = e.target.closest('button');
    if (b) chooseSkill(b.dataset.skill);
  });

  // ---------- 入力 ----------
  function tileAt(clientX, clientY) {
    const rc = canvas.getBoundingClientRect();
    const p = toWorld(clientX - rc.left, clientY - rc.top);
    return { c: Math.floor(p.x / TILE), r: Math.floor(p.y / TILE), p };
  }
  function tapTile(c, r) {
    const t = turretAt(c, r);
    if (t) {
      sel = sel && sel.turret === t ? null : { turret: t };
      placeType = null;
      renderTray();
      return;
    }
    if (!buildable(c, r)) {
      if (inMap(c, r) && placeType) {
        showToast('ここには建てられません');
        sfx.no();
        return;
      }
      const had = sel || placeType;
      sel = null; placeType = null;
      if (had) renderTray();
      return;
    }
    if (placeType) { build(placeType, c, r); return; }
    sel = sel && !sel.turret && sel.c === c && sel.r === r ? null : { c, r };
    renderTray();
  }
  canvas.addEventListener('pointerdown', e => {
    unlockAudio();
    if (state !== 'play') return;
    const { c, r, p } = tileAt(e.clientX, e.clientY);
    if (skillMode) {
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) { skillMode = null; return; }
      useSkillAt(p.x, p.y);
      return;
    }
    tapTile(c, r);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    hover = tileAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; });

  window.addEventListener('keydown', e => {
    unlockAudio();
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (state === 'play') pause(); else if (state === 'pause') resume();
      return;
    }
    if (e.key === '+' || e.key === '=' || e.key === ';') { setSpeed(1); return; }
    if (e.key === '-') { setSpeed(-1); return; }
    if (state !== 'play') return;
    const i = '1234'.indexOf(e.key);
    if (i >= 0) chooseType(TURRET_ORDER[i]);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startWave(); }
    else if ((e.key === 'u' || e.key === 'U') && sel && sel.turret) upgrade(sel.turret);
    else if ((e.key === 'a' || e.key === 'A' || e.key === 'b' || e.key === 'B') && sel && sel.turret) chooseBranch(sel.turret, e.key.toLowerCase());
    else if ((e.key === 't' || e.key === 'T') && sel && sel.turret) cycleAim(sel.turret);
    else if ('qweQWE'.includes(e.key) && e.key.length === 1) chooseSkill(SKILL_ORDER['qwe'.indexOf(e.key.toLowerCase())]);
    else if ((e.key === 's' || e.key === 'S' || e.key === 'Delete') && sel && sel.turret) sell(sel.turret);
  });

  function setSpeed(d) {
    const i = clamp(SPEEDS.indexOf(gameSpeed) + d, 0, SPEEDS.length - 1);
    gameSpeed = SPEEDS[i];
    save('tankdef.speed', gameSpeed);
    speedBtn.textContent = `×${gameSpeed}`;
  }
  speedBtn.textContent = `×${gameSpeed}`;
  speedBtn.addEventListener('click', () => {
    unlockAudio();
    gameSpeed = SPEEDS[(SPEEDS.indexOf(gameSpeed) + 1) % SPEEDS.length];
    save('tankdef.speed', gameSpeed);
    speedBtn.textContent = `×${gameSpeed}`;
  });
  soundBtn.addEventListener('click', () => {
    unlockAudio();
    muted = !muted;
    soundBtn.classList.toggle('off', muted);
    save('tankdef.muted', muted ? '1' : '0');
  });
  pauseBtn.addEventListener('click', () => {
    unlockAudio();
    if (state === 'play') pause(); else if (state === 'pause') resume();
  });

  // ---------- 画面（タイトル・ポーズ・結果） ----------
  function showOverlay(html) { overlay.innerHTML = `<div class="panel">${html}</div>`; overlay.classList.remove('hidden'); }
  function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
  const starText = n => '★'.repeat(n) + `<i>${'★'.repeat(3 - n)}</i>`;

  function showTitle() {
    state = 'title';
    sel = null; placeType = null;
    renderTray();
    const btns = STAGES.map((S, i) => i <= unlocked
      ? `<button data-act="stage" data-n="${i}">${i + 1}. ${S.name}<small>${S.waves} ウェーブ</small><span class="st">${stars[i] ? starText(stars[i]) : '　'}</span></button>`
      : `<button disabled>${i + 1}. ？？？<small>前のステージをクリア</small></button>`).join('');
    showOverlay(`
      <h1>鉄壁の砲台</h1>
      <p>道を進んでくる戦車から、基地を守り抜け！</p>
      <ul class="rules">
        <li>空き地をタップして<b>砲台</b>を建てる。砲台をタップすると強化・売却</li>
        <li>「▶ 出撃」でウェーブ開始。戦車を倒すと資金がもらえる</li>
        <li>戦車が基地にたどり着くと耐久が減り、0 で負け</li>
        <li>Lv3 では砲台の<b>型</b>を 2 つから選ぶ。ねらう戦車も切り替えられる</li>
        <li>右下の<b>支援</b>（空爆・地雷・一斉射撃）はウェーブ中に使える</li>
        <li>戦車が出そろえば、倒し切る前に次を呼べる（<b>早期ボーナス</b>）。手持ちの資金には<b>利息</b>が付く</li>
      </ul>
      <div class="legend">
        <span>機関砲：速射</span><span>大砲：範囲攻撃</span><span>電磁波：減速</span><span>ミサイル：遠距離</span>
      </div>
      <div class="stages">${btns}</div>
      <p><a href="../index.html">← ゲーム一覧へ</a></p>`);
  }
  function showBriefing(n) {
    const S = STAGES[n];
    showOverlay(`
      <h2>ステージ ${n + 1}：${S.name}</h2>
      <p class="note">${S.note}</p>
      <p>ウェーブ ${S.waves}・資金 $${S.money}・基地の耐久 ${S.lives}</p>
      <button data-act="go" data-n="${n}">はじめる</button><br>
      <button class="sub" data-act="title">もどる</button>`);
  }
  function pause() {
    state = 'pause';
    showOverlay(`
      <h2>ポーズ</h2>
      <p>ステージ ${stageNo + 1}：${STAGES[stageNo].name}　ウェーブ ${wave}/${STAGES[stageNo].waves}</p>
      <button data-act="resume">つづける</button><br>
      <button class="sub" data-act="retry">やり直す</button>
      <button class="sub" data-act="title">ステージ選択へ</button>`);
  }
  function resume() { state = 'play'; hideOverlay(); }
  function showResult() {
    const S = STAGES[stageNo];
    if (lives > 0) {
      state = 'clear';
      const next = stageNo + 1 < STAGES.length;
      showOverlay(`
        <h2>ステージ ${stageNo + 1} クリア！</h2>
        <p class="stars">${starText(lastStars)}</p>
        <p>基地の耐久 ${lives}/${S.lives} で守り切った${lives >= S.lives ? '（無傷！）' : ''}</p>
        ${next ? '' : '<p class="note">全ステージクリア！ おめでとう！ 星 3 つを目指してみよう</p>'}
        ${next ? `<button data-act="stage" data-n="${stageNo + 1}">次のステージへ</button><br>` : ''}
        <button class="sub" data-act="retry">もう一度</button>
        <button class="sub" data-act="title">ステージ選択へ</button>`);
    } else {
      state = 'over';
      sfx.over();
      showOverlay(`
        <h2 class="bad">基地が破壊された…</h2>
        <p>ウェーブ ${wave}/${S.waves} で力尽きた</p>
        <p class="note">ヒント：重戦車はミサイル、群れは大砲、足止めは電磁波</p>
        <button data-act="retry">もう一度</button><br>
        <button class="sub" data-act="title">ステージ選択へ</button>`);
    }
  }
  overlay.addEventListener('click', e => {
    unlockAudio();
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'stage') showBriefing(+b.dataset.n);
    else if (act === 'go') startStage(+b.dataset.n);
    else if (act === 'resume') resume();
    else if (act === 'retry') startStage(stageNo);
    else if (act === 'title') showTitle();
  });

  // ---------- メインループ ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  function update(dt) {
    if (toast) { toast.t -= dt; if (toast.t <= 0 || !toast.text) toast = null; }
    if (state === 'play' || state === 'ending') {
      // 速くしても弾がすり抜けないよう、細かく区切って進める
      let left = dt * gameSpeed;
      while (left > 1e-6) { const h = Math.min(left, 1 / 60); step(h); left -= h; }
    }
    if (state === 'ending') {
      endT -= dt;
      if (endT <= 0) showResult();
    }
    shake = Math.max(0, shake - dt);
    shakeX = shake > 0 ? rand(-1, 1) * shake * 10 : 0;
    shakeY = shake > 0 ? rand(-1, 1) * shake * 10 : 0;
    updateBars();
  }

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(field);
  buildMap();
  renderSkills();
  showTitle();
  requestAnimationFrame(frame);

  // 動作確認用（ブラウザのコンソールから状態を見たり、時間を進めたりできるように）
  window.tankDefense = {
    get state() { return state; }, get money() { return money; }, set money(v) { money = v; }, get lives() { return lives; },
    get wave() { return wave; }, get inWave() { return inWave; }, get turrets() { return turrets; },
    get enemies() { return enemies; }, get grid() { return grid; }, get portrait() { return portrait; },
    start: startStage, build, upgrade, startWave, chooseSkill, useSkillAt, cycleAim, get skillCd() { return skillCd; }, sim(sec) { for (let i = 0; i < sec * 60; i++) step(1 / 60); },
    get world() { return { scale, offX, offY }; },
  };
})();
