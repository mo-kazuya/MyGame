'use strict';
// エアポート・ライン：指やマウスで描いた線で飛行機を誘導し、滑走路に着陸させるラインドローゲーム。
// 速い旅客機は長い滑走路へ、遅いプロペラ機はどちらの滑走路にも降りられる。ぶつかったらゲームオーバー。
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

  const BASE = 600;       // 画面の短い辺のワールドでの長さ
  const MAX_LONG = 1400;  // 長い辺の上限（これより横長の画面では左右に余白を作る）
  const PICK = 46;        // 飛行機をつかめる距離
  const ENTRY = 30;       // 滑走路の入口に線をつなげたとみなす距離
  const STEP = 7;         // 線の点の間隔

  const TYPES = {
    jet:  { name: '旅客機',     speed: 46, r: 15, color: '#4fa8ff', runways: ['long'] },
    prop: { name: 'プロペラ機', speed: 24, r: 11, color: '#ffb43c', runways: ['long', 'short'] },
  };
  const canLand = (p, rw) => p.T.runways.includes(rw.kind);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]; // 全体のスピード（ゲームの時間の進み方）
  const RUNWAY_COLOR = { long: TYPES.jet.color, short: TYPES.prop.color };

  let W = 900, H = 600, scale = 1, offX = 0, offY = 0, dpr = 1, portrait = false;
  let runways = [], decor = [];
  let planes = [], incoming = [], particles = [], texts = [];
  let state = 'title'; // title / play / pause / crash / over
  let landed = 0, best = loadBest(), elapsed = 0, spawnTimer = 0, crashT = 0, beepT = 0, clock = 0;
  let toast = null;
  let gameSpeed = loadSpeed();
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
  function loadBest() {
    try { return +localStorage.getItem('airportline.best') || 0; } catch (e) { return 0; }
  }
  function loadSpeed() {
    try {
      const v = +localStorage.getItem('airportline.speed');
      return SPEEDS.includes(v) ? v : 1;
    } catch (e) { return 1; }
  }
  function saveBest() {
    try { localStorage.setItem('airportline.best', String(best)); } catch (e) { /* 保存できなくても遊べる */ }
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
    crash: () => { tone(200, 0.8, 'sawtooth', 0.2, 40); tone(90, 1.0, 'square', 0.15, 30, 0.05); },
  };

  // ---------- 画面サイズと滑走路の配置 ----------
  // 配置は横長の画面を基準に書き、縦長では x と y を入れ替える（対角線で折り返す）。
  const RUNWAY_DEFS = [
    { kind: 'long',  fx: 0.42, fy: 0.62, deg: -12, len: 290, wid: 30 },
    { kind: 'short', fx: 0.74, fy: 0.30, deg: 200, len: 160, wid: 24 },
  ];

  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const oldW = W, oldH = H, wasPortrait = portrait;
    portrait = ch > cw;
    scale = Math.min(cw, ch) / BASE;
    const long = Math.min(Math.max(cw, ch) / scale, MAX_LONG);
    W = portrait ? BASE : long;
    H = portrait ? long : BASE;
    offX = (cw - W * scale) / 2;
    offY = (ch - H * scale) / 2;
    buildLayout();
    remap(wasPortrait !== portrait, oldW, oldH);
  }

  function buildLayout() {
    const LW = Math.max(W, H), LH = Math.min(W, H);
    runways = RUNWAY_DEFS.map(d => {
      let x = d.fx * LW, y = d.fy * LH, a = d.deg * Math.PI / 180;
      if (portrait) { [x, y] = [y, x]; a = Math.PI / 2 - a; }
      const dx = Math.cos(a), dy = Math.sin(a);
      return {
        kind: d.kind, x, y, a, dx, dy, len: d.len, wid: d.wid, color: RUNWAY_COLOR[d.kind],
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
      if (p.rw) p.rw = runways.find(r => r.kind === p.rw.kind);
      const last = p.path[p.path.length - 1];
      if (last && last.td) { last.x = p.rw.thx; last.y = p.rw.thy; }
    }
    for (const s of incoming) { move(s); s.dir = turn(s.dir); }
    particles.forEach(move);
    texts.forEach(move);
  }

  // ---------- ゲームの進行 ----------
  function startGame() {
    planes = []; incoming = []; particles = []; texts = [];
    drags.clear();
    landed = 0; elapsed = 0; spawnTimer = 1; crashT = 0; toast = null;
    state = 'play';
    hideOverlay();
  }

  const spawnInterval = () => Math.max(2.3, 7 - landed * 0.17 - elapsed * 0.008);
  const maxPlanes = () => Math.min(11, 3 + Math.floor(landed / 3));

  // 画面の端に「もうすぐ来る」印を出し、少しあとで飛行機が入ってくる
  function trySpawn() {
    const type = Math.random() < 0.5 ? 'jet' : 'prop';
    for (let tries = 0; tries < 12; tries++) {
      const edge = Math.floor(Math.random() * 4), t = rand(0.1, 0.9), m = 40;
      const x = edge === 0 ? t * W : edge === 1 ? W + m : edge === 2 ? t * W : -m;
      const y = edge === 0 ? -m : edge === 1 ? t * H : edge === 2 ? H + m : t * H;
      if (planes.some(p => dist(p.x, p.y, x, y) < 170)) continue;
      if (incoming.some(s => dist(s.x, s.y, x, y) < 170)) continue;
      const tx = W * rand(0.3, 0.7), ty = H * rand(0.3, 0.7);
      incoming.push({ type, x, y, dir: Math.atan2(ty - y, tx - x), t: 2.5 });
      sfx.spawn();
      return true;
    }
    return false;
  }

  let nextId = 1;
  function addPlane(s) {
    planes.push({
      id: nextId++, type: s.type, T: TYPES[s.type], x: s.x, y: s.y,
      dir: s.dir, heading: s.dir, path: [], rw: null,
      state: 'fly', lt: 0, entered: false, warn: false, spin: 0,
    });
  }

  function update(dt) {
    clock += dt;
    if (toast && (toast.t -= dt) <= 0) toast = null;
    updateEffects(dt);
    if (state === 'crash') {
      crashT += dt;
      if (crashT > 1.8) { state = 'over'; showOver(); }
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
    landed++;
    if (landed > best) { best = landed; saveBest(); }
    texts.push({ x: p.x, y: p.y - 20, text: '+1', color: p.T.color, t: 1.2 });
    sfx.land();
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
    state = 'crash';
    crashT = 0;
    a.crashed = b.crashed = true;
    drags.clear();
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
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
        drags.delete(id);
        sfx.lock();
        return;
      }
    }
  }

  function pointerUp(id) { drags.delete(id); }

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
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    pauseBtn.style.visibility = '';
  }
  function bindButtons(map) {
    for (const [id, fn] of Object.entries(map)) {
      overlay.querySelector('#' + id).addEventListener('click', () => { unlockAudio(); fn(); });
    }
    overlay.querySelectorAll('[data-speed]').forEach(b => {
      b.addEventListener('click', () => setSpeed(+b.dataset.speed));
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

  function showTitle() {
    state = 'title';
    showOverlay(`
      <h1>エアポート・ライン</h1>
      <p>飛行機を指（マウス）でなぞって線を引き、滑走路まで誘導しよう！</p>
      <ul class="rules">
        <li><span class="jet">■ 旅客機</span>（速い）→ <span class="jet">青い長い滑走路</span>だけ</li>
        <li><span class="prop">■ プロペラ機</span>（遅い）→ <span class="prop">オレンジの短い滑走路</span>でも<span class="jet">長い滑走路</span>でもOK</li>
        <li>滑走路には <b>▶ の矢印の向き</b>からしか降りられません</li>
        <li>線が入口につながると色が変わり、着陸が決まります</li>
        <li>飛行機どうしがぶつかったらゲームオーバー</li>
      </ul>
      <p>ベスト：<span class="score">${best}</span> 機</p>
      <button id="go">はじめる</button>
      ${speedRow()}
      <p><a href="../index.html">← 地底の竜 -XANADU-like- へ</a></p>`);
    bindButtons({ go: startGame });
  }

  function showPause() {
    if (state !== 'play') return;
    state = 'pause';
    drags.clear();
    showOverlay(`
      <h1>ポーズ</h1>
      <p>着陸：<span class="score">${landed}</span> 機</p>
      <button id="resume">つづける</button><br>
      <button id="restart" class="sub">はじめから</button>
      <button id="title" class="sub">タイトルへ</button>
      ${speedRow()}`);
    bindButtons({ resume: resume, restart: startGame, title: showTitle });
  }
  function resume() {
    if (state !== 'pause') return;
    state = 'play';
    hideOverlay();
  }

  function showOver() {
    showOverlay(`
      <h2>衝突！</h2>
      <p>着陸させた飛行機</p>
      <p class="score">${landed} 機</p>
      <p>${landed >= best && landed > 0 ? 'ベスト更新！' : `ベスト：${best} 機`}</p>
      <button id="again">もう一度</button><br>
      <button id="title" class="sub">タイトルへ</button>
      ${speedRow()}`);
    bindButtons({ again: startGame, title: showTitle });
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
      const btn = overlay.querySelector('button:not(.sp)');
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
    const label = rw.kind === 'long' ? '旅客機・プロペラ機' : 'プロペラ機';
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
    // 接近警告・つかんでいる印
    if (p.state === 'fly') {
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
    const blink = Math.sin(clock * 10) > 0 ? 1 : 0.4;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = T.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.translate(x, y);
    ctx.rotate(s.dir);
    ctx.fillStyle = T.color;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawHud(cw, ch) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const top = 12 + safeTop();
    ctx.font = '20px DotGothic16, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const line = (text, x, y, color) => {
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    };
    if (state !== 'title') {
      line(`着陸 ${landed}`, 14, top, '#ffffff');
      ctx.font = '14px DotGothic16, monospace';
      line(`ベスト ${best}`, 14, top + 26, '#ffd84a');
    }
    if (toast) {
      ctx.font = '17px DotGothic16, monospace';
      ctx.textAlign = 'center';
      const w = ctx.measureText(toast.text).width + 28;
      ctx.globalAlpha = Math.min(1, toast.t * 3);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(cw / 2 - w / 2, ch - 64, w, 34);
      ctx.fillStyle = '#fff';
      ctx.fillText(toast.text, cw / 2, ch - 56);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }

  let safeTopCache = null;
  function safeTop() {
    if (safeTopCache === null) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden';
      document.body.appendChild(probe);
      safeTopCache = probe.offsetHeight || 0;
      probe.remove();
    }
    return safeTopCache;
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

  window.addEventListener('resize', () => { safeTopCache = null; resize(); });
  resize();
  showTitle();
  requestAnimationFrame(frame);

  // 動作確認用（ブラウザのコンソールから状態を見られるように）
  window.airportLine = {
    get state() { return state; }, get planes() { return planes; }, get runways() { return runways; },
    get landed() { return landed; }, get speed() { return gameSpeed; }, get world() { return { W, H, scale, offX, offY }; },
  };
})();
