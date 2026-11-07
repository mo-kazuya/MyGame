'use strict';
// 計算道場：5 つのモードで計算力を鍛える脳トレゲーム。
(function () {
  const $ = id => document.getElementById(id);
  const stage = $('stage'), overlay = $('overlay'), pad = $('pad');
  const $bar = $('bar'), barFill = $bar.firstElementChild;
  const $pause = $('pause'), $sound = $('sound');
  const stats = [0, 1, 2].map(i => ({ lbl: $('st' + i).querySelector('.lbl'), val: $('st' + i).querySelector('b') }));

  // ---- 設定 ----
  const TIME_LIMIT = 60;          // 時間制モードの制限時間（秒）
  const MISS_PENALTY = 3;         // 100マス計算でミス 1 つにつき足す秒数
  const MODES = {
    speed: { name: 'スピード計算', badge: '速', desc: '60秒で何問とけるか。連続正解でコンボ！' },
    blank: { name: 'あなうめ計算', badge: '□', desc: '□に入る数を答える。逆算で頭をひねろう。' },
    compare: { name: 'どっちが大きい？', badge: '比', desc: '2つの式の答え、大きいのはどっち？' },
    chain: { name: '暗算リレー', badge: '連', desc: '次々に出る計算を頭の中だけでつなげよう。' },
    grid: { name: '100マス計算', badge: '百', desc: 'たて×よこのマスを全部うめるタイムを競う。' },
  };
  const DIFFS = { easy: { name: 'かんたん' }, normal: { name: 'ふつう' }, hard: { name: 'むずかしい' } };
  const GRID_OPS = { add: { name: 'たし算', sym: '+' }, sub: { name: 'ひき算', sym: '−' }, mul: { name: 'かけ算', sym: '×' } };
  const GRID_SIZES = { 5: { name: '25マス' }, 10: { name: '100マス' } };
  const CHAIN_MS = { easy: 1700, normal: 1300, hard: 1000 };  // 暗算リレーで 1 つの式を見せる時間
  const CHAIN_LIVES = 3, CHAIN_START = 3, CHAIN_MAX = 20;

  // 称号（段位）。数字はその称号になるための目安
  const RANKS = ['たまご', 'ひよこ', '見習い', '一人前', '達人', '計算名人'];
  const RANK_TH = {
    speed: { easy: [0, 12, 20, 28, 36, 45], normal: [0, 7, 12, 17, 23, 30], hard: [0, 4, 7, 10, 14, 18] },
    blank: { easy: [0, 10, 17, 24, 31, 38], normal: [0, 6, 10, 14, 19, 25], hard: [0, 3, 6, 9, 12, 16] },
    compare: { easy: [0, 12, 20, 28, 35, 42], normal: [0, 9, 15, 21, 27, 33], hard: [0, 6, 10, 15, 20, 25] },
    chain: { easy: [0, 4, 6, 8, 10, 13], normal: [0, 4, 5, 7, 9, 12], hard: [0, 3, 4, 6, 8, 10] },
  };
  // 100マス計算は記録（秒）がこれ以下なら（25マスは 1/4）
  const GRID_TH = { add: [Infinity, 300, 200, 140, 100, 75], sub: [Infinity, 340, 230, 160, 115, 85], mul: [Infinity, 320, 210, 150, 105, 80] };

  // ---- 保存（キーは brain. で始める） ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('brain.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('brain.' + k, String(v)); } catch (e) { /* 保存できなくても遊べる */ } },
  };
  const opts = { mode: 'speed', diff: 'normal', gop: 'add', gsize: '10' };
  for (const [k, table] of [['mode', MODES], ['diff', DIFFS], ['gop', GRID_OPS], ['gsize', GRID_SIZES]]) {
    const v = store.get(k, opts[k]);
    if (table[v]) opts[k] = v;
  }
  const bestKey = (o = opts) => o.mode === 'grid' ? `best.grid.${o.gop}.${o.gsize}` : `best.${o.mode}.${o.diff}`;
  function getBest(o) { const v = +store.get(bestKey(o), 0) || 0; return v > 0 ? v : 0; }

  // 毎日のトレーニング記録
  function dayStr(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
  const today = () => dayStr(new Date());
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayStr(d); };
  function daily() {
    const last = store.get('lastDay', '');
    const streak = (last === today() || last === yesterday()) ? (+store.get('streak', 0) || 0) : 0;
    const count = store.get('todayDay', '') === today() ? (+store.get('todayCount', 0) || 0) : 0;
    return { streak, count, total: +store.get('totalCount', 0) || 0 };
  }
  function recordDay(correct) {
    const last = store.get('lastDay', '');
    if (last !== today()) {
      const s = last === yesterday() ? (+store.get('streak', 0) || 0) + 1 : 1;
      store.set('streak', s); store.set('lastDay', today());
    }
    if (store.get('todayDay', '') !== today()) { store.set('todayDay', today()); store.set('todayCount', 0); }
    store.set('todayCount', (+store.get('todayCount', 0) || 0) + correct);
    store.set('totalCount', (+store.get('totalCount', 0) || 0) + correct);
  }

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
  function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    key() { tone(660, 0.03, 'square', 0.025); },
    ok() { tone(988, 0.07, 'square', 0.05); tone(1319, 0.1, 'square', 0.045, 0, 0.06); },
    ng() { tone(180, 0.28, 'sawtooth', 0.07, -70); },
    combo() { [1047, 1319, 1568].forEach((f, i) => tone(f, 0.08, 'triangle', 0.07, 0, i * 0.05)); },
    count() { tone(520, 0.12, 'square', 0.05); },
    go() { tone(1047, 0.3, 'square', 0.06); },
    step() { tone(740, 0.06, 'triangle', 0.06); },
    end() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.06, 0, i * 0.11)); },
    rec() { [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, 0, i * 0.09)); },
  };
  function updateSoundBtn() { $sound.classList.toggle('off', muted); }
  $sound.addEventListener('click', () => {
    muted = !muted; store.set('muted', muted ? '1' : '0'); updateSoundBtn();
    if (!muted) sfx.ok();
  });
  updateSoundBtn();

  // ---- 問題づくり ----
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const coin = () => Math.random() < 0.5;
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function calc(a, op, b) { return op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b; }
  const SLOT = { slot: true };

  // a op b = c（答えはいつも 0 以上の整数）
  function binary(diff) {
    let op, a, b;
    if (diff === 'easy') {
      op = pick(['+', '+', '−']);
      if (op === '+') { a = ri(1, 9); b = ri(1, 9); } else { b = ri(1, 9); a = b + ri(0, 9); }
    } else if (diff === 'normal') {
      op = pick(['+', '−', '×', '×', '÷']);
      if (op === '+') { a = ri(10, 99); b = coin() ? ri(3, 9) : ri(11, 99); }
      else if (op === '−') { a = ri(20, 99); b = coin() ? ri(3, 9) : ri(11, a - 1); }
      else if (op === '×') { a = ri(2, 9); b = ri(2, 9); }
      else { b = ri(2, 9); a = b * ri(2, 9); }
    } else {
      op = pick(['+', '−', '×', '÷']);
      if (op === '+') { a = ri(100, 999); b = coin() ? ri(11, 99) : ri(101, 999); }
      else if (op === '−') { a = ri(200, 999); b = coin() ? ri(11, 99) : ri(101, a - 1); }
      else if (op === '×') { if (coin()) { a = ri(12, 99); b = ri(3, 9); } else { a = ri(11, 19); b = ri(11, 19); } }
      else { b = ri(3, 9); a = b * ri(12, 99); }
    }
    return { a, op, b, c: calc(a, op, b) };
  }
  // むずかしい：かけ算を先に計算する 3 つの数の式
  function ternary() {
    let a, b, c, toks, ans;
    switch (ri(0, 3)) {
      case 0: a = ri(2, 50); b = ri(2, 9); c = ri(2, 9); toks = [a, '+', b, '×', c]; ans = a + b * c; break;
      case 1: a = ri(2, 9); b = ri(2, 9); c = ri(2, 50); toks = [a, '×', b, '+', c]; ans = a * b + c; break;
      case 2: a = ri(3, 9); b = ri(3, 9); c = ri(1, a * b - 1); toks = [a, '×', b, '−', c]; ans = a * b - c; break;
      default: b = ri(2, 9); c = ri(2, 9); a = b * c + ri(1, 50); toks = [a, '−', b, '×', c]; ans = a - b * c;
    }
    return { tokens: [...toks, '=', SLOT], ans };
  }
  function qSpeed(diff) {
    if (diff === 'hard' && Math.random() < 0.3) return ternary();
    const t = binary(diff);
    return { tokens: [t.a, t.op, t.b, '=', SLOT], ans: t.c };
  }
  function qBlank(diff) {
    const t = binary(diff);
    return coin()
      ? { tokens: [SLOT, t.op, t.b, '=', t.c], ans: t.a }
      : { tokens: [t.a, t.op, SLOT, '=', t.c], ans: t.b };
  }
  // 答えが v になる式をつくる
  function build(v, diff) {
    const ops = diff === 'easy' ? ['+', '−'] : ['+', '−', '×', '÷'];
    const cap = { easy: 9, normal: 60, hard: 400 }[diff];
    for (let i = 0; i < 30; i++) {
      const op = pick(ops);
      if (op === '+') {
        const lo = diff === 'easy' ? Math.max(1, v - 9) : 1, hi = Math.min(v - 1, cap);
        if (hi < lo) continue;
        const b = ri(lo, hi); return [v - b, '+', b];
      }
      if (op === '−') {
        const b = ri(1, cap);
        if (diff === 'easy' && v + b > 18) continue;
        return [v + b, '−', b];
      }
      if (op === '×') {
        const ds = [];
        for (let d = 2; d <= 9; d++) if (v % d === 0 && v / d >= 2) ds.push(d);
        if (!ds.length) continue;
        const d = pick(ds); return coin() ? [v / d, '×', d] : [d, '×', v / d];
      }
      const b = ri(2, 9);
      if (v * b > (diff === 'hard' ? 2000 : 99)) continue;
      return [v * b, '÷', b];
    }
    return v >= 2 ? [v - 1, '+', 1] : [v + 1, '−', 1];
  }
  function qCompare(diff) {
    const v1 = diff === 'easy' ? ri(3, 17) : diff === 'normal' ? ri(8, 80) : ri(30, 300);
    let v2 = v1;
    if (Math.random() >= 0.2) {
      const d = ri(1, Math.max(2, Math.round(v1 * 0.12)));
      v2 = coin() ? v1 + d : v1 - d;
      if (v2 < 2) v2 = v1 + d;
      if (diff === 'easy' && v2 > 17) v2 = v1 - d;
    }
    const L = build(v1, diff);
    let R = build(v2, diff);
    for (let i = 0; i < 5 && R.join() === L.join(); i++) R = build(v2, diff);
    return { L, R, lv: v1, rv: v2, ans: v1 > v2 ? 'L' : v1 < v2 ? 'R' : 'E' };
  }
  // 暗算リレーの 1 歩：今の数 v にする計算
  function chainStep(v, diff) {
    const c = [];
    if (diff === 'easy') {
      if (v <= 21) c.push(() => ['+', ri(1, 9)]);
      if (v >= 2) c.push(() => ['−', ri(1, Math.min(9, v - 1))]);
    } else if (diff === 'normal') {
      if (v <= 85) c.push(() => ['+', ri(2, 15)]);
      if (v >= 4) c.push(() => ['−', ri(2, Math.min(15, v - 1))]);
      if (v <= 30) c.push(() => ['×', ri(2, 3)]);
      const ds = [2, 3, 5].filter(d => v % d === 0 && v / d >= 2);
      if (ds.length) c.push(() => ['÷', pick(ds)]);
    } else {
      if (v <= 260) c.push(() => ['+', ri(5, 40)]);
      if (v >= 8) c.push(() => ['−', ri(5, Math.min(40, v - 1))]);
      if (v <= 25) c.push(() => ['×', ri(2, 9)]);
      const ds = [2, 3, 4, 5, 6, 7, 8, 9].filter(d => v % d === 0 && v / d >= 2);
      if (ds.length) c.push(() => ['÷', pick(ds)]);
    }
    if (!c.length) c.push(() => ['+', ri(1, 9)]);
    const [op, n] = pick(c)();
    return { op, n, v: calc(v, op, n) };
  }
  function makeChain(diff, steps) {
    let v = diff === 'easy' ? ri(1, 9) : diff === 'normal' ? ri(2, 15) : ri(5, 30);
    const list = [{ start: true, v }];
    for (let i = 0; i < steps; i++) { const s = chainStep(v, diff); list.push(s); v = s.v; }
    return { list, ans: v };
  }

  // ---- ゲームの状態 ----
  let G = null;        // 遊んでいるゲーム
  let paused = false;
  let countToken = 0;  // カウントダウンの取り消し用

  // ゲームの中の時計（ポーズ中は止まる）
  const now = () => performance.now();
  function elapsed() { return G ? ((paused ? G.pausedAt : now()) - G.t0 - G.pauseTotal) : 0; }
  function later(ms, fn) { G.timers.push({ at: elapsed() + ms, fn, g: G }); }

  function setStats(labels) { labels.forEach((l, i) => { stats[i].lbl.textContent = l; }); }
  function setVal(i, v, cls) { stats[i].val.textContent = v; stats[i].val.className = cls || ''; }
  function fmtTime(ms) {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    return m ? `${m}:${(s % 60).toFixed(1).padStart(4, '0')}` : s.toFixed(1);
  }
  const hearts = n => '♥\uFE0E'.repeat(Math.max(0, n)) + '♡\uFE0E'.repeat(Math.max(0, CHAIN_LIVES - n));

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function tokHtml(t, slotCls) {
    if (t === SLOT) return `<span class="slot empty ${slotCls || ''}" id="slot">?</span>`;
    if (t === '=') return '<span class="eq">=</span>';
    if (typeof t === 'string') return `<span class="op">${t}</span>`;
    return `<span class="n">${t}</span>`;
  }

  // ---- ゲーム開始 ----
  function start() {
    const mode = opts.mode;
    G = {
      mode, diff: opts.diff, gop: opts.gop, gsize: +opts.gsize,
      o: { ...opts },
      t0: 0, pauseTotal: 0, pausedAt: 0, timers: [],
      phase: 'count', input: '', locked: true,
      correct: 0, miss: 0, combo: 0, maxCombo: 0, qn: 0, lastKey: '', misses: [],
    };
    paused = false;
    hideOverlay();
    stage.classList.remove('paused');
    $pause.classList.add('hide');
    pad.classList.toggle('cmp', mode === 'compare');
    pad.classList.add('off');
    pad.classList.remove('hide');
    if (mode === 'grid') {
      setStats(['タイム', 'のこり', 'ミス']);
      setVal(0, '0.0'); setVal(1, G.gsize * G.gsize); setVal(2, 0);
    } else if (mode === 'chain') {
      setStats(['ライフ', 'ステップ', '正解']);
      setVal(0, hearts(CHAIN_LIVES)); setVal(1, CHAIN_START); setVal(2, 0);
    } else {
      setStats(['のこり', '正解', 'コンボ']);
      setVal(0, TIME_LIMIT); setVal(1, 0); setVal(2, 0);
    }
    $bar.classList.toggle('hide', mode === 'chain');
    $bar.classList.remove('low');
    barFill.style.transform = mode === 'grid' ? 'scaleX(0)' : 'scaleX(1)';
    // 3, 2, 1 のカウントダウン
    const tok = ++countToken;
    const seq = ['3', '2', '1', 'スタート！'];
    seq.forEach((s, i) => setTimeout(() => {
      if (tok !== countToken) return;
      stage.innerHTML = `<div class="count ${i === 3 ? 'go' : ''}">${s}</div>`;
      i === 3 ? sfx.go() : sfx.count();
    }, i * 650));
    setTimeout(() => { if (tok === countToken) begin(); }, seq.length * 650);
  }

  function begin() {
    G.phase = 'play';
    G.t0 = now();
    $pause.classList.remove('hide');
    if (G.mode === 'grid') setupGrid();
    else if (G.mode === 'chain') { G.lives = CHAIN_LIVES; G.steps = CHAIN_START; G.bestSteps = 0; newChain(); }
    else nextQ();
  }

  // ---- スピード計算・あなうめ計算・どっちが大きい？ ----
  function nextQ() {
    G.input = ''; G.qn++;
    let q, key;
    for (let i = 0; i < 6; i++) {
      q = G.mode === 'speed' ? qSpeed(G.diff) : G.mode === 'blank' ? qBlank(G.diff) : qCompare(G.diff);
      key = G.mode === 'compare' ? q.L.join() + '|' + q.R.join() : q.tokens.map(t => t === SLOT ? '?' : t).join();
      if (key !== G.lastKey) break;
    }
    G.q = q; G.lastKey = key;
    if (G.mode === 'compare') {
      const side = (toks, k) => `<button class="side" data-k="${k}"><span class="e">${toks.map(t => tokHtml(t)).join('')}</span><span class="v"></span></button>`;
      stage.innerHTML = `<div class="cmp-wrap"><div class="qno">第${G.qn}問　答えが大きいのはどっち？</div>
        <div class="cmp">${side(q.L, 'L')}<div class="vs">VS</div>${side(q.R, 'R')}</div>
        <div class="fb" id="fb"></div></div>`;
    } else {
      const long = q.tokens.length > 5 || String(q.ans).length + q.tokens.filter(t => t !== SLOT).join('').length > 11;
      stage.innerHTML = `<div class="q"><div class="qno">第${G.qn}問</div>
        <div class="expr ${long ? 'long' : ''}">${q.tokens.map(t => tokHtml(t, G.mode === 'blank' ? 'box' : '')).join('')}</div>
        <div class="fb" id="fb"></div></div>`;
    }
    G.locked = false;
    pad.classList.remove('off');
  }

  function showMark(ok) {
    const m = document.createElement('div');
    m.className = 'mark show' + (ok ? '' : ' ng');
    m.textContent = ok ? '○' : '×';
    stage.appendChild(m);
    setTimeout(() => m.remove(), 500);
  }
  function popText(text) {
    const p = document.createElement('div');
    p.className = 'combo-pop'; p.textContent = text;
    stage.appendChild(p);
    setTimeout(() => p.remove(), 850);
  }
  function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  function judgeTimed(ok, given) {
    if (ok) {
      G.correct++; G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
      showMark(true);
      if (G.combo % 5 === 0) { sfx.combo(); popText(`${G.combo} コンボ！`); } else sfx.ok();
      setVal(1, G.correct); setVal(2, G.combo);
      if (G.mode === 'compare') {
        // 正解のときも答えの値をちらっと見せる
        G.locked = true; revealCompare();
        later(260, nextQ);
      } else nextQ();
      return;
    }
    G.miss++; G.combo = 0; setVal(2, 0);
    G.locked = true; pad.classList.add('off');
    sfx.ng(); showMark(false);
    if (G.mode === 'compare') {
      revealCompare();
      const word = { L: '左', R: '右', E: '同じ' }[G.q.ans];
      $('fb').innerHTML = `正解は <span class="ans">${word}</span>`;
      G.misses.push(`${G.q.L.join(' ')} と ${G.q.R.join(' ')} → ${word}`);
    } else {
      shake(document.querySelector('.expr'));
      $('fb').innerHTML = `正解は <span class="ans">${G.q.ans}</span>`;
      const full = G.q.tokens.map(t => t === SLOT ? `[${G.q.ans}]` : t).join(' ');
      G.misses.push(`${full}（${esc(given)} と答えた）`);
    }
    later(900, nextQ);
  }
  function revealCompare() {
    const sides = stage.querySelectorAll('.cmp .side');
    if (sides.length < 2) return;
    sides[0].querySelector('.v').textContent = '= ' + G.q.lv;
    sides[1].querySelector('.v').textContent = '= ' + G.q.rv;
    if (G.q.ans === 'L') sides[0].classList.add('win');
    if (G.q.ans === 'R') sides[1].classList.add('win');
  }

  // ---- 暗算リレー ----
  function newChain() {
    G.ch = makeChain(G.diff, G.steps);
    G.chStart = elapsed();
    G.chShown = -2;
    G.input = '';
    G.sub = 'show';
    G.locked = true; pad.classList.add('off');
    setVal(1, G.steps);
    stage.innerHTML = `<div class="chain"><div class="lbl" id="clbl"></div><div class="big" id="cbig"></div>
      <div class="dots" id="cdots"></div><div class="trail" id="trail"></div><div class="fb" id="fb"></div></div>`;
  }
  function chainTick() {
    if (G.sub !== 'show') return;
    const ms = CHAIN_MS[G.diff];
    const dt = elapsed() - G.chStart - 400;
    if (dt < 0) return;
    const list = G.ch.list;
    const idx = Math.floor(dt / ms);
    const gap = dt % ms > ms - 200;  // 同じ式が続いても分かるよう、すき間をあける
    const shown = idx >= list.length ? list.length : gap ? -1 : idx;
    if (shown === G.chShown) return;
    G.chShown = shown;
    const big = $('cbig'), lbl = $('clbl'), dots = $('cdots');
    if (shown === list.length) {
      G.sub = 'input';
      lbl.textContent = '答えは？';
      big.className = 'big';
      big.innerHTML = '<span class="slot empty" id="slot">?</span>';
      dots.innerHTML = '';
      G.locked = false; pad.classList.remove('off');
      return;
    }
    if (shown < 0) { big.textContent = ''; return; }
    const it = list[shown];
    lbl.textContent = it.start ? 'はじめの数' : `${shown} / ${list.length - 1}`;
    big.className = 'big' + (it.start ? '' : ' opstep');
    big.textContent = it.start ? it.v : `${it.op} ${it.n}`;
    dots.innerHTML = list.slice(1).map((_, i) => `<span class="${i < shown ? 'on' : ''}">●</span>`).join('');
    sfx.step();
  }
  function chainTrail() {
    return G.ch.list.map(it => it.start ? `<span>${it.v}</span>` : `<span>${it.op}${it.n}</span>→<span class="res">${it.v}</span>`).join(' ');
  }
  function judgeChain(ok, given) {
    G.locked = true; pad.classList.add('off');
    G.sub = 'result';
    $('trail').innerHTML = chainTrail();
    if (ok) {
      G.correct++; G.bestSteps = Math.max(G.bestSteps, G.steps);
      setVal(2, G.correct);
      sfx.ok(); showMark(true);
      $('fb').textContent = `${G.steps} ステップ クリア！`;
      if (G.steps < CHAIN_MAX) G.steps++;
      later(1600, newChain);
    } else {
      G.lives--; G.miss++;
      setVal(0, hearts(G.lives));
      sfx.ng(); showMark(false);
      $('fb').innerHTML = `正解は <span class="ans">${G.ch.ans}</span>`;
      G.misses.push(`${G.ch.list.map(it => it.start ? it.v : `${it.op}${it.n}`).join(' → ')} ＝ ${G.ch.ans}（${esc(given)} と答えた）`);
      later(2600, () => G.lives > 0 ? newChain() : finish());
    }
  }

  // ---- 100マス計算 ----
  function setupGrid() {
    const n = G.gsize;
    const op = GRID_OPS[G.gop].sym;
    const digits = () => shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, n);
    // ひき算は左の数を 10〜19 にして、答えがマイナスにならないようにする
    const rows = G.gop === 'sub' ? digits().map(d => d + 10) : digits();
    const cols = digits();
    G.gr = { n, op, rows, cols, idx: 0, answers: [] };
    let html = `<div class="corner">${op}</div>` + cols.map((c, j) => `<div class="h" id="hc${j}">${c}</div>`).join('');
    for (let i = 0; i < n; i++) {
      html += `<div class="h" id="hr${i}">${rows[i]}</div>`;
      for (let j = 0; j < n; j++) html += `<div id="g${i}_${j}"></div>`;
    }
    stage.innerHTML = `<div class="grid" id="grid" style="--n:${n + 1}">${html}</div>`;
    fitGrid();
    markGridCur();
    G.locked = false; pad.classList.remove('off');
  }
  function fitGrid() {
    const grid = $('grid');
    if (!grid || !G || !G.gr) return;
    const n = G.gr.n + 1;
    const s = Math.floor(Math.min((stage.clientWidth - 16) / n, (stage.clientHeight - 16) / n, 64));
    grid.style.setProperty('--cs', Math.max(18, s - 1) + 'px');
  }
  function gridAns(i, j) { const g = G.gr; return calc(g.rows[i], g.op, g.cols[j]); }
  function markGridCur() {
    const g = G.gr, n = g.n;
    stage.querySelectorAll('.cur, .hl').forEach(e => e.classList.remove('cur', 'hl'));
    if (g.idx >= n * n) return;
    const i = Math.floor(g.idx / n), j = g.idx % n;
    const cell = $(`g${i}_${j}`);
    cell.classList.add('cur'); cell.textContent = G.input;
    $(`hr${i}`).classList.add('hl'); $(`hc${j}`).classList.add('hl');
    G.q = { ans: gridAns(i, j) };
  }
  function judgeGrid(ok, given) {
    const g = G.gr, n = g.n;
    const i = Math.floor(g.idx / n), j = g.idx % n;
    const cell = $(`g${i}_${j}`);
    cell.textContent = given;
    cell.classList.add(ok ? 'ok' : 'ng');
    if (ok) { G.correct++; sfx.key(); }
    else {
      G.miss++; sfx.ng(); setVal(2, G.miss);
      G.misses.push(`${g.rows[i]} ${g.op} ${g.cols[j]} = ${gridAns(i, j)}（${esc(given)} と答えた）`);
    }
    g.idx++; G.input = '';
    setVal(1, n * n - g.idx);
    barFill.style.transform = `scaleX(${g.idx / (n * n)})`;
    if (g.idx >= n * n) { finish(); return; }
    markGridCur();
  }

  // ---- 入力 ----
  function press(k) {
    if (!G || G.phase !== 'play' || paused || G.locked) return;
    if (G.mode === 'compare') {
      if (!'LRE'.includes(k)) return;
      judgeTimed(k === G.q.ans, k);
      return;
    }
    if (k === 'L' || k === 'R' || k === 'E') return;
    if (k === 'del') G.input = G.input.slice(0, -1);
    else if (k === 'clr') G.input = '';
    else if (G.input.length < 5) G.input += k;
    else return;
    if (G.mode !== 'grid') sfx.key();
    const ans = String(G.mode === 'chain' ? G.ch.ans : G.q.ans);
    showInput();
    // 答えと同じ桁数を入れたら自動で答え合わせ
    if (G.input.length >= ans.length) {
      const ok = G.input === ans, given = G.input;
      if (G.mode === 'grid') judgeGrid(ok, given);
      else if (G.mode === 'chain') judgeChain(ok, given);
      else judgeTimed(ok, given);
    }
  }
  function showInput() {
    if (G.mode === 'grid') { markGridCur(); return; }
    const s = $('slot');
    if (!s) return;
    s.textContent = G.input || '?';
    s.classList.toggle('empty', !G.input);
  }

  pad.addEventListener('pointerdown', e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    e.preventDefault();
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 110);
    press(b.dataset.k);
  });
  // どっちが大きい？は式そのものをタップしてもよい
  stage.addEventListener('pointerdown', e => {
    const b = e.target.closest('.side[data-k]');
    if (!b) return;
    e.preventDefault();
    press(b.dataset.k);
  });
  pad.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (!overlay.classList.contains('hidden')) {
      if (k === 'Enter' || k === ' ') {
        const b = overlay.querySelector('button.go');
        if (b) { e.preventDefault(); b.click(); }
      } else if (k === 'Escape' && paused) { e.preventDefault(); resume(); }
      return;
    }
    if (k === 'Escape' || k === 'p' || k === 'P') { e.preventDefault(); if (G && G.phase === 'play') pause(); return; }
    if (/^[0-9]$/.test(k)) { e.preventDefault(); press(k); return; }
    if (k === 'Backspace') { e.preventDefault(); press('del'); return; }
    if (k === 'Delete' || k === 'c' || k === 'C') { press('clr'); return; }
    const cmp = { ArrowLeft: 'L', a: 'L', ArrowRight: 'R', d: 'R', ArrowDown: 'E', ArrowUp: 'E', s: 'E', '=': 'E' }[k];
    if (cmp) { e.preventDefault(); press(cmp); }
  });

  // ---- ポーズ ----
  function pause() {
    if (!G || G.phase !== 'play' || paused) return;
    paused = true; G.pausedAt = now();
    stage.classList.add('paused');
    showPanel(`<h2>ポーズ中</h2>
      <p>${MODES[G.mode].name}</p>
      <button class="go" data-act="resume">つづける</button><br>
      <button class="sub2" data-act="retry">はじめから</button>
      <button class="sub2" data-act="title">やめる</button>`);
  }
  function resume() {
    if (!paused) return;
    G.pauseTotal += now() - G.pausedAt;
    paused = false;
    stage.classList.remove('paused');
    hideOverlay();
  }
  $pause.addEventListener('click', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ---- 毎フレームの処理 ----
  function loop() {
    requestAnimationFrame(loop);
    if (!G || G.phase !== 'play' || paused) return;
    const t = elapsed();
    // 予約した処理
    if (G.timers.length) {
      const due = G.timers.filter(x => x.at <= t);
      G.timers = G.timers.filter(x => x.at > t);
      for (const x of due) { if (G === x.g && G.phase === 'play') x.fn(); }
      if (!G || G.phase !== 'play') return;
    }
    if (G.mode === 'grid') {
      setVal(0, fmtTime(t));
    } else if (G.mode === 'chain') {
      chainTick();
    } else {
      const left = TIME_LIMIT * 1000 - t;
      const sec = Math.ceil(left / 1000);
      setVal(0, Math.max(0, sec), sec <= 10 ? 'low' : '');
      barFill.style.transform = `scaleX(${Math.max(0, left / (TIME_LIMIT * 1000))})`;
      $bar.classList.toggle('low', sec <= 10);
      if (left <= 0) finish();
    }
  }
  requestAnimationFrame(loop);

  // ---- 結果 ----
  function rankIndex(o, value) {
    if (o.mode === 'grid') {
      const th = GRID_TH[o.gop].map(x => +o.gsize === 5 ? x / 4 : x);
      let r = 0;
      th.forEach((x, i) => { if (value <= x) r = i; });
      return r;
    }
    const th = RANK_TH[o.mode][o.diff];
    let r = 0;
    th.forEach((x, i) => { if (value >= x) r = i; });
    return r;
  }
  function nextRankHint(o, value, r) {
    if (r >= RANKS.length - 1) return '最高の称号です！';
    if (o.mode === 'grid') {
      const th = GRID_TH[o.gop][r + 1] / (+o.gsize === 5 ? 4 : 1);
      return `「${RANKS[r + 1]}」まで あと ${(value - th).toFixed(1)} 秒`;
    }
    const need = RANK_TH[o.mode][o.diff][r + 1] - value;
    return `「${RANKS[r + 1]}」まで あと ${need} ${o.mode === 'chain' ? 'ステップ' : '問'}`;
  }

  function finish() {
    if (!G || G.phase !== 'play') return;
    const t = elapsed();
    G.phase = 'over';
    G.locked = true; pad.classList.add('off');
    $pause.classList.add('hide');
    const o = G.o;
    let value, main, rows = [];
    if (o.mode === 'grid') {
      // 間違えたマスを正しい答えに直して見せる
      stage.querySelectorAll('.grid .ng').forEach(c => {
        const [i, j] = c.id.slice(1).split('_').map(Number);
        c.textContent = gridAns(i, j); c.classList.replace('ng', 'fix');
      });
      const sec = t / 1000 + G.miss * MISS_PENALTY;
      value = Math.round(sec * 10) / 10;
      main = `${value.toFixed(1)}<small> 秒</small>`;
      rows = [['タイム', fmtTime(t) + ' 秒'], ['ミス', `${G.miss}（+${G.miss * MISS_PENALTY} 秒）`], ['計算', `${GRID_OPS[o.gop].name}・${GRID_SIZES[o.gsize].name}`]];
    } else if (o.mode === 'chain') {
      value = G.bestSteps;
      main = `${value}<small> ステップ</small>`;
      rows = [['正解', `${G.correct} 回`], ['難しさ', DIFFS[o.diff].name]];
    } else {
      value = G.correct;
      main = `${value}<small> 問 正解</small>`;
      const total = G.correct + G.miss;
      rows = [
        ['正答率', total ? `${Math.round(G.correct / total * 100)}%（${G.correct}/${total}）` : '-'],
        ['最大コンボ', G.maxCombo],
        ['1問あたり', G.correct ? `${(TIME_LIMIT / G.correct).toFixed(1)} 秒` : '-'],
        ['難しさ', DIFFS[o.diff].name],
      ];
    }
    const prev = getBest(o);
    const better = o.mode === 'grid' ? (prev === 0 || value * 10 < prev) : value > prev;
    const isRec = better && value > 0;
    if (isRec) store.set(bestKey(o), o.mode === 'grid' ? Math.round(value * 10) : value);
    const bestTxt = o.mode === 'grid'
      ? (isRec ? value.toFixed(1) : (prev / 10).toFixed(1)) + ' 秒'
      : `${isRec ? value : prev} ${o.mode === 'chain' ? 'ステップ' : '問'}`;
    recordDay(G.correct);
    const r = rankIndex(o, value);
    isRec ? sfx.rec() : sfx.end();
    const missHtml = G.misses.length
      ? `<div class="miss-list">まちがえた問題<br>${G.misses.slice(0, 6).map(m => esc(m)).join('<br>')}${G.misses.length > 6 ? '<br>…' : ''}</div>`
      : (o.mode !== 'chain' && G.correct > 0 ? '<p class="comment">ノーミス！ すばらしい！</p>' : '');
    const delay = o.mode === 'grid' ? 900 : 300;
    setTimeout(() => {
      if (!G || G.phase !== 'over') return;
      showPanel(`<h2>${MODES[o.mode].name}</h2>
        ${o.mode === 'grid' ? '' : '<p style="margin:0;color:#a8b8e0;font-size:13px">' + (o.mode === 'chain' ? 'つなげられた最高ステップ' : TIME_LIMIT + '秒の記録') + '</p>'}
        <div class="big">${main}</div>
        ${isRec ? '<div class="newrec">★ 自己ベスト更新！ ★</div>' : ''}
        <div class="rank">称号：${RANKS[r]}</div>
        <p class="comment">${nextRankHint(o, value, r)}</p>
        <table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}
          <tr><td>自己ベスト</td><td>${bestTxt}</td></tr></table>
        ${missHtml}
        <button class="go" data-act="retry">もう一度</button><br>
        <button class="sub2" data-act="title">モードをえらぶ</button>`);
    }, delay);
  }

  // ---- 画面（タイトル・ポーズ・結果） ----
  function showPanel(html) {
    overlay.innerHTML = `<div class="panel">${html}</div>`;
    overlay.classList.remove('hidden');
    const p = overlay.firstElementChild; if (p) p.scrollTop = 0;
  }
  function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

  function bestLabel(mode) {
    const o = { ...opts, mode };
    const b = getBest(o);
    if (!b) return '';
    if (mode === 'grid') return `ベスト ${(b / 10).toFixed(1)}秒`;
    return `ベスト ${b}${mode === 'chain' ? 'ステップ' : '問'}`;
  }
  function optRow(label, key, table) {
    return `<div class="opt"><span class="lbl">${label}</span><div class="row">${Object.entries(table).map(([k, v]) =>
      `<button data-opt="${key}" data-v="${k}" class="${opts[key] === k ? 'on' : ''}">${v.name}</button>`).join('')}</div></div>`;
  }
  function showTitle() {
    countToken++;
    G = null; paused = false;
    $pause.classList.add('hide');
    stage.classList.remove('paused');
    stage.innerHTML = '';
    pad.classList.add('off');
    const d = daily();
    const isGrid = opts.mode === 'grid';
    showPanel(`<h1>計算道場</h1>
      <p class="sub">毎日すこしずつ、頭の準備運動</p>
      <div class="today"><span>連続 <b>${d.streak}</b> 日</span><span>今日の正解 <b>${d.count}</b> 問</span><span>これまで <b>${d.total}</b> 問</span></div>
      <div class="modes">${Object.entries(MODES).map(([k, m]) =>
        `<button data-mode="${k}" class="${opts.mode === k ? 'on' : ''}"><span class="badge">${m.badge}</span>
          <span class="nm">${m.name}<small>${bestLabel(k)}</small></span><span class="ds">${m.desc}</span></button>`).join('')}</div>
      ${isGrid ? optRow('計算', 'gop', GRID_OPS) + optRow('マスの数', 'gsize', GRID_SIZES) : optRow('難しさ', 'diff', DIFFS)}
      <button class="go" data-act="start">スタート</button>
      <p class="keys-help">数字を答えの桁数ぶん入れると自動で答え合わせ。<br>PC：数字キーで入力・Backspace で消す・Esc でポーズ（どっちが大きい？は ← → ↓）</p>
      <a href="../index.html">← ゲーム一覧へ</a>`);
  }

  overlay.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    audio();  // スマホで音を出せるようにする
    if (b.dataset.mode) {
      opts.mode = b.dataset.mode; store.set('mode', opts.mode);
      sfx.key(); showTitle(); return;
    }
    if (b.dataset.opt) {
      opts[b.dataset.opt] = b.dataset.v; store.set(b.dataset.opt, b.dataset.v);
      sfx.key(); showTitle(); return;
    }
    const act = b.dataset.act;
    if (act === 'start' || act === 'retry') { if (G && act === 'retry') Object.assign(opts, G.o); start(); }
    else if (act === 'resume') resume();
    else if (act === 'title') showTitle();
  });

  window.addEventListener('resize', fitGrid);
  showTitle();
})();
