'use strict';
// エアポート管制官：指やマウスで描いた線で飛行機を誘導し、滑走路に着陸させるラインドローゲーム。
// 速い旅客機は長い滑走路へ、遅いプロペラ機はどちらの滑走路にも降りられる。ぶつかったらゲームオーバー。
// ステージ制：目標の機数を着陸させると次へ。旅客機だけで始まり、プロペラ機が混ざり、滑走路が減っていく。
//
// 座標は「ワールド座標」で扱う。画面の短い辺がいつも BASE になるように拡大縮小し、
// 長い辺は画面の縦横比に合わせて伸ばす（縦持ちのスマホでは滑走路の配置も縦向きにする）。

(function () {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const pauseBtn = document.getElementById('pause');
  const soundBtn = document.getElementById('sound');
  const speedBtn = document.getElementById('speed');
  const buttonsBox = document.getElementById('buttons');

  const BASE = 600;       // 画面の短い辺のワールドでの長さ
  const MAX_LONG = 1400;  // 長い辺の上限（これより横長の画面では左右に余白を作る）
  const PICK = 46;        // 飛行機をつかめる距離
  const ENTRY = 30;       // 滑走路の入口に線をつなげたとみなす距離
  const STEP = 7;         // 線の点の間隔
  const HUD_W = 134;      // 左上の「着陸 x / y」の表示の幅（画面の px。style.css の #buttons の位置と合わせる）
  const TOP_BAR = 68;     // 画面の上の帯の高さ（画面の px）。表示とボタンはここに置き、飛行機はこの下だけを飛ぶ

  const TYPES = {
    jet:  { name: '旅客機',     speed: 46, r: 15, color: '#4fa8ff', runways: ['long'] },
    prop: { name: 'プロペラ機', speed: 24, r: 11, color: '#ffb43c', runways: ['long', 'short'] },
  };
  const canLand = (p, rw) => p.T.runways.includes(rw.kind);
  // 燃料（オプション）：出てきてから着陸を決めるまでに飛べる秒数。切れたら墜落
  const FUEL = { jet: 40, prop: 50 };
  const MAYDAY_FUEL = 20;   // 緊急機（オプション）の燃料。燃料オプションがオフでも緊急機には付く
  const MAYDAY_BONUS = 3;   // 緊急機を降ろしたときの着陸数
  const MAYDAY_COLOR = '#ff3b30';
  const LOW_FUEL = 0.3;     // 燃料がこの割合を切ったら点滅して知らせる
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]; // 全体のスピード（ゲームの時間の進み方）
  const RUNWAY_COLOR = { long: TYPES.jet.color, short: TYPES.prop.color };

  let W = 900, H = 600, scale = 1, offX = 0, offY = 0, dpr = 1, portrait = false;
  let runways = [], decor = [];
  let planes = [], incoming = [], particles = [], texts = [];
  let state = 'title'; // title / play / pause / crash / over
  let landed = 0, elapsed = 0, spawnTimer = 0, crashT = 0, clearT = 0, beepT = 0, fuelBeepT = 0, clock = 0;
  let overReason = 'crash'; // ゲームオーバーの理由：crash（衝突）/ fuel（燃料切れ）
  let stageNo = 0, unlocked = 0; // stageNo は STAGES の添字（STAGES.length はハイスコアモード）。unlocked は遊べる最後のステージの添字
  // ハイスコアモードの滑走路の数（1〜3本）と、本数ごとのベスト。3本の記録は最初の版と同じ保存キー
  const BEST_KEY = { 1: 'airportline.best1', 2: 'airportline.best2', 3: 'airportline.best' };
  let endlessOpen = loadFlag('airportline.endless'), newRecord = false;
  let endlessRw = Math.min(3, loadNum('airportline.endlessRw') || 3);
  const bests = { 1: loadNum(BEST_KEY[1]), 2: loadNum(BEST_KEY[2]), 3: loadNum(BEST_KEY[3]) };
  let toast = null;
  let gameSpeed = loadSpeed();
  // オプション：燃料ゲージ・緊急機を出すかどうか（ブラウザに保存）
  const options = { fuel: loadFlag('airportline.fuel'), mayday: loadFlag('airportline.mayday') };
  const drags = new Map(); // 指（touch の identifier、マウスは 'mouse'）→ 線を描いている飛行機

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
  function loadUnlocked() {
    // 保存キーは旧名「エアポート・ライン」のまま（遊んだ進み具合を引き継ぐため）
    try { return clamp(+localStorage.getItem('airportline.stage') || 0, 0, STAGES.length - 1); } catch (e) { return 0; }
  }
  function loadSpeed() {
    try {
      const v = +localStorage.getItem('airportline.speed');
      return SPEEDS.includes(v) ? v : 1;
    } catch (e) { return 1; }
  }
  function loadFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
  }
  function loadNum(key) {
    try { return Math.max(0, Math.floor(+localStorage.getItem(key) || 0)); } catch (e) { return 0; }
  }
  function save(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) { /* 保存できなくても遊べる */ }
  }
  function saveUnlocked() {
    try { localStorage.setItem('airportline.stage', String(unlocked)); } catch (e) { /* 保存できなくても遊べる */ }
  }

  // ---------- 音（WebAudio で簡単な効果音） ----------
  let actx = null, muted = false;
  try { muted = localStorage.getItem('airportline.muted') === '1'; } catch (e) { /* 無視 */ }
  soundBtn.classList.toggle('off', muted);
  function unlockAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
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
  const sfx = {
    grab: () => tone(660, 0.06, 'square', 0.05),
    lock: () => { tone(880, 0.08, 'triangle', 0.1); tone(1320, 0.12, 'triangle', 0.1, null, 0.07); },
    land: () => { tone(523, 0.1, 'triangle', 0.12); tone(659, 0.1, 'triangle', 0.12, null, 0.09); tone(784, 0.2, 'triangle', 0.12, null, 0.18); },
    warn: () => tone(990, 0.09, 'square', 0.06),
    spawn: () => tone(440, 0.15, 'sine', 0.06, 520),
    clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.5 : 0.14, 'triangle', 0.13, null, i * 0.13)),
    crash: () => { tone(200, 0.8, 'sawtooth', 0.2, 40); tone(90, 1.0, 'square', 0.15, 30, 0.05); },
    lowFuel: () => { tone(330, 0.12, 'square', 0.06); tone(262, 0.16, 'square', 0.06, null, 0.13); },
    mayday: () => [0, 0.3, 0.6].forEach(d => tone(700, 0.28, 'sawtooth', 0.07, 1100, d)),
  };

  // ---------- 画面サイズと滑走路の配置 ----------
  // 配置は横長の画面を基準に書き、縦長では x と y を入れ替える（対角線で折り返す）。
  const RUNWAY_DEFS = {
    L1: { kind: 'long',  fx: 0.40, fy: 0.64, deg: -12, len: 290, wid: 30 },
    L2: { kind: 'long',  fx: 0.62, fy: 0.24, deg: 190, len: 260, wid: 30 },
    S1: { kind: 'short', fx: 0.80, fy: 0.60, deg: 250, len: 160, wid: 24 },
  };

  // ---------- ステージ ----------
  // goal: 着陸させる機数　prop: プロペラ機の割合　runways: 使う滑走路
  // max: 同時に飛ぶ最大の機数　interval: 出てくる間隔（秒。着陸させるたびに少し短くなる）
  const STAGES = [
    { goal: 5,  prop: 0,    runways: ['L1', 'L2'],       max: 3, interval: 6.5, note: 'まずは旅客機だけ。長い滑走路へ誘導しよう' },
    { goal: 8,  prop: 0,    runways: ['L1', 'L2'],       max: 4, interval: 5.2, note: '旅客機が増えてきた。2本の滑走路を使い分けよう' },
    { goal: 10, prop: 0.35, runways: ['L1', 'L2', 'S1'], max: 4, interval: 5.0, note: 'プロペラ機が登場！ 遅いけれど、短い滑走路にも長い滑走路にも降りられる' },
    { goal: 12, prop: 0.5,  runways: ['L1', 'L2', 'S1'], max: 5, interval: 4.4, note: '速い旅客機と遅いプロペラ機。追突に気をつけて' },
    { goal: 12, prop: 0.5,  runways: ['L1', 'S1'],       max: 5, interval: 4.4, note: '滑走路が減った！ 旅客機が降りられる長い滑走路は1本だけ' },
    { goal: 15, prop: 0.55, runways: ['L1', 'S1'],       max: 6, interval: 3.8, note: 'さらに混雑。プロペラ機は短い滑走路へ逃がそう' },
    { goal: 15, prop: 0.5,  runways: ['L1'],             max: 5, interval: 4.2, note: '滑走路はついに1本！ 全部の飛行機が同じ滑走路へ' },
    { goal: 20, prop: 0.5,  runways: ['L1'],             max: 6, interval: 3.6, note: '最終ステージ。順番をよく考えて着陸させよう' },
  ];
  // ハイスコアモード：ステージ8のあと。滑走路の数を選び、ぶつかるまで続く。
  // 着陸させるほど同時に飛ぶ機数が増え、出てくる間隔が短くなる
  const ENDLESS = STAGES.length;
  const ENDLESS_RUNWAYS = { 1: ['L1'], 2: ['L1', 'S1'], 3: ['L1', 'L2', 'S1'] };
  const endlessStage = () => ({
    goal: Infinity, prop: 0.5, runways: ENDLESS_RUNWAYS[endlessRw],
    max: Math.min(9, 4 + Math.floor(landed / 10)),
    interval: Math.max(2.2, 4.4 - landed * 0.03),
    note: 'ぶつかるまで終わらない！ 着陸させるほど飛行機が増えていく。どこまで記録を伸ばせるか挑戦しよう',
  });
  const isEndless = () => stageNo === ENDLESS;
  const best = () => bests[endlessRw];
  unlocked = loadUnlocked();
  const stage = () => isEndless() ? endlessStage() : STAGES[stageNo];
  const hasProps = () => stage().prop > 0;

  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const oldW = W, oldH = H, wasPortrait = portrait;
    // 遊ぶ場所は、上の帯・ノッチ・ホームバーをよけた残り
    const safe = safeInsets();
    const ax = safe.left, ay = TOP_BAR + safe.top;
    const aw = cw - safe.left - safe.right, ah = ch - ay - safe.bottom;
    portrait = ah > aw;
    scale = Math.min(aw, ah) / BASE;
    const long = Math.min(Math.max(aw, ah) / scale, MAX_LONG);
    W = portrait ? BASE : long;
    H = portrait ? long : BASE;
    offX = ax + (aw - W * scale) / 2;
    offY = ay + (ah - H * scale) / 2;
    buildLayout();
    remap(wasPortrait !== portrait, oldW, oldH);
  }

  function buildLayout() {
    const LW = Math.max(W, H), LH = Math.min(W, H);
    runways = stage().runways.map(id => {
      const d = RUNWAY_DEFS[id];
      let x = d.fx * LW, y = d.fy * LH, a = d.deg * Math.PI / 180;
      if (portrait) { [x, y] = [y, x]; a = Math.PI / 2 - a; }
      const dx = Math.cos(a), dy = Math.sin(a);
      return {
        id, kind: d.kind, x, y, a, dx, dy, len: d.len, wid: d.wid, color: RUNWAY_COLOR[d.kind],
        thx: x - dx * d.len / 2, thy: y - dy * d.len / 2, // 入口（ここから進入する）
      };
    });
    // 草地の模様と木。毎回同じ見た目になるよう、簡単な疑似乱数を使う
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    decor = [];
    for (let i = 0; i < 26; i++) {
      decor.push({ kind: 'field', x: rnd() * W, y: rnd() * H, w: 60 + rnd() * 140, h: 40 + rnd() * 110, a: rnd() * 0.6 - 0.3, c: rnd() });
    }
    for (let i = 0; i < 60; i++) {
      const x = rnd() * W, y = rnd() * H;
      if (runways.some(rw => nearRunway(rw, x, y, 34))) continue;
      decor.push({ kind: 'tree', x, y, r: 5 + rnd() * 6 });
    }
  }

  function nearRunway(rw, x, y, margin) {
    const px = x - rw.x, py = y - rw.y;
    const along = px * rw.dx + py * rw.dy, across = -px * rw.dy + py * rw.dx;
    return Math.abs(along) < rw.len / 2 + margin + 50 && Math.abs(across) < rw.wid / 2 + margin;
  }

  // 遊んでいる途中で画面の向きや大きさが変わったら、飛行機の位置も合わせて動かす
  function remap(flip, oldW, oldH) {
    if (!planes.length && !incoming.length) return;
    let sw = oldW, sh = oldH;
    if (flip) [sw, sh] = [sh, sw];
    const fx = W / sw, fy = H / sh;
    const move = o => {
      if (flip) [o.x, o.y] = [o.y, o.x];
      o.x *= fx; o.y *= fy;
    };
    const turn = a => (flip ? Math.PI / 2 - a : a);
    for (const p of planes) {
      move(p);
      p.dir = turn(p.dir); p.heading = turn(p.heading);
      p.path.forEach(move);
      if (p.rw) p.rw = runways.find(r => r.id === p.rw.id);
      const last = p.path[p.path.length - 1];
      if (last && last.td) { last.x = p.rw.thx; last.y = p.rw.thy; }
    }
    for (const s of incoming) { move(s); s.dir = turn(s.dir); }
    particles.forEach(move);
    texts.forEach(move);
  }

  // ---------- ゲームの進行 ----------
  // ステージの準備（滑走路を並べ直して空を空にする）。始めるのは startStage
  function setStage(n) {
    stageNo = n;
    planes = []; incoming = []; particles = []; texts = [];
    drags.clear();
    landed = 0; elapsed = 0; spawnTimer = 1; crashT = 0; clearT = 0; toast = null; newRecord = false;
    fuelBeepT = 0; overReason = 'crash';
    buildLayout();
  }
  function startStage() {
    state = 'play';
    hideOverlay();
  }

  const spawnInterval = () => isEndless() ? stage().interval
    : Math.max(stage().interval * 0.65, stage().interval - landed * 0.1);
  const maxPlanes = () => stage().max;

  // 画面の端に「もうすぐ来る」印を出し、少しあとで飛行機が入ってくる
  function trySpawn() {
    const type = Math.random() < stage().prop ? 'prop' : 'jet';
    // 緊急機：同時に1機まで。始まってすぐは出さない
    const mayday = options.mayday && elapsed > 8 && Math.random() < 0.18 &&
      !planes.some(p => p.mayday && p.state === 'fly') && !incoming.some(s => s.mayday);
    for (let tries = 0; tries < 12; tries++) {
      const edge = Math.floor(Math.random() * 4), t = rand(0.1, 0.9), m = 40;
      const x = edge === 0 ? t * W : edge === 1 ? W + m : edge === 2 ? t * W : -m;
      const y = edge === 0 ? -m : edge === 1 ? t * H : edge === 2 ? H + m : t * H;
      if (planes.some(p => dist(p.x, p.y, x, y) < 170)) continue;
      if (incoming.some(s => dist(s.x, s.y, x, y) < 170)) continue;
      const tx = W * rand(0.3, 0.7), ty = H * rand(0.3, 0.7);
      incoming.push({ type, x, y, dir: Math.atan2(ty - y, tx - x), t: 2.5, mayday });
      if (mayday) { sfx.mayday(); showToast('メーデー！ 緊急機が接近中'); } else sfx.spawn();
      return true;
    }
    return false;
  }

  let nextId = 1;
  function addPlane(s) {
    const fuel = s.mayday ? MAYDAY_FUEL : options.fuel ? FUEL[s.type] : null; // null は燃料なし
    planes.push({
      id: nextId++, type: s.type, T: TYPES[s.type], x: s.x, y: s.y,
      dir: s.dir, heading: s.dir, path: [], rw: null,
      state: 'fly', lt: 0, entered: false, warn: false, spin: 0,
      mayday: !!s.mayday, fuel, fuelMax: fuel,
    });
  }
  // 燃料が残りわずか（点滅させ、音で知らせる）
  const lowFuel = p => p.fuel !== null && p.fuel < p.fuelMax * LOW_FUEL;

  function update(dt) {
    clock += dt;
    if (toast && (toast.t -= dt) <= 0) toast = null;
    updateEffects(dt);
    if (state === 'crash') {
      crashT += dt;
      if (crashT > 1.8) { state = 'over'; showOver(); }
      return;
    }
    if (state === 'clear') {
      clearT += dt;
      if (clearT > 1.6) { state = 'cleared'; showClear(); }
      return;
    }
    if (state !== 'play') return;
    dt *= gameSpeed; // ここから先（飛行・出現・着陸）はスピード設定の倍率で進む
    elapsed += dt;

    // 出現
    const flying = planes.filter(p => p.state === 'fly').length;
    spawnTimer -= dt;
    if (spawnTimer <= 0 && flying + incoming.length < maxPlanes()) {
      spawnTimer = trySpawn() ? spawnInterval() : 0.5;
    }
    for (const s of incoming) s.t -= dt;
    for (const s of incoming.filter(s => s.t <= 0)) addPlane(s);
    incoming = incoming.filter(s => s.t > 0);

    // 移動
    for (const p of planes) {
      p.spin += dt * 40;
      if (p.state === 'landing') updateLanding(p, dt);
      else advance(p, p.T.speed * dt);
      p.heading += angleDiff(p.dir, p.heading) * Math.min(1, dt * 9);
    }
    planes = planes.filter(p => !(p.state === 'landing' && p.lt > 2.6));
    if (state !== 'play') return; // この移動でステージクリアになった

    // 燃料（着陸が決まった機は滑走路まで持つことにして減らさない）
    let anyLow = false;
    for (const p of planes) {
      if (p.state !== 'fly' || p.fuel === null || p.rw) continue;
      p.fuel -= dt;
      if (p.fuel <= 0) { fuelOut(p); return; }
      if (lowFuel(p)) anyLow = true;
    }
    fuelBeepT -= dt;
    if (anyLow && fuelBeepT <= 0) { sfx.lowFuel(); fuelBeepT = 1.2; }

    // 接近と衝突
    const air = planes.filter(p => p.state === 'fly');
    for (const p of air) p.warn = false;
    let anyWarn = false;
    for (let i = 0; i < air.length; i++) {
      for (let j = i + 1; j < air.length; j++) {
        const a = air[i], b = air[j];
        const d = dist(a.x, a.y, b.x, b.y), rr = a.T.r + b.T.r;
        if (d < rr * 0.85) { crash(a, b); return; }
        if (d < rr * 2.8) { a.warn = b.warn = true; anyWarn = true; }
      }
    }
    beepT -= dt;
    if (anyWarn && beepT <= 0) { sfx.warn(); beepT = 0.5; }
  }

  // 線があれば線に沿って、なければまっすぐ飛ぶ
  function advance(p, d) {
    while (d > 0 && p.path.length) {
      const t = p.path[0];
      const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy);
      if (len > 0.01) p.dir = Math.atan2(dy, dx);
      if (len <= d) {
        p.x = t.x; p.y = t.y; d -= len;
        p.path.shift();
        if (t.td) { touchdown(p); return; }
      } else {
        p.x += dx / len * d; p.y += dy / len * d; d = 0;
      }
    }
    if (d > 0) { p.x += Math.cos(p.dir) * d; p.y += Math.sin(p.dir) * d; }

    const r = p.T.r;
    if (!p.entered && p.x > r && p.x < W - r && p.y > r && p.y < H - r) p.entered = true;
    // 画面の端に来たら跳ね返る（線を描いていないときだけ。線は画面内に収めている）
    if (p.entered && !p.path.length) {
      const c = Math.cos(p.dir), s = Math.sin(p.dir);
      if ((p.x < r && c < 0) || (p.x > W - r && c > 0)) p.dir = Math.PI - p.dir;
      if ((p.y < r && s < 0) || (p.y > H - r && s > 0)) p.dir = -p.dir;
    }
  }

  function touchdown(p) {
    p.state = 'landing';
    p.lt = 0;
    p.path = [];
    for (const [id, q] of drags) if (q === p) drags.delete(id);
    const gain = p.mayday ? MAYDAY_BONUS : 1;
    landed += gain;
    texts.push({ x: p.x, y: p.y - 20, text: '+' + gain, color: p.mayday ? MAYDAY_COLOR : p.T.color, t: p.mayday ? 1.8 : 1.2 });
    if (p.mayday) showToast('緊急機 着陸成功！');
    if (landed >= stage().goal) stageClear();
    else sfx.land();
    if (isEndless() && landed > best()) {
      if (!newRecord && best() > 0) showToast('ベスト更新！');
      newRecord = true;
      bests[endlessRw] = landed;
      save(BEST_KEY[endlessRw], landed);
    }
  }

  // 目標の機数に届いたら、その場で空を止めてクリアの演出へ
  function stageClear() {
    state = 'clear';
    clearT = 0;
    drags.clear();
    incoming = [];
    if (stageNo + 1 > unlocked && stageNo + 1 < STAGES.length) { unlocked = stageNo + 1; saveUnlocked(); }
    if (stageNo === STAGES.length - 1 && !endlessOpen) { endlessOpen = true; save('airportline.endless', 1); }
    sfx.clear();
  }

  function updateLanding(p, dt) {
    p.lt += dt;
    const rw = p.rw;
    const k = Math.min(1, p.lt / 2.2);
    const spd = p.T.speed * (1 - 0.75 * k);
    p.dir = rw.a;
    p.x += rw.dx * spd * dt;
    p.y += rw.dy * spd * dt;
    // 中心線に寄せる
    const px = p.x - rw.x, py = p.y - rw.y, across = -px * rw.dy + py * rw.dx;
    const pull = Math.min(1, dt * 4) * across;
    p.x += rw.dy * pull; p.y -= rw.dx * pull;
  }

  function crash(a, b) {
    a.crashed = b.crashed = true;
    explode((a.x + b.x) / 2, (a.y + b.y) / 2, 'crash');
  }
  function fuelOut(p) {
    p.crashed = true;
    explode(p.x, p.y, 'fuel');
  }
  function explode(cx, cy, reason) {
    state = 'crash';
    crashT = 0;
    overReason = reason;
    drags.clear();
    for (let i = 0; i < 70; i++) {
      const ang = rand(0, Math.PI * 2), sp = rand(20, 160);
      particles.push({
        x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        t: rand(0.6, 1.6), max: 1.6, r: rand(2, 6),
        color: ['#fff3a0', '#ffb43c', '#ff6a3c', '#555'][i % 4],
      });
    }
    sfx.crash();
  }

  function updateEffects(dt) {
    for (const q of particles) {
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 1 - dt * 2; q.vy *= 1 - dt * 2;
      q.t -= dt;
    }
    particles = particles.filter(q => q.t > 0);
    for (const t of texts) { t.y -= dt * 24; t.t -= dt; }
    texts = texts.filter(t => t.t > 0);
  }

  function showToast(text) {
    if (toast && toast.text === text) { toast.t = 2; return; }
    toast = { text, t: 2 };
  }

  // ---------- 線を描く ----------
  function toWorld(cx, cy) {
    const r = canvas.getBoundingClientRect();
    return { x: (cx - r.left - offX) / scale, y: (cy - r.top - offY) / scale };
  }

  function pointerDown(cx, cy, id) {
    unlockAudio();
    if (state !== 'play') return;
    const pt = toWorld(cx, cy);
    const busy = new Set(drags.values());
    let pick = null, bd = PICK;
    for (const p of planes) {
      if (p.state !== 'fly' || busy.has(p)) continue;
      const d = dist(p.x, p.y, pt.x, pt.y);
      if (d < bd) { bd = d; pick = p; }
    }
    if (!pick) return;
    pick.path = [];
    pick.rw = null;
    pick.hinted = false;
    drags.set(id, pick);
    sfx.grab();
  }

  function pointerMove(cx, cy, id) {
    const p = drags.get(id);
    if (!p || state !== 'play') return;
    const w = toWorld(cx, cy);
    const pt = { x: clamp(w.x, 12, W - 12), y: clamp(w.y, 12, H - 12) };
    const last = p.path[p.path.length - 1] || p;
    const d = dist(last.x, last.y, pt.x, pt.y);
    if (d < STEP) return;
    // 指を速く動かしても点の間隔がそろうように、間を埋める
    const n = Math.floor(d / STEP);
    for (let i = 1; i <= n; i++) {
      const q = { x: last.x + (pt.x - last.x) * i / n, y: last.y + (pt.y - last.y) * i / n };
      p.path.push(q);
      const rw = checkRunway(p, q);
      if (rw) {
        p.path.push({ x: rw.thx, y: rw.thy, td: true });
        p.rw = rw;
        smoothPath(p);
        drags.delete(id);
        sfx.lock();
        return;
      }
    }
  }

  function pointerUp(id) { drags.delete(id); }

  // 滑走路までつながった線を、指のぶれを取ったなめらかな曲線に引き直す
  // （飛行機の今の位置と滑走路の入口はそのまま。点の間隔も STEP にそろえ直す）
  function smoothPath(p) {
    const end = p.path[p.path.length - 1];
    let pts = [{ x: p.x, y: p.y }, ...p.path.slice(0, -1).map(q => ({ x: q.x, y: q.y })), { x: end.x, y: end.y }];
    if (pts.length < 4) return;
    // 両端を止めたまま、となりの点との平均を何度も取る
    for (let k = 0; k < 8; k++) {
      pts = pts.map((q, i) => {
        if (i === 0 || i === pts.length - 1) return q;
        const a = pts[i - 1], b = pts[i + 1];
        return { x: (a.x + q.x * 2 + b.x) / 4, y: (a.y + q.y * 2 + b.y) / 4 };
      });
    }
    // 曲線に沿って STEP ごとに点を置き直す
    const out = [];
    let t = STEP;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = dist(a.x, a.y, b.x, b.y);
      for (; t < len; t += STEP) out.push({ x: a.x + (b.x - a.x) * t / len, y: a.y + (b.y - a.y) * t / len });
      t -= len;
    }
    const tail = out[out.length - 1];
    if (tail && dist(tail.x, tail.y, end.x, end.y) < STEP / 2) out.pop();
    out.push(end);
    p.path = out;
  }

  // 線の先が滑走路の入口に、正しい向きで届いたか
  function checkRunway(p, q) {
    for (const rw of runways) {
      if (dist(q.x, q.y, rw.thx, rw.thy) > ENTRY) continue;
      // 少し手前の点から見た進入方向
      let ref = p;
      for (let i = p.path.length - 1; i >= 0; i--) {
        if (dist(q.x, q.y, p.path[i].x, p.path[i].y) >= 24) { ref = p.path[i]; break; }
      }
      const dx = q.x - ref.x, dy = q.y - ref.y, len = Math.hypot(dx, dy) || 1;
      const dot = (dx * rw.dx + dy * rw.dy) / len;
      if (!canLand(p, rw)) {
        if (!p.hinted) { showToast('旅客機は「長い」滑走路へ！'); p.hinted = true; }
        continue;
      }
      if (dot < 0.4) {
        if (!p.hinted) { showToast('滑走路には ▶ の向きから進入しよう'); p.hinted = true; }
        continue;
      }
      return rw;
    }
    return null;
  }

  // タッチは touch イベント、マウスは pointer イベントで受け取る（iOS でスクロール扱いにされないように）
  const opts = { passive: false };
  const eachTouch = (e, fn) => { for (let i = 0; i < e.changedTouches.length; i++) fn(e.changedTouches[i]); };
  canvas.addEventListener('touchstart', e => { e.preventDefault(); eachTouch(e, t => pointerDown(t.clientX, t.clientY, t.identifier)); }, opts);
  canvas.addEventListener('touchmove', e => { e.preventDefault(); eachTouch(e, t => pointerMove(t.clientX, t.clientY, t.identifier)); }, opts);
  const touchEnd = e => { e.preventDefault(); eachTouch(e, t => pointerUp(t.identifier)); };
  canvas.addEventListener('touchend', touchEnd, opts);
  canvas.addEventListener('touchcancel', touchEnd, opts);
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointerDown(e.clientX, e.clientY, 'mouse');
  });
  canvas.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') pointerMove(e.clientX, e.clientY, 'mouse'); });
  const mouseUp = e => { if (e.pointerType !== 'touch') pointerUp('mouse'); };
  canvas.addEventListener('pointerup', mouseUp);
  canvas.addEventListener('pointercancel', mouseUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- 画面（タイトル・ポーズ・ゲームオーバー） ----------
  function showOverlay(html) {
    overlay.innerHTML = `<div class="panel">${html}</div>`;
    overlay.classList.remove('hidden');
    pauseBtn.style.visibility = 'hidden';
    buttonsBox.classList.remove('playing');
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    pauseBtn.style.visibility = '';
    buttonsBox.classList.add('playing');
  }
  function bindButtons(map) {
    for (const [id, fn] of Object.entries(map)) {
      overlay.querySelector('#' + id).addEventListener('click', () => { unlockAudio(); fn(); });
    }
    overlay.querySelectorAll('[data-speed]').forEach(b => {
      b.addEventListener('click', () => setSpeed(+b.dataset.speed));
    });
    overlay.querySelectorAll('[data-opt]').forEach(b => {
      b.addEventListener('click', () => toggleOpt(b.dataset.opt));
    });
  }

  // ---------- スピード設定 ----------
  const speedLabel = v => '×' + v;
  function speedRow() {
    return `<div class="speeds">スピード<div>${SPEEDS.map(v =>
      `<button class="sp${v === gameSpeed ? ' on' : ''}" data-speed="${v}">${speedLabel(v)}</button>`).join('')}</div></div>`;
  }
  function setSpeed(v) {
    gameSpeed = v;
    speedBtn.textContent = speedLabel(v);
    overlay.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === v));
    try { localStorage.setItem('airportline.speed', String(v)); } catch (e) { /* 無視 */ }
    if (state === 'play') showToast(`スピード ${speedLabel(v)}`);
  }
  function stepSpeed(d) {
    const i = SPEEDS.indexOf(gameSpeed);
    setSpeed(SPEEDS[clamp(i + d, 0, SPEEDS.length - 1)]);
  }
  setSpeed(gameSpeed);

  // ---------- オプション（燃料・緊急機） ----------
  const OPT_LABEL = { fuel: '燃料', mayday: '緊急機' };
  function optionRow() {
    return `<div class="speeds">オプション<div>${Object.keys(OPT_LABEL).map(k =>
      `<button class="sp${options[k] ? ' on' : ''}" data-opt="${k}">${OPT_LABEL[k]} ${options[k] ? 'ON' : 'OFF'}</button>`).join('')}</div>
      <small class="optnote">燃料：待たせすぎると燃料切れで墜落<br>緊急機：燃料が少ない赤い機。降ろすと +${MAYDAY_BONUS}</small></div>`;
  }
  function toggleOpt(k) {
    options[k] = !options[k];
    save('airportline.' + k, options[k] ? 1 : 0);
    overlay.querySelectorAll(`[data-opt="${k}"]`).forEach(b => {
      b.classList.toggle('on', options[k]);
      b.textContent = `${OPT_LABEL[k]} ${options[k] ? 'ON' : 'OFF'}`;
    });
  }

  function showTitle() {
    state = 'title';
    setStage(unlocked);
    const stageButtons = STAGES.map((_, i) =>
      `<button class="st${i === unlocked ? ' on' : ''}" data-stage="${i}"${i > unlocked ? ' disabled' : ''}>${i + 1}</button>`).join('') +
      `<button class="st endless" data-stage="${ENDLESS}"${endlessOpen ? '' : ' disabled'} aria-label="ハイスコアモード">∞</button>`;
    showOverlay(`
      <h1>エアポート管制官</h1>
      <p>飛行機を指（マウス）でなぞって線を引き、滑走路まで誘導しよう！</p>
      <ul class="rules">
        <li><span class="jet">■ 旅客機</span>（速い）→ <span class="jet">青い長い滑走路</span>だけ</li>
        <li><span class="prop">■ プロペラ機</span>（遅い）→ <span class="prop">オレンジの短い滑走路</span>でも<span class="jet">長い滑走路</span>でもOK</li>
        <li>滑走路には <b>▶ の矢印の向き</b>からしか降りられません</li>
        <li>線が入口につながると色が変わり、着陸が決まります</li>
        <li>目標の機数を着陸させるとステージクリア。ぶつかったらゲームオーバー</li>
        <li>オプションで<b>燃料</b>（まわりの輪が減っていき、切れると墜落）と<b class="mayday">緊急機</b>を出せます</li>
      </ul>
      <button id="go">${unlocked > 0 ? `つづきから（ステージ ${unlocked + 1}）` : 'はじめる'}</button>
      <div class="stages">ステージを選ぶ<div>${stageButtons}</div></div>
      <p class="best">${endlessOpen
        ? `∞ ハイスコアモードのベスト<br>${[1, 2, 3].map(n => `滑走路${n}本 <span class="score">${bests[n]}</span>`).join('　')}`
        : '∞ ハイスコアモードはステージ8をクリアすると遊べます'}</p>
      ${speedRow()}
      ${optionRow()}
      <p><a href="../index.html">← ゲーム一覧へ</a></p>`);
    bindButtons({ go: () => showStageIntro(unlocked) });
    overlay.querySelectorAll('[data-stage]').forEach(b => {
      b.addEventListener('click', () => { unlockAudio(); showStageIntro(+b.dataset.stage); });
    });
  }

  function stageInfo(n) {
    const st = n === ENDLESS ? endlessStage() : STAGES[n];
    const kinds = st.prop > 0
      ? `<span class="jet">旅客機</span>・<span class="prop">プロペラ機</span>`
      : `<span class="jet">旅客機</span>のみ`;
    const longs = st.runways.filter(id => RUNWAY_DEFS[id].kind === 'long').length;
    const shorts = st.runways.length - longs;
    const runwayRow = n !== ENDLESS ? '' : `<div class="stages">滑走路の数<div>${[1, 2, 3].map(k =>
      `<button class="st rw${k === endlessRw ? ' on' : ''}" data-rw="${k}">${k}本<small>ベスト ${bests[k]}</small></button>`).join('')}</div></div>`;
    return `${runwayRow}
      <p class="goal">${n === ENDLESS
        ? `ベスト：<span class="score">${best()}</span> 機`
        : `目標：<span class="score">${st.goal}</span> 機 着陸`}</p>
      <p>飛行機：${kinds}<br>滑走路：<span class="jet">長い ${longs} 本</span>${shorts ? `・<span class="prop">短い ${shorts} 本</span>` : ''}</p>
      <p class="note">${st.note}</p>`;
  }

  function showStageIntro(n) {
    setStage(n);
    state = 'intro';
    showOverlay(`
      <h1>${stageName(n)}</h1>
      ${stageInfo(n)}
      <button id="start">スタート</button><br>
      <button id="title" class="sub">タイトルへ</button>
      ${speedRow()}
      ${optionRow()}`);
    bindButtons({ start: startStage, title: showTitle });
    overlay.querySelectorAll('[data-rw]').forEach(b => {
      b.addEventListener('click', () => {
        endlessRw = +b.dataset.rw;
        save('airportline.endlessRw', endlessRw);
        showStageIntro(ENDLESS); // 後ろの滑走路も並べ直す
      });
    });
  }

  function stageName(n) { return n === ENDLESS ? 'ハイスコアモード' : `ステージ ${n + 1}`; }

  function showClear() {
    const last = stageNo === STAGES.length - 1;
    if (last) {
      showOverlay(`
        <h1>全ステージクリア！</h1>
        <p>すべての飛行機を無事に着陸させました。<br>おつかれさまでした、管制官！</p>
        <p><b>ハイスコアモード</b>が遊べるようになりました。<br>ぶつかるまで、何機着陸させられるかな？</p>
        <button id="endless">ハイスコアモードへ</button><br>
        <button id="again" class="sub">ステージ ${stageNo + 1} をもう一度</button>
        <button id="title" class="sub">タイトルへ</button>`);
      bindButtons({ endless: () => showStageIntro(ENDLESS), again: () => showStageIntro(stageNo), title: showTitle });
      return;
    }
    showOverlay(`
      <h1>ステージ ${stageNo + 1} クリア！</h1>
      <p>次は <b>ステージ ${stageNo + 2}</b></p>
      ${stageInfo(stageNo + 1)}
      <button id="next">ステージ ${stageNo + 2} へ</button><br>
      <button id="title" class="sub">タイトルへ</button>
      ${speedRow()}`);
    bindButtons({ next: () => { setStage(stageNo + 1); startStage(); }, title: showTitle });
  }

  function showPause() {
    if (state !== 'play') return;
    state = 'pause';
    drags.clear();
    showOverlay(`
      <h1>ポーズ</h1>
      <p>${isEndless()
        ? `ハイスコアモード（滑走路${endlessRw}本）　着陸：<span class="score">${landed}</span> 機（ベスト ${best()}）`
        : `ステージ ${stageNo + 1}　着陸：<span class="score">${landed}</span> / ${stage().goal} 機`}</p>
      <button id="resume">つづける</button><br>
      <button id="restart" class="sub">やり直す</button>
      <button id="title" class="sub">タイトルへ</button>
      ${speedRow()}`);
    bindButtons({ resume: resume, restart: () => showStageIntro(stageNo), title: showTitle });
  }
  function resume() {
    if (state !== 'pause') return;
    state = 'play';
    hideOverlay();
  }

  function showOver() {
    const head = overReason === 'fuel' ? '燃料切れ！' : '衝突！';
    if (isEndless()) {
      showOverlay(`
        <h2>${head}</h2>
        <p>ハイスコアモード（滑走路${endlessRw}本）　着陸させた飛行機</p>
        <p class="score">${landed} 機</p>
        <p>${newRecord ? '<b class="record">ベスト更新！</b>' : `ベスト ${best()} 機`}</p>
        <button id="again">もう一度</button><br>
        <button id="title" class="sub">タイトルへ</button>
        ${speedRow()}
        ${optionRow()}`);
      bindButtons({ again: () => { setStage(stageNo); startStage(); }, title: showTitle });
      return;
    }
    showOverlay(`
      <h2>${head}</h2>
      <p>ステージ ${stageNo + 1}　着陸させた飛行機</p>
      <p class="score">${landed} / ${stage().goal} 機</p>
      <button id="again">もう一度</button><br>
      <button id="title" class="sub">タイトルへ</button>
      ${speedRow()}
      ${optionRow()}`);
    bindButtons({ again: () => { setStage(stageNo); startStage(); }, title: showTitle });
  }

  pauseBtn.addEventListener('click', () => { unlockAudio(); showPause(); });
  speedBtn.addEventListener('click', () => {
    unlockAudio();
    const i = SPEEDS.indexOf(gameSpeed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  });
  soundBtn.addEventListener('click', () => {
    unlockAudio();
    muted = !muted;
    soundBtn.classList.toggle('off', muted);
    try { localStorage.setItem('airportline.muted', muted ? '1' : '0'); } catch (e) { /* 無視 */ }
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (state === 'play') showPause(); else if (state === 'pause') resume();
    } else if (e.key === '+' || e.key === '=' || e.key === ';') {
      stepSpeed(1);
    } else if (e.key === '-') {
      stepSpeed(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      const btn = overlay.querySelector('button:not(.sp):not(.st)');
      if (btn && !overlay.classList.contains('hidden')) { e.preventDefault(); btn.click(); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) showPause(); });

  // ---------- 描画 ----------
  function draw() {
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d3a24';
    ctx.fillRect(0, 0, cw, ch);
    // 上の帯との境目
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, offY - 2, cw, 2);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawGround();
    const dragging = new Set(drags.values());
    for (const rw of runways) drawRunway(rw, dragging);
    for (const p of planes) drawPath(p);
    for (const p of planes.filter(p => p.state === 'landing')) drawPlane(p, dragging);
    for (const p of planes.filter(p => p.state !== 'landing')) drawPlane(p, dragging);
    for (const s of incoming) drawIncoming(s);
    for (const q of particles) {
      ctx.globalAlpha = Math.max(0, q.t / q.max);
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const t of texts) {
      ctx.globalAlpha = Math.min(1, t.t * 2);
      ctx.font = 'bold 22px DotGothic16, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawHud(cw, ch);
  }

  function drawGround() {
    ctx.fillStyle = '#3f7d46';
    ctx.fillRect(0, 0, W, H);
    for (const d of decor) {
      if (d.kind !== 'field') continue;
      ctx.save();
      ctx.translate(d.x, d.y); ctx.rotate(d.a);
      ctx.fillStyle = d.c < 0.5 ? 'rgba(90,150,80,0.35)' : 'rgba(40,90,45,0.3)';
      ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      ctx.restore();
    }
    for (const d of decor) {
      if (d.kind !== 'tree') continue;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.arc(d.x + 3, d.y + 4, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a5e33';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#357040';
      ctx.beginPath(); ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawRunway(rw, dragging) {
    const hl = rw.len / 2, hw = rw.wid / 2;
    ctx.save();
    ctx.translate(rw.x, rw.y);
    ctx.rotate(rw.a);
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(-hl - 6, -hw - 6, rw.len + 12, rw.wid + 12);
    ctx.fillStyle = '#50555e';
    ctx.fillRect(-hl, -hw, rw.len, rw.wid);
    ctx.fillStyle = rw.color;
    ctx.fillRect(-hl, -hw, rw.len, 2.5);
    ctx.fillRect(-hl, hw - 2.5, rw.len, 2.5);
    // 入口のしま模様
    ctx.fillStyle = '#f4f4f4';
    const n = rw.kind === 'long' ? 6 : 4, gap = (rw.wid - 8) / n;
    for (let i = 0; i < n; i++) ctx.fillRect(-hl + 5, -hw + 4 + i * gap + gap * 0.2, 16, gap * 0.6);
    // 中心線
    for (let x = -hl + 32; x < hl - 14; x += 24) ctx.fillRect(x, -1, 13, 2);
    // 奥のしるし
    ctx.fillRect(hl - 6, -hw + 3, 2, rw.wid - 6);
    // 進入方向の矢印（流れるように光る）
    for (let i = 0; i < 3; i++) {
      const x = -hl - 14 - i * 15;
      const glow = (Math.sin(clock * 5 + i * 1.2) + 1) / 2;
      ctx.globalAlpha = 0.45 + 0.55 * glow;
      ctx.fillStyle = rw.color;
      ctx.beginPath();
      ctx.moveTo(x + 6, 0); ctx.lineTo(x - 4, -8); ctx.lineTo(x - 4, 8);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 対応する飛行機の線を描いている間は、入口を光らせる
    if ([...dragging].some(p => canLand(p, rw))) {
      ctx.strokeStyle = rw.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(clock * 8);
      ctx.beginPath(); ctx.arc(rw.thx, rw.thy, ENTRY, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ラベル（滑走路の横に、回転させずに書く）
    const lx = rw.x - rw.dy * (hw + 22), ly = rw.y + rw.dx * (hw + 22);
    ctx.font = '15px DotGothic16, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = rw.kind === 'short' ? 'プロペラ機' : hasProps() ? '旅客機・プロペラ機' : '旅客機';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(label, lx, ly);
    ctx.fillStyle = rw.color; ctx.fillText(label, lx, ly);
    ctx.textBaseline = 'alphabetic';
  }

  function drawPath(p) {
    if (!p.path.length || p.state !== 'fly') return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    for (const q of p.path) ctx.lineTo(q.x, q.y);
    if (p.rw) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = p.T.color; ctx.lineWidth = 3.5; ctx.stroke();
    } else {
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -clock * 30;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlane(p, dragging) {
    let size = 1, alpha = 1, lift = 1;
    if (p.state === 'landing') {
      size = 1 - 0.3 * Math.min(1, p.lt / 1.2);
      lift = Math.max(0, 1 - p.lt / 0.9);
      alpha = p.lt > 2 ? Math.max(0, 1 - (p.lt - 2) / 0.6) : 1;
    }
    const r = p.T.r * size;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 影
    ctx.save();
    ctx.translate(p.x + 6 * lift, p.y + 9 * lift);
    ctx.rotate(p.heading);
    planeShape(p, r, 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.28)', null);
    ctx.restore();
    // 接近警告・つかんでいる印・燃料
    if (p.state === 'fly') {
      if (p.fuel !== null) drawFuel(p, alpha);
      if (p.mayday && !p.crashed) {
        ctx.fillStyle = MAYDAY_COLOR;
        ctx.globalAlpha = alpha * (0.5 + 0.3 * Math.sin(clock * 8));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.T.r * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 14px DotGothic16, monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('SOS', p.x, p.y - p.T.r * 2.3 - 6);
        ctx.fillStyle = MAYDAY_COLOR; ctx.fillText('SOS', p.x, p.y - p.T.r * 2.3 - 6);
      }
      if (p.warn || p.crashed) {
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = alpha * (p.crashed ? 1 : 0.55 + 0.45 * Math.sin(clock * 18));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.T.r * 1.9, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      if (dragging.has(p)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.T.r * 1.55, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading);
    planeShape(p, r, p.T.color, '#f4f6fa', p);
    ctx.restore();
  }

  // 燃料の残り：機体のまわりの輪が時計回りに減っていく。残りわずかで赤く点滅
  function drawFuel(p, alpha) {
    const k = clamp(p.fuel / p.fuelMax, 0, 1), R = p.T.r * 2.3;
    const low = lowFuel(p);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = low ? MAYDAY_COLOR : k < 0.6 ? '#ffd84a' : '#7dff9a';
    ctx.globalAlpha = alpha * (low ? 0.5 + 0.5 * Math.sin(clock * (8 + 10 * (1 - k / LOW_FUEL))) : 0.85);
    ctx.beginPath(); ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // 機首を +x に向けた飛行機の形。p を渡すとプロペラも回す
  function planeShape(pl, r, wing, body, p) {
    const outline = p ? 'rgba(0,0,0,0.55)' : null;
    const fillStroke = (fill) => {
      ctx.fillStyle = fill; ctx.fill();
      if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke(); }
    };
    if (pl.type === 'jet') {
      // 後退翼
      ctx.beginPath();
      ctx.moveTo(0.3 * r, 0.12 * r); ctx.lineTo(-0.35 * r, 1.25 * r); ctx.lineTo(-0.62 * r, 1.25 * r); ctx.lineTo(-0.3 * r, 0.12 * r);
      ctx.lineTo(-0.3 * r, -0.12 * r); ctx.lineTo(-0.62 * r, -1.25 * r); ctx.lineTo(-0.35 * r, -1.25 * r); ctx.lineTo(0.3 * r, -0.12 * r);
      ctx.closePath(); fillStroke(wing);
      // 尾翼
      ctx.beginPath();
      ctx.moveTo(-0.85 * r, 0); ctx.lineTo(-1.15 * r, 0.55 * r); ctx.lineTo(-1.32 * r, 0.55 * r); ctx.lineTo(-1.15 * r, 0);
      ctx.lineTo(-1.32 * r, -0.55 * r); ctx.lineTo(-1.15 * r, -0.55 * r);
      ctx.closePath(); fillStroke(wing);
      // 胴体
      ctx.beginPath(); ctx.ellipse(-0.05 * r, 0, 1.3 * r, 0.22 * r, 0, 0, Math.PI * 2); fillStroke(body);
      if (p) {
        // エンジンと操縦席
        ctx.fillStyle = '#9aa4b4';
        ctx.fillRect(-0.15 * r, 0.5 * r, 0.32 * r, 0.14 * r);
        ctx.fillRect(-0.15 * r, -0.64 * r, 0.32 * r, 0.14 * r);
        ctx.fillStyle = '#26364a';
        ctx.beginPath(); ctx.ellipse(1.0 * r, 0, 0.14 * r, 0.12 * r, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // まっすぐな主翼
      ctx.beginPath(); ctx.rect(-0.05 * r, -1.35 * r, 0.42 * r, 2.7 * r); fillStroke(wing);
      // 尾翼
      ctx.beginPath(); ctx.rect(-1.0 * r, -0.55 * r, 0.24 * r, 1.1 * r); fillStroke(wing);
      // 胴体
      ctx.beginPath(); ctx.ellipse(0, 0, 1.05 * r, 0.24 * r, 0, 0, Math.PI * 2); fillStroke(body);
      if (p) {
        ctx.fillStyle = '#26364a';
        ctx.beginPath(); ctx.ellipse(0.55 * r, 0, 0.16 * r, 0.14 * r, 0, 0, Math.PI * 2); ctx.fill();
        // 回るプロペラ
        ctx.fillStyle = 'rgba(220,220,220,0.35)';
        ctx.beginPath(); ctx.ellipse(1.12 * r, 0, 0.08 * r, 0.6 * r, 0, 0, Math.PI * 2); ctx.fill();
        const s = Math.sin(p.spin) * 0.6 * r;
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(1.12 * r, -s); ctx.lineTo(1.12 * r, s); ctx.stroke();
      }
    }
  }

  // もうすぐ飛行機が来る場所の印
  function drawIncoming(s) {
    const x = clamp(s.x, 22, W - 22), y = clamp(s.y, 22, H - 22);
    const T = TYPES[s.type];
    const blink = Math.sin(clock * (s.mayday ? 18 : 10)) > 0 ? 1 : 0.4;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.mayday ? MAYDAY_COLOR : T.color; ctx.lineWidth = s.mayday ? 4 : 3;
    ctx.beginPath(); ctx.arc(x, y, s.mayday ? 19 : 16, 0, Math.PI * 2); ctx.stroke();
    ctx.translate(x, y);
    ctx.rotate(s.dir);
    ctx.fillStyle = T.color;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawHud(cw, ch) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const safe = safeInsets();
    const top = 12 + safe.top, left = 14 + safe.left;
    ctx.font = '20px DotGothic16, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const line = (text, x, y, color) => {
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    };
    if (state !== 'title') {
      const endless = isEndless();
      line(endless ? `着陸 ${landed}` : `着陸 ${landed} / ${stage().goal}`, left, top, '#ffffff');
      ctx.font = '14px DotGothic16, monospace';
      line(endless ? `ベスト ${best()}（${endlessRw}本）` : `ステージ ${stageNo + 1}`, left, top + 26, newRecord ? '#7dff9a' : '#ffd84a');
      // 目標（ハイスコアモードではベスト）までの進み具合
      const bw = HUD_W - 14, bx = left, by = top + 46;
      const goal = endless ? best() : stage().goal;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, 6);
      ctx.fillStyle = newRecord ? '#7dff9a' : '#ffd84a';
      ctx.fillRect(bx, by, bw * (goal > 0 ? Math.min(1, landed / goal) : 0), 6);
    }
    if (state === 'clear') {
      ctx.font = '40px DotGothic16, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const k = Math.min(1, clearT * 3);
      ctx.globalAlpha = k;
      line('STAGE CLEAR!', cw / 2, ch / 2 - 20 * (1 - k), '#ffd84a');
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'top';
    }
    if (toast) {
      ctx.font = '17px DotGothic16, monospace';
      ctx.textAlign = 'center';
      const w = ctx.measureText(toast.text).width + 28;
      ctx.globalAlpha = Math.min(1, toast.t * 3);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const ty = ch - 64 - safe.bottom; // ホームバーにかからないように
      ctx.fillRect(cw / 2 - w / 2, ty, w, 34);
      ctx.fillStyle = '#fff';
      ctx.fillText(toast.text, cw / 2, ty + 8);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ノッチやホームバーをよける余白（横持ちでは左右にも付く）
  let safeCache = null;
  function safeInsets() {
    if (safeCache === null) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;' +
        'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      safeCache = {
        top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0,
        left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0,
      };
      probe.remove();
    }
    return safeCache;
  }

  // ---------- メインループ ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { safeCache = null; resize(); });
  resize();
  showTitle();
  requestAnimationFrame(frame);

  // 動作確認用（ブラウザのコンソールから状態を見られるように）
  window.airportLine = {
    get state() { return state; }, get planes() { return planes; }, get runways() { return runways; },
    get landed() { return landed; }, get stage() { return stageNo; }, get speed() { return gameSpeed; }, get world() { return { W, H, scale, offX, offY }; },
  };
})();
