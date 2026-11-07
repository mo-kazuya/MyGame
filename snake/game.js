'use strict';
// くねくねスネーク：エサを食べて伸びていくヘビを操るゲーム。
(function () {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const field = document.getElementById('field');
  const overlay = document.getElementById('overlay');
  const $score = document.getElementById('score');
  const $len = document.getElementById('len');
  const $best = document.getElementById('best');
  const $pause = document.getElementById('pause');
  const $sound = document.getElementById('sound');

  // ---- 設定 ----
  const N = 20;                 // 盤面のマス数（N×N）
  const START_LEN = 4;
  const SPEEDS = {              // 1 マス進むのにかかる時間（ミリ秒）。食べるごとに少し速くなる
    slow: { name: 'ゆっくり', ms: 170, min: 110, step: 1.5, mul: 1 },
    normal: { name: 'ふつう', ms: 125, min: 75, step: 2, mul: 2 },
    fast: { name: 'はやい', ms: 85, min: 50, step: 1.5, mul: 3 },
  };
  const WALLS = {
    wall: { name: '壁あり' },   // 壁にぶつかると終わり
    wrap: { name: '通りぬけ' }, // 端から反対側へ出る
  };
  const MAPS = {
    open: { name: 'ひろば' },
    rocks: { name: '岩場' },    // 岩が置いてある
  };
  const STAR_EVERY = 5;         // エサをこの数食べるごとに金の星が出る
  const STAR_TIME = 40;         // 星が消えるまでのマス数（進んだ回数）
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  // ---- 保存 ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('snake.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('snake.' + k, String(v)); } catch (e) { /* 保存できなくても遊べる */ } },
  };
  const opts = { speed: 'normal', wall: 'wall', map: 'open' };
  for (const [k, table] of [['speed', SPEEDS], ['wall', WALLS], ['map', MAPS]]) {
    const v = store.get(k, opts[k]);
    if (table[v]) opts[k] = v;
  }
  const bestKey = () => `best.${opts.speed}.${opts.wall}.${opts.map}`;
  const getBest = () => Math.max(0, Math.floor(+store.get(bestKey(), 0) || 0));

  // ---- 音 ----
  let muted = store.get('muted', '0') === '1';
  let ac = null;
  function audio() {
    if (muted) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type = 'square', vol = 0.08, slide = 0, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    eat() { tone(520, 0.07, 'square', 0.07); tone(780, 0.08, 'square', 0.06, 0, 0.05); },
    star() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.09, 'triangle', 0.09, 0, i * 0.06)); },
    starOut() { tone(400, 0.15, 'triangle', 0.05, -200); },
    turn() { tone(220, 0.02, 'square', 0.02); },
    die() { tone(300, 0.5, 'sawtooth', 0.09, -250); tone(150, 0.6, 'square', 0.05, -100, 0.1); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.07, 0, i * 0.12)); },
  };
  function updateSoundBtn() { $sound.classList.toggle('off', muted); }
  $sound.addEventListener('click', () => {
    muted = !muted; store.set('muted', muted ? '1' : '0'); updateSoundBtn();
    if (!muted) sfx.eat();
  });
  updateSoundBtn();

  // ---- ゲームの状態 ----
  let state = 'title';   // title / play / pause / over
  let snake = [];        // [{x,y}]（先頭が頭）
  let dir = 'right';
  let queue = [];        // 先行入力（最大 3 つ）
  let grow = 0;
  let food = null;       // {x,y}
  let star = null;       // {x,y,t}
  let rocks = new Set(); // "x,y"
  let score = 0, eaten = 0, best = 0, newBest = false;
  let tickMs = 125, acc = 0, last = 0, flash = 0, deadAt = 0;
  let particles = [], popups = [], won = false;

  const key = (x, y) => x + ',' + y;

  function makeRocks() {
    rocks = new Set();
    if (opts.map !== 'rocks') return;
    // 左右対称に置いた岩のかたまり（スタート位置の行はあけておく）
    const pts = [
      [4, 4], [5, 4], [4, 5], [15, 4], [14, 4], [15, 5],
      [4, 15], [5, 15], [4, 14], [15, 15], [14, 15], [15, 14],
      [9, 6], [10, 6], [9, 13], [10, 13],
      [6, 9], [6, 10], [13, 9], [13, 10],
    ];
    for (const [x, y] of pts) rocks.add(key(x, y));
  }

  function occupied(x, y) {
    if (rocks.has(key(x, y))) return true;
    for (const s of snake) if (s.x === x && s.y === y) return true;
    return false;
  }
  function freeCell(avoid) {
    const free = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (occupied(x, y)) continue;
      if (avoid && avoid.x === x && avoid.y === y) continue;
      free.push({ x, y });
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function newGame() {
    makeRocks();
    const sy = Math.floor(N / 2);
    snake = [];
    for (let i = 0; i < START_LEN; i++) snake.push({ x: 6 - i, y: sy });
    dir = 'right'; queue = []; grow = 0;
    score = 0; eaten = 0; newBest = false; won = false;
    best = getBest();
    star = null; particles = []; flash = 0;
    tickMs = SPEEDS[opts.speed].ms; acc = 0;
    food = freeCell();
    state = 'play';
    hideOverlay();
    updateHud();
  }

  function updateHud() {
    $score.textContent = score;
    $len.textContent = snake.length;
    $best.textContent = Math.max(best, score);
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 4;
      particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, color });
    }
  }

  function step() {
    // 先行入力を 1 つ取り出す
    while (queue.length) {
      const d = queue.shift();
      if (d !== dir && d !== OPP[dir]) { dir = d; break; }
    }
    const head = snake[0];
    let nx = head.x + DIRS[dir][0], ny = head.y + DIRS[dir][1];
    if (opts.wall === 'wrap') {
      nx = (nx + N) % N; ny = (ny + N) % N;
    } else if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
      return die();
    }
    if (rocks.has(key(nx, ny))) return die();
    // しっぽは同じ回に動くので、伸びないときはしっぽのマスに入ってもよい
    const tailMoves = grow === 0;
    for (let i = 0; i < snake.length - (tailMoves ? 1 : 0); i++) {
      if (snake[i].x === nx && snake[i].y === ny) return die();
    }
    snake.unshift({ x: nx, y: ny });
    if (grow > 0) grow--; else snake.pop();

    const sp = SPEEDS[opts.speed];
    if (food && food.x === nx && food.y === ny) {
      eaten++; grow += 1;
      score += 10 * sp.mul;
      tickMs = Math.max(sp.min, tickMs - sp.step);
      burst(nx, ny, '#ff5a4a', 10);
      sfx.eat();
      food = freeCell();
      if (eaten % STAR_EVERY === 0 && !star) {
        const c = freeCell(food);
        if (c) star = { x: c.x, y: c.y, t: STAR_TIME };
      }
      if (!food) return win();
    }
    if (star) {
      if (star.x === nx && star.y === ny) {
        // 早く取るほど高得点
        const pts = (20 + Math.ceil(star.t / STAR_TIME * 80)) * sp.mul;
        score += pts; grow += 2;
        burst(nx, ny, '#ffd84a', 18);
        popups.push({ x: nx + 0.5, y: ny, text: '+' + pts, life: 1 });
        sfx.star();
        star = null;
      } else if (--star.t <= 0) {
        star = null; sfx.starOut();
      }
    }
    updateHud();
  }

  function finish() {
    best = getBest();
    if (score > best) { store.set(bestKey(), score); newBest = true; best = score; }
    updateHud();
  }
  function die() {
    state = 'over'; flash = 1; deadAt = performance.now();
    const h = snake[0];
    burst(h.x, h.y, '#9af07a', 24);
    sfx.die();
    finish();
    setTimeout(() => { if (state === 'over') showOver(false); }, 900);
  }
  function win() {
    state = 'over'; won = true; sfx.win(); finish();
    setTimeout(() => showOver(true), 600);
  }

  // ---- 入力 ----
  function turn(d) {
    if (state === 'title' || state === 'over') return;
    if (state === 'pause') { resume(); }
    const lastDir = queue.length ? queue[queue.length - 1] : dir;
    if (d === lastDir || d === OPP[lastDir]) return;
    if (queue.length < 3) { queue.push(d); sfx.turn(); }
  }
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };
  window.addEventListener('keydown', e => {
    if (KEYMAP[e.key]) { e.preventDefault(); turn(KEYMAP[e.key]); return; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      if (state === 'play') pause(); else if (state === 'pause') resume();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (state === 'title' || (state === 'over' && overlay.innerHTML)) { e.preventDefault(); newGame(); }
      else if (state === 'pause') { e.preventDefault(); resume(); }
    }
  });

  // 盤面をスワイプして向きを変える
  let touch = null;
  canvas.addEventListener('pointerdown', e => {
    touch = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  canvas.addEventListener('pointermove', e => {
    if (!touch || touch.id !== e.pointerId) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    touch.x = e.clientX; touch.y = e.clientY; // 続けてスワイプすると連続で曲がれる
  });
  const endTouch = () => { touch = null; };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  // 十字ボタン
  for (const b of document.querySelectorAll('#pad button')) {
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); turn(b.dataset.dir);
      b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120);
    });
  }

  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    showOverlay(`<h2>ポーズ</h2>
      <p>スコア ${score}・長さ ${snake.length}</p>
      <button class="go" data-act="resume">▶ つづける</button><br>
      <button class="sub" data-act="title">タイトルへ</button>`);
  }
  function resume() {
    if (state !== 'pause') return;
    state = 'play'; acc = 0; last = performance.now(); hideOverlay();
  }
  $pause.addEventListener('click', () => { if (state === 'play') pause(); else if (state === 'pause') resume(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', () => pause());

  // ---- 画面（タイトル・ゲームオーバー） ----
  function showOverlay(html) { overlay.innerHTML = `<div class="panel">${html}</div>`; overlay.classList.remove('hidden'); }
  function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

  function optRow(name, label, table) {
    return `<div class="opt"><span class="lbl">${label}</span><div class="row">${
      Object.entries(table).map(([k, v]) => `<button data-opt="${name}" data-val="${k}" class="${opts[name] === k ? 'on' : ''}">${v.name}</button>`).join('')
    }</div></div>`;
  }
  function showTitle() {
    state = 'title';
    best = getBest(); updateHud();
    showOverlay(`<h1>くねくねスネーク</h1>
      <ul class="rules">
        <li>ヘビを操って <span style="color:#ff7a6a">●エサ</span> を食べよう。食べるたびに体が伸びて、少しずつ速くなる</li>
        <li>壁・岩・自分の体にぶつかったら終わり</li>
        <li>エサを ${STAR_EVERY} 個食べるごとに <span style="color:#ffd84a">★金の星</span> が出る。消える前に取ると大きな得点（早いほど高い）</li>
        <li>操作：矢印キー / WASD、スマホはスワイプか十字ボタン。P / Esc でポーズ</li>
      </ul>
      ${optRow('speed', 'スピード（速いほど得点が高い）', SPEEDS)}
      ${optRow('wall', '盤面の端', WALLS)}
      ${optRow('map', 'マップ', MAPS)}
      <p class="bests">この組み合わせのハイスコア：<b id="tbest">${best}</b></p>
      <button class="go" data-act="start">▶ スタート</button>
      <p><a href="../index.html">← ゲーム一覧へ</a></p>`);
  }
  function showOver(won) {
    showOverlay(`<h2 class="${won ? '' : 'bad'}">${won ? '盤面を埋めつくした！' : 'ゲームオーバー'}</h2>
      <p class="big">${score}</p>
      <p>長さ ${snake.length}・エサ ${eaten} 個</p>
      ${newBest ? '<p class="note">★ ハイスコア更新！</p>' : `<p class="bests">ハイスコア ${best}</p>`}
      <button class="go" data-act="start">もう一度</button><br>
      <button class="sub" data-act="title">設定を変える</button>
      <p><a href="../index.html">← ゲーム一覧へ</a></p>`);
  }
  overlay.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    audio(); // スマホでは最初のタップで音を使えるようにする
    if (b.dataset.opt) {
      opts[b.dataset.opt] = b.dataset.val;
      store.set(b.dataset.opt, b.dataset.val);
      for (const o of overlay.querySelectorAll(`[data-opt="${b.dataset.opt}"]`)) o.classList.toggle('on', o === b);
      best = getBest(); updateHud();
      const t = document.getElementById('tbest'); if (t) t.textContent = best;
      makeRocks(); snake = []; food = null; star = null;
      return;
    }
    const act = b.dataset.act;
    if (act === 'start') newGame();
    else if (act === 'resume') resume();
    else if (act === 'title') showTitle();
  });

  // ---- 描画 ----
  let cell = 20, ox = 0, oy = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = field.clientWidth, h = field.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const pad = 8;
    cell = Math.max(4, Math.floor((Math.min(w, h) - pad * 2) / N));
    ox = Math.floor((w - cell * N) / 2); oy = Math.floor((h - cell * N) / 2);
  }
  window.addEventListener('resize', resize);

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawBoard() {
    // 市松模様の芝生
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#1f4a30' : '#245536';
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
    // 外わく（壁ありは石垣、通りぬけは点線）
    ctx.lineWidth = 3;
    if (opts.wall === 'wall') {
      ctx.strokeStyle = '#c8b890';
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(180,240,200,0.6)';
      ctx.setLineDash([cell / 2, cell / 2]);
    }
    ctx.strokeRect(ox - 2, oy - 2, cell * N + 4, cell * N + 4);
    ctx.setLineDash([]);
    // 岩
    for (const k of rocks) {
      const [x, y] = k.split(',').map(Number);
      const px = ox + x * cell, py = oy + y * cell;
      ctx.fillStyle = '#6a6a72';
      roundRect(px + 1, py + 1, cell - 2, cell - 2, cell * 0.25); ctx.fill();
      ctx.fillStyle = '#8a8a94';
      roundRect(px + 3, py + 2, cell * 0.5, cell * 0.35, cell * 0.15); ctx.fill();
    }
  }

  function drawFood(t) {
    if (food) {
      const px = ox + (food.x + 0.5) * cell, py = oy + (food.y + 0.5) * cell;
      const r = cell * (0.36 + Math.sin(t / 180) * 0.03);
      ctx.fillStyle = '#e8402e';
      ctx.beginPath(); ctx.arc(px, py + cell * 0.04, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(px - r * 0.35, py - r * 0.25, r * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6a3a1a'; ctx.lineWidth = Math.max(1.5, cell * 0.08);
      ctx.beginPath(); ctx.moveTo(px, py - r * 0.8); ctx.lineTo(px + r * 0.2, py - r * 1.25); ctx.stroke();
      ctx.fillStyle = '#5ac040';
      ctx.beginPath(); ctx.ellipse(px + r * 0.45, py - r * 1.05, r * 0.32, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
    }
    if (star) {
      const px = ox + (star.x + 0.5) * cell, py = oy + (star.y + 0.5) * cell;
      const blink = star.t < 12 && Math.floor(t / 100) % 2;
      if (!blink) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(Math.sin(t / 300) * 0.3);
        const R = cell * 0.48, r = R * 0.45;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffd84a'; ctx.fill();
        ctx.strokeStyle = '#a0701a'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
      // 残り時間のゲージ
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px - cell * 0.4, py + cell * 0.55, cell * 0.8, 3);
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(px - cell * 0.4, py + cell * 0.55, cell * 0.8 * star.t / STAR_TIME, 3);
    }
  }

  function drawSnake() {
    const n = snake.length;
    if (!n) return;
    const dead = state === 'over' && !won;
    // 体（しっぽから頭へ。つながっている所はすき間を埋める）
    for (let i = n - 1; i >= 0; i--) {
      const s = snake[i];
      const k = i / Math.max(1, n - 1);
      const light = 62 - k * 20;
      ctx.fillStyle = dead ? `hsl(0, 60%, ${light}%)` : `hsl(${110 - k * 25}, 70%, ${light}%)`;
      const inset = cell * (0.08 + k * 0.08);
      const px = ox + s.x * cell, py = oy + s.y * cell;
      roundRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2, cell * 0.3); ctx.fill();
      const nx = snake[i - 1];
      if (nx && Math.abs(nx.x - s.x) + Math.abs(nx.y - s.y) === 1) {
        const mx = Math.min(nx.x, s.x), my = Math.min(nx.y, s.y);
        if (nx.x !== s.x) ctx.fillRect(ox + mx * cell + cell / 2, py + inset, cell, cell - inset * 2);
        else ctx.fillRect(px + inset, oy + my * cell + cell / 2, cell - inset * 2, cell);
      }
    }
    // 目と舌
    const h = snake[0], [dx, dy] = DIRS[dir];
    const cx = ox + (h.x + 0.5) * cell, cy = oy + (h.y + 0.5) * cell;
    const sx = -dy, sy = dx; // 横向き
    if (state === 'play' && Math.floor(performance.now() / 400) % 3 === 0) {
      ctx.strokeStyle = '#ff4a6a'; ctx.lineWidth = Math.max(1.5, cell * 0.07);
      const tx = cx + dx * cell * 0.5, ty = cy + dy * cell * 0.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + dx * cell * 0.25, ty + dy * cell * 0.25); ctx.stroke();
    }
    for (const side of [-1, 1]) {
      const ex = cx + dx * cell * 0.12 + sx * side * cell * 0.2, ey = cy + dy * cell * 0.12 + sy * side * cell * 0.2;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, cell * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      if (dead) {
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; const r = cell * 0.08;
        ctx.beginPath(); ctx.moveTo(ex - r, ey - r); ctx.lineTo(ex + r, ey + r); ctx.moveTo(ex + r, ey - r); ctx.lineTo(ex - r, ey + r); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(ex + dx * cell * 0.04, ey + dy * cell * 0.04, cell * 0.07, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawFx(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt;
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(ox + p.x * cell - 2, oy + p.y * cell - 2, 4, 4);
    }
    particles = particles.filter(p => p.life > 0);
    ctx.font = `${Math.max(12, cell * 0.8)}px DotGothic16, monospace`;
    ctx.textAlign = 'center';
    for (const p of popups) {
      p.y -= dt * 1.5; p.life -= dt;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = '#000'; ctx.fillText(p.text, ox + p.x * cell + 2, oy + p.y * cell + 2);
      ctx.fillStyle = '#ffd84a'; ctx.fillText(p.text, ox + p.x * cell, oy + p.y * cell);
    }
    popups = popups.filter(p => p.life > 0);
    ctx.globalAlpha = 1;
  }

  function frame(t) {
    const dt = Math.min(0.1, (t - (last || t)) / 1000);
    last = t;
    if (state === 'play') {
      acc += dt * 1000;
      while (acc >= tickMs && state === 'play') { acc -= tickMs; step(); }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawFood(t);
    drawSnake();
    drawFx(dt);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,60,40,${flash * 0.35})`;
      ctx.fillRect(ox, oy, cell * N, cell * N);
      flash = Math.max(0, flash - dt * 1.5);
    }
    requestAnimationFrame(frame);
  }

  resize();
  makeRocks();
  showTitle();
  requestAnimationFrame(frame);
})();
