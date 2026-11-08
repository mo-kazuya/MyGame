'use strict';
// 記憶道場：3 つのモードで記憶力を鍛える脳トレゲーム。
//   覚える時間（memo）→ 思い出す時間（recall）→ 結果、の順に進む。
(function () {
  const $ = id => document.getElementById(id);
  const stage = $('stage'), overlay = $('overlay');
  const $bar = $('bar'), barFill = $bar.firstElementChild;
  const $pause = $('pause'), $sound = $('sound');
  const stats = [0, 1, 2].map(i => ({ lbl: $('st' + i).querySelector('.lbl'), val: $('st' + i).querySelector('b') }));

  // ---- 設定 ----
  const MODES = {
    words: { name: '単語おぼえ書き', badge: '語', desc: '並んだ単語を2分で覚えて、3分で思い出せるだけ書き出す。' },
    grid: { name: '数字マス記憶', badge: '升', desc: 'マスの数字と場所を覚えて、空になったマスを穴埋め。' },
    seq: { name: '順番記憶', badge: '順', desc: '光ったマスの順番を覚えて、同じ順にタップ。成功するたび1つ長くなる。' },
    spot: { name: 'なにが変わった？', badge: '変', desc: '並んだ絵を覚えて、増えた・消えた・入れ替わった場所を当てる。' },
    pair: { name: 'ペア記憶', badge: '対', desc: '「人と食べ物」などの組み合わせを覚えて、相手を選ぶ。' },
  };
  const DIFFS = { easy: { name: 'かんたん' }, normal: { name: 'ふつう' }, hard: { name: 'むずかしい' } };
  // 難しさごとの問題の量と時間（秒）
  const CONF = {
    words: {
      easy: { n: 15, memo: 120, recall: 180 },
      normal: { n: 20, memo: 120, recall: 180 },
      hard: { n: 30, memo: 120, recall: 180 },
    },
    grid: {
      easy: { size: 3, memo: 30, recall: 60 },
      normal: { size: 4, memo: 60, recall: 90 },
      hard: { size: 5, memo: 90, recall: 120 },
    },
    pair: {
      easy: { n: 6, memo: 60, reverse: false },
      normal: { n: 8, memo: 90, reverse: false },
      hard: { n: 12, memo: 120, reverse: true },  // 逆向き（相手から元を当てる）の問題もまぜる
    },
    // size：マスの数（size×size）、start：最初の長さ、flash／gap：1 マス光る時間と次までの間（ミリ秒）
    seq: {
      easy: { size: 2, start: 3, flash: 650, gap: 250, reverse: false },
      normal: { size: 3, start: 3, flash: 550, gap: 200, reverse: false },
      hard: { size: 3, start: 3, flash: 550, gap: 200, reverse: true },  // 光った順の逆から答える
    },
    // cols×rows のマスに items 個の絵。memo 秒見て、rounds 回くり返す
    spot: {
      easy: { cols: 3, rows: 3, items: 5, memo: 5, rounds: 10 },
      normal: { cols: 4, rows: 4, items: 8, memo: 5, rounds: 10 },
      hard: { cols: 5, rows: 4, items: 12, memo: 6, rounds: 10 },
    },
  };
  const PAIR_CHOICES = 4;      // ペア記憶の選択肢の数
  const BREAK_MS = 1500;       // 覚える時間と思い出す時間のあいだの間（ま）
  const SPOT_BREAK_MS = 900;   // なにが変わった？で絵をかくしておく時間
  const SEQ_LIVES = 3;         // 順番記憶のライフ
  const SEQ_TONES = [262, 330, 392, 523, 294, 349, 440, 494, 587];
  // なにが変わった？で使う絵
  const SPOT_ICONS = ['🍎', '🍌', '🍇', '🍓', '🍉', '🍒', '🍋', '🥕', '🌽', '🍄', '🐶', '🐱', '🐰', '🐻', '🐼', '🐸',
    '🐧', '🐟', '🐢', '🦋', '🌸', '🌻', '🌙', '⭐', '🌈', '⚽', '🏀', '🎈', '🎁', '🔑', '📚', '⏰',
    '🚗', '🚲', '🚀', '🏠', '🎸', '🎩', '👓', '🧦', '🍩', '🍙', '🍰', '🔔', '💎', '🌵', '🐙', '🦀'];
  const SPOT_KINDS = { add: '増えた', remove: '消えた', change: '入れ替わった' };

  // 称号。数字は正解率（%）の目安
  const RANKS = ['たまご', 'ひよこ', '見習い', '一人前', '達人', '記憶名人'];
  const RANK_PCT = [0, 20, 40, 60, 80, 95];
  // 順番記憶はつなげた長さで
  const RANK_SEQ = { easy: [0, 4, 6, 8, 10, 13], normal: [0, 4, 6, 8, 10, 12], hard: [0, 3, 5, 6, 8, 10] };

  // ---- 保存（キーは memory. で始める） ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('memory.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('memory.' + k, String(v)); } catch (e) { /* 保存できなくても遊べる */ } },
  };
  const opts = { mode: 'words', diff: 'normal' };
  for (const [k, table] of [['mode', MODES], ['diff', DIFFS]]) {
    const v = store.get(k, opts[k]);
    if (table[v]) opts[k] = v;
  }
  const bestKey = o => `best.${o.mode}.${o.diff}`;
  const getBest = o => Math.max(0, +store.get(bestKey(o), 0) || 0);

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
    count() { tone(520, 0.12, 'square', 0.05); },
    go() { tone(1047, 0.3, 'square', 0.06); },
    tick() { tone(880, 0.05, 'triangle', 0.04); },
    phase() { [659, 880].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, 0, i * 0.1)); },
    end() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.06, 0, i * 0.11)); },
    rec() { [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, 0, i * 0.09)); },
  };
  function updateSoundBtn() { $sound.classList.toggle('off', muted); }
  $sound.addEventListener('click', () => {
    muted = !muted; store.set('muted', muted ? '1' : '0'); updateSoundBtn();
    if (!muted) sfx.ok();
  });
  updateSoundBtn();

  // ---- 道具 ----
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // 答え合わせ用に書き方をそろえる（全角半角・カタカナ→ひらがな・空白を消す）
  function norm(s) {
    return String(s).normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s・]/g, '');
  }
  function fmtSec(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---- ゲームの状態 ----
  let G = null;
  let paused = false;
  let countToken = 0;
  const now = () => performance.now();
  // いまの段階（覚える・思い出す）が始まってからの時間（ポーズ中は止まる）
  function elapsed() { return G ? ((paused ? G.pausedAt : now()) - G.t0 - G.pauseTotal) : 0; }
  function setStats(labels) { labels.forEach((l, i) => { stats[i].lbl.textContent = l; }); }
  function setVal(i, v, cls) { stats[i].val.textContent = v; stats[i].val.className = cls || ''; }
  function stageHtml(html) { stage.innerHTML = `<div class="wrap">${html}</div>`; stage.scrollTop = 0; }

  // ---- 問題づくり ----
  function makeWords(n) {
    return shuffle(WORDS.slice()).slice(0, n).map(w => {
      const alts = w.split('|');
      return { text: alts[0], keys: alts.map(norm), hit: false };
    });
  }
  function makeGrid(size) {
    return Array.from({ length: size * size }, () => ri(1, 9));
  }
  function makePairs(n, reverse) {
    const th = pick(PAIR_THEMES);
    const L = shuffle(th.left.slice()).slice(0, n), R = shuffle(th.right.slice()).slice(0, n);
    const pairs = L.map((l, i) => ({ l, r: R[i] }));
    const qs = shuffle(pairs.map((p, i) => ({ i, rev: reverse && Math.random() < 0.5 })));
    return { theme: th, pairs, qs };
  }

  // ---- ゲーム開始 ----
  function start() {
    const o = { ...opts };
    const c = CONF[o.mode][o.diff];
    G = {
      o, c, mode: o.mode,
      phase: 'count', t0: 0, pauseTotal: 0, pausedAt: 0, limit: 0, lastSec: -1,
      memoUsed: 0,
    };
    if (o.mode === 'words') { G.words = makeWords(c.n); G.entries = []; }
    else if (o.mode === 'grid') { G.size = c.size; G.ans = makeGrid(c.size); G.inp = G.ans.map(() => 0); G.cur = 0; }
    else if (o.mode === 'seq') { G.len = c.start; G.best = 0; G.lives = SEQ_LIVES; G.miss = 0; G.seq = []; G.showTok = 0; }
    else if (o.mode === 'spot') { G.round = 0; G.correct = 0; G.results = []; }
    else { Object.assign(G, makePairs(c.n, c.reverse)); G.qi = 0; G.correct = 0; G.miss = 0; G.results = []; G.locked = false; }
    paused = false;
    hideOverlay();
    stage.classList.remove('paused');
    $pause.classList.add('hide');
    if (o.mode === 'seq') {
      setStats(['ライフ', 'ながさ', 'クリア']);
      setVal(0, hearts(SEQ_LIVES)); setVal(1, c.start); setVal(2, 0);
    } else if (o.mode === 'spot') {
      setStats(['のこり', 'ラウンド', '正解']);
      setVal(0, fmtSec(c.memo * 1000)); setVal(1, `0/${c.rounds}`); setVal(2, 0);
    } else {
      setStats(['のこり', 'いま', o.mode === 'words' ? '単語' : o.mode === 'grid' ? 'マス' : '組']);
      setVal(0, fmtSec(c.memo * 1000)); setVal(1, 'じゅんび');
      setVal(2, o.mode === 'words' ? c.n : o.mode === 'grid' ? c.size * c.size : c.n);
    }
    $bar.classList.toggle('hide', o.mode === 'seq');
    $bar.classList.remove('low');
    barFill.style.transform = 'scaleX(1)';
    const tok = ++countToken;
    const seq = ['3', '2', '1', o.mode === 'seq' ? 'スタート！' : 'おぼえて！'];
    seq.forEach((s, i) => setTimeout(() => {
      if (tok !== countToken) return;
      stageHtml(`<div class="count ${i === 3 ? 'go' : ''}">${s}</div>`);
      i === 3 ? sfx.go() : sfx.count();
    }, i * 650));
    setTimeout(() => { if (tok === countToken) (o.mode === 'seq' ? beginSeq : beginMemo)(); }, seq.length * 650);
  }

  function enterPhase(phase, limitSec) {
    G.phase = phase; G.t0 = now(); G.pauseTotal = 0; G.limit = limitSec * 1000; G.lastSec = -1;
    $pause.classList.remove('hide');
    $bar.classList.toggle('hide', !limitSec);
    $bar.classList.remove('low');
    barFill.style.transform = 'scaleX(1)';
  }

  // ---- 覚える時間 ----
  function beginMemo() {
    if (G.mode === 'spot') { spotMemo(); return; }
    enterPhase('memo', G.c.memo);
    setVal(1, '覚える');
    const done = '<button class="act" data-act="memodone">覚えた！ 思い出す画面へ</button>';
    if (G.mode === 'words') {
      stageHtml(`<p class="guide">この ${G.words.length} 個の単語を覚えよう</p>
        <div class="words">${G.words.map(w => `<span class="${w.text.length >= 7 ? 'long' : ''}">${esc(w.text)}</span>`).join('')}</div>${done}`);
    } else if (G.mode === 'grid') {
      stageHtml(`<p class="guide">数字と場所を覚えよう</p>${gridHtml(i => G.ans[i])}${done}`);
      fitGrid();
    } else {
      stageHtml(`<p class="guide">${esc(G.theme.name)}の組み合わせを覚えよう</p>
        <div class="pairs">${G.pairs.map(p => `<div><span class="l">${esc(p.l)}</span><span class="dash">―</span><span class="r">${esc(p.r)}</span></div>`).join('')}</div>${done}`);
    }
  }

  // 覚える時間が終わったら、少し間をあけてから思い出す時間へ
  function endMemo() {
    if (!G || G.phase !== 'memo') return;
    G.memoUsed = Math.min(elapsed(), G.limit);
    G.phase = 'break';
    $pause.classList.add('hide');
    const tok = ++countToken;
    if (G.mode === 'spot') {
      // 絵をいったんかくす（かくさないと、変わったところが動きで見えてしまう）
      sfx.key();
      setVal(0, '-');
      $bar.classList.add('hide');
      stageHtml(`${spotHtml(() => '', false, true)}`);
      fitBoard();
      setTimeout(() => { if (tok === countToken && G && G.phase === 'break') spotRecall(); }, SPOT_BREAK_MS);
      return;
    }
    sfx.phase();
    setVal(1, '');
    stageHtml(`<div class="breakmsg">${G.mode === 'pair' ? 'では、問題です' : 'では、思い出してみよう'}</div>`);
    setTimeout(() => { if (tok === countToken && G && G.phase === 'break') beginRecall(); }, BREAK_MS);
  }

  // ---- 思い出す時間 ----
  function beginRecall() {
    if (G.mode === 'words') {
      enterPhase('recall', G.c.recall);
      setVal(1, '書き出す'); setStats(['のこり', 'いま', '入れた数']); setVal(2, 0);
      stageHtml(`<div class="recall">
        <p class="guide">覚えた単語を思い出せるだけ入れよう（ひらがな・カタカナ・漢字どれでもOK）</p>
        <div class="inrow"><input id="win" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="enter" placeholder="単語を入れて Enter"><button data-act="add">入れる</button></div>
        <p class="note">スペースや「、」で区切ってまとめて入れてもOK。消したいときは単語をタップ。</p>
        <div class="chips" id="chips"></div>
        <button class="act" data-act="finish">答え合わせ</button>
      </div>`);
      const inp = $('win');
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault(); addEntries();
      });
      inp.focus();
    } else if (G.mode === 'grid') {
      enterPhase('recall', G.c.recall);
      setVal(1, '穴埋め'); setStats(['のこり', 'いま', '入れたマス']); setVal(2, 0);
      G.cur = 0;
      stageHtml(`<p class="guide">マスをえらんで数字を入れよう</p>${gridHtml(() => '', true)}
        <div class="numpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-num="${n}">${n}</button>`).join('')}<button data-num="0" class="fn">消す</button></div>
        <button class="act" data-act="finish">答え合わせ</button>`);
      fitGrid(true);
      drawGridInput();
    } else {
      enterPhase('recall', 0);
      setStats(['問題', '正解', 'ミス']);
      setVal(1, 0); setVal(2, 0);
      nextPairQ();
    }
  }

  // ---- 単語おぼえ書き ----
  function addEntries() {
    const inp = $('win'); if (!inp) return;
    const parts = inp.value.split(/[\s、,，。.]+/).map(s => s.trim()).filter(Boolean);
    inp.value = '';
    let added = 0;
    for (const p of parts) {
      const k = norm(p);
      if (!k || G.entries.some(e => e.key === k)) continue;
      G.entries.push({ text: p, key: k });
      added++;
    }
    if (added) sfx.key();
    else if (parts.length) { shake(inp); sfx.ng(); }
    drawChips();
    inp.focus();
  }
  function drawChips() {
    const box = $('chips'); if (!box) return;
    box.innerHTML = G.entries.map((e, i) => `<button data-del="${i}">${esc(e.text)}</button>`).join('');
    setVal(2, G.entries.length);
  }
  function scoreWords() {
    G.words.forEach(w => { w.hit = false; });
    for (const e of G.entries) {
      const w = G.words.find(x => !x.hit && x.keys.includes(e.key));
      e.ok = !!w;
      if (w) w.hit = true;
    }
    return G.words.filter(w => w.hit).length;
  }

  // ---- 数字マス記憶 ----
  function gridHtml(cell, input) {
    const n = G.size;
    let h = `<div class="mgrid${input ? ' input' : ''}" id="mgrid" style="--n:${n}">`;
    for (let i = 0; i < n * n; i++) h += input ? `<button data-cell="${i}">${cell(i)}</button>` : `<div>${cell(i)}</div>`;
    return h + '</div>';
  }
  // マスの大きさを画面に合わせる
  function fitGrid(withPad) {
    const g = $('mgrid'); if (!g) return;
    const r = stage.getBoundingClientRect();
    const reserve = withPad ? 230 : 120;
    const cs = Math.floor(Math.max(36, Math.min(96, (r.width - 32) / G.size, (r.height - reserve) / G.size)));
    g.style.setProperty('--cs', cs + 'px');
  }
  function drawGridInput() {
    const g = $('mgrid'); if (!g) return;
    [...g.children].forEach((c, i) => {
      c.textContent = G.inp[i] || '';
      c.classList.toggle('cur', i === G.cur);
    });
    setVal(2, G.inp.filter(v => v).length);
  }
  function gridNum(n) {
    if (!G || G.phase !== 'recall' || G.mode !== 'grid') return;
    sfx.key();
    G.inp[G.cur] = n;
    if (n) G.cur = (G.cur + 1) % G.inp.length;
    drawGridInput();
  }
  function gridMove(dx, dy) {
    const n = G.size;
    let x = G.cur % n + dx, y = Math.floor(G.cur / n) + dy;
    x = (x + n) % n; y = (y + n) % n;
    G.cur = y * n + x;
    drawGridInput();
  }

  // ---- ペア記憶 ----
  function nextPairQ() {
    if (G.qi >= G.qs.length) { finish(); return; }
    const q = G.qs[G.qi], p = G.pairs[q.i];
    const side = q.rev ? 'l' : 'r';
    const others = shuffle(G.pairs.filter((x, j) => j !== q.i).map(x => x[side])).slice(0, PAIR_CHOICES - 1);
    q.choices = shuffle([p[side], ...others]);
    q.answer = p[side];
    G.locked = false;
    setVal(0, `${G.qi + 1}/${G.qs.length}`);
    const th = G.theme;
    const ask = q.rev ? `<b>${esc(p.r)}</b>${esc(th.rq)}` : `<b>${esc(p.l)}</b>${esc(th.q)}`;
    stageHtml(`<div class="pq">
      <p class="qno">第 ${G.qi + 1} 問${q.rev ? '<span class="rev">逆から</span>' : ''}</p>
      <p class="ask">${ask}</p>
      <div class="choices">${q.choices.map((c, k) => `<button data-choice="${k}"><small>${k + 1}</small>${esc(c)}</button>`).join('')}</div>
    </div>`);
  }
  function choosePair(k) {
    if (!G || G.phase !== 'recall' || G.mode !== 'pair' || G.locked) return;
    const q = G.qs[G.qi];
    if (k < 0 || k >= q.choices.length) return;
    G.locked = true;
    const ok = q.choices[k] === q.answer;
    const btns = stage.querySelectorAll('.choices button');
    btns.forEach((b, j) => { if (q.choices[j] === q.answer) b.classList.add('ans'); });
    if (!ok) btns[k].classList.add('ng');
    G.results.push({ q, ok, given: q.choices[k] });
    if (ok) { G.correct++; sfx.ok(); } else { G.miss++; sfx.ng(); }
    setVal(1, G.correct); setVal(2, G.miss);
    showMark(ok);
    const g = G;
    setTimeout(() => { if (G === g && G.phase === 'recall') { G.qi++; nextPairQ(); } }, ok ? 650 : 1300);
  }

  // ---- 順番記憶 ----
  const hearts = n => '♥\uFE0E'.repeat(Math.max(0, n)) + '♡\uFE0E'.repeat(Math.max(0, SEQ_LIVES - n));
  function seqRand(prev) {
    const n = G.c.size * G.c.size;
    let v;
    do { v = ri(0, n - 1); } while (v === prev);  // 同じマスが続かないように
    return v;
  }
  function beginSeq() {
    enterPhase('recall', 0);
    const n = G.c.size;
    stageHtml(`<p class="guide" id="sguide"></p>
      <div class="spad" id="spad" style="--n:${n}">${Array.from({ length: n * n }, (_, i) => `<button data-sp="${i}" class="c${i}"></button>`).join('')}</div>
      <p class="note">${G.c.reverse ? '光った順番の<b>逆から</b>タップ！' : '光った順番どおりにタップ'}</p>`);
    fitBoard();
    G.seq = [];
    for (let i = 0; i < G.len; i++) G.seq.push(seqRand(G.seq[i - 1]));
    playSeq();
  }
  function seqLight(i, ms) {
    const b = stage.querySelector(`[data-sp="${i}"]`); if (!b) return;
    b.classList.add('lit');
    tone(SEQ_TONES[i], ms / 1000, 'triangle', 0.08);
    setTimeout(() => b.classList.remove('lit'), ms);
  }
  function playSeq() {
    G.showing = true; G.pos = 0; G.locked = true;
    const tok = ++G.showTok, g = G, c = G.c;
    const live = () => G === g && tok === G.showTok && !paused && G.phase === 'recall';
    const guide = $('sguide');
    if (guide) guide.textContent = `よく見て…（${G.seq.length} 個）`;
    $('spad') && $('spad').classList.add('watch');
    G.seq.forEach((v, k) => setTimeout(() => { if (live()) seqLight(v, c.flash); }, 700 + k * (c.flash + c.gap)));
    setTimeout(() => {
      if (!live()) return;
      G.showing = false; G.locked = false;
      $('spad') && $('spad').classList.remove('watch');
      if (guide) guide.textContent = c.reverse ? 'あなたの番！ 逆の順に' : 'あなたの番！';
    }, 700 + G.seq.length * (c.flash + c.gap));
  }
  function tapSeq(i) {
    if (!G || G.mode !== 'seq' || G.phase !== 'recall' || G.locked || paused) return;
    if (i < 0 || i >= G.c.size * G.c.size) return;
    const L = G.seq.length;
    const want = G.c.reverse ? G.seq[L - 1 - G.pos] : G.seq[G.pos];
    const g = G;
    if (i === want) {
      seqLight(i, 220);
      G.pos++;
      if (G.pos < L) return;
      // ぜんぶ合っていた
      G.locked = true;
      G.best = Math.max(G.best, L);
      setVal(2, G.best);
      showMark(true); sfx.ok();
      setTimeout(() => {
        if (G !== g || G.phase !== 'recall') return;
        G.len++; G.seq.push(seqRand(G.seq[L - 1]));
        setVal(1, G.len);
        playSeq();
      }, 900);
    } else {
      G.locked = true;
      G.lives--; G.miss++;
      setVal(0, hearts(G.lives));
      showMark(false); sfx.ng();
      const b = stage.querySelector(`[data-sp="${want}"]`);
      if (b) b.classList.add('hint');
      shake($('spad'));
      setTimeout(() => {
        if (G !== g || G.phase !== 'recall') return;
        if (b) b.classList.remove('hint');
        if (G.lives <= 0) { finish(); return; }
        // 同じ長さで新しい順番に
        G.seq = [];
        for (let k = 0; k < G.len; k++) G.seq.push(seqRand(G.seq[k - 1]));
        playSeq();
      }, 1400);
    }
  }

  // ---- なにが変わった？ ----
  function spotHtml(cell, input, masked) {
    const c = G.c;
    let h = `<div class="sboard${input ? ' input' : ''}${masked ? ' masked' : ''}" id="sboard" style="--cols:${c.cols};--rows:${c.rows}">`;
    for (let i = 0; i < c.cols * c.rows; i++) h += input ? `<button data-spot="${i}">${cell(i)}</button>` : `<div>${cell(i)}</div>`;
    return h + '</div>';
  }
  function spotMemo() {
    const c = G.c, n = c.cols * c.rows;
    G.round++;
    // 新しい盤面：items 個の絵をばらばらの場所に置く
    const icons = shuffle(SPOT_ICONS.slice());
    const cells = shuffle([...Array(n).keys()]).slice(0, c.items);
    G.board = Array(n).fill('');
    cells.forEach((p, k) => { G.board[p] = icons[k]; });
    G.spare = icons.slice(c.items);
    enterPhase('memo', c.memo);
    setVal(1, `${G.round}/${c.rounds}`);
    stageHtml(`<p class="guide">絵と場所を覚えよう</p>${spotHtml(i => G.board[i])}
      <button class="act" data-act="memodone">覚えた！</button>`);
    fitBoard();
  }
  function spotRecall() {
    const filled = [], empty = [];
    G.board.forEach((v, i) => (v ? filled : empty).push(i));
    const kinds = ['remove', 'change'];
    if (empty.length) kinds.push('add');
    const kind = pick(kinds);
    const after = G.board.slice();
    let idx;
    if (kind === 'add') { idx = pick(empty); after[idx] = G.spare[0]; }
    else if (kind === 'remove') { idx = pick(filled); after[idx] = ''; }
    else { idx = pick(filled); after[idx] = G.spare[1]; }
    G.change = { kind, idx, before: G.board[idx], after: after[idx] };
    G.after = after;
    enterPhase('recall', 0);
    setVal(0, '-');
    G.locked = false;
    stageHtml(`<p class="guide">どこが変わった？ 変わったマスをタップ</p>${spotHtml(i => after[i], true)}`);
    fitBoard();
  }
  function tapSpot(i) {
    if (!G || G.mode !== 'spot' || G.phase !== 'recall' || G.locked || paused) return;
    G.locked = true;
    const ch = G.change, ok = i === ch.idx;
    G.results.push({ kind: ch.kind, ok });
    if (ok) { G.correct++; sfx.ok(); } else sfx.ng();
    setVal(2, G.correct);
    showMark(ok);
    const cells = stage.querySelectorAll('#sboard > button');
    if (!ok && cells[i]) cells[i].classList.add('ng');
    if (cells[ch.idx]) cells[ch.idx].classList.add('ans');
    const desc = ch.kind === 'add' ? `${ch.after} が増えた`
      : ch.kind === 'remove' ? `${ch.before} が消えた` : `${ch.before} → ${ch.after} に入れ替わった`;
    const guide = stage.querySelector('.guide');
    if (guide) guide.innerHTML = `<span class="${ok ? 'okmsg' : 'ngmsg'}">${ok ? '正解！' : 'ざんねん'}</span> ${esc(desc)}`;
    const g = G;
    setTimeout(() => {
      if (G !== g || G.phase !== 'recall') return;
      if (G.round >= G.c.rounds) finish(); else spotMemo();
    }, ok ? 1100 : 2000);
  }

  // マス（順番記憶・なにが変わった？）の大きさを画面に合わせる
  function fitBoard() {
    if (!G) return;
    const el = $('spad') || $('sboard'); if (!el) return;
    const r = stage.getBoundingClientRect();
    const cols = G.mode === 'seq' ? G.c.size : G.c.cols, rows = G.mode === 'seq' ? G.c.size : G.c.rows;
    const seq = G.mode === 'seq', gap = seq ? 10 : 6;
    const reserve = seq ? 130 : 150, max = seq ? 150 : 100;
    const cs = Math.floor(Math.max(40, Math.min(max,
      (r.width - 36 - gap * (cols - 1)) / cols, (r.height - reserve - gap * (rows - 1)) / rows)));
    el.style.setProperty('--cs', cs + 'px');
  }

  function showMark(ok) {
    const m = document.createElement('div');
    m.className = 'mark show' + (ok ? '' : ' ng');
    m.textContent = ok ? '○' : '×';
    stage.appendChild(m);
    setTimeout(() => m.remove(), 500);
  }
  function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  // ---- ポーズ ----
  function pause() {
    if (!G || (G.phase !== 'memo' && G.phase !== 'recall') || paused) return;
    paused = true; G.pausedAt = now();
    stage.classList.add('paused');
    if (G.mode === 'seq' && G.showing) G.showTok++;  // 見せている途中なら、つづけるときに最初から見せ直す
    if (document.activeElement) document.activeElement.blur();
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
    const inp = $('win'); if (inp) inp.focus();
    if (G.mode === 'seq' && G.showing) {
      stage.querySelectorAll('.spad .lit').forEach(b => b.classList.remove('lit'));
      playSeq();
    }
  }
  $pause.addEventListener('click', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ---- 毎フレームの処理（のこり時間） ----
  function loop() {
    requestAnimationFrame(loop);
    if (!G || paused || (G.phase !== 'memo' && G.phase !== 'recall') || !G.limit) return;
    const left = G.limit - elapsed();
    const sec = Math.ceil(left / 1000);
    const low = sec <= 10 && G.limit > 20000;  // 短い時間（なにが変わった？）では急かさない
    setVal(0, fmtSec(left), low ? 'low' : '');
    barFill.style.transform = `scaleX(${Math.max(0, left / G.limit)})`;
    $bar.classList.toggle('low', low);
    if (low && sec !== G.lastSec && sec > 0) sfx.tick();
    G.lastSec = sec;
    if (left <= 0) { G.phase === 'memo' ? endMemo() : finish(); }
  }
  requestAnimationFrame(loop);

  // ---- 結果 ----
  function rankIndex(pct) { let r = 0; RANK_PCT.forEach((x, i) => { if (pct >= x) r = i; }); return r; }
  function rankSeq(diff, v) { let r = 0; RANK_SEQ[diff].forEach((x, i) => { if (v >= x) r = i; }); return r; }
  function finish() {
    if (!G || G.phase !== 'recall') return;
    const recallMs = elapsed();
    if (G.mode === 'words') { const inp = $('win'); if (inp && inp.value.trim()) addEntries(); }  // 入れかけの単語も数える
    G.phase = 'over';
    $pause.classList.add('hide');
    if (document.activeElement) document.activeElement.blur();
    const o = G.o;
    let value, total, rows = [], detail = '';
    if (o.mode === 'words') {
      value = scoreWords(); total = G.words.length;
      const wrong = G.entries.filter(e => !e.ok);
      rows = [['入れた数', `${G.entries.length} 個`], ['まちがい', `${wrong.length} 個`]];
      detail = `<div class="wlist">${G.words.map(w => `<span class="${w.hit ? 'hit' : 'miss'}">${esc(w.text)}</span>`).join('')}</div>
        <p class="legend"><span class="hit">思い出せた</span> <span class="miss">わすれた</span></p>
        ${wrong.length ? `<div class="miss-list">リストになかった単語<br>${wrong.map(e => esc(e.text)).join('、')}</div>` : ''}`;
    } else if (o.mode === 'grid') {
      total = G.ans.length;
      value = G.ans.filter((v, i) => G.inp[i] === v).length;
      const wrong = G.inp.filter((v, i) => v && v !== G.ans[i]).length;
      rows = [['まちがい', `${wrong} マス`], ['空らん', `${G.inp.filter(v => !v).length} マス`]];
      detail = `<div class="mgrid result" style="--n:${G.size};--cs:${G.size > 4 ? 44 : 52}px">${G.ans.map((v, i) => {
        const g = G.inp[i];
        if (g === v) return `<div class="ok">${v}</div>`;
        if (!g) return `<div class="blank">${v}</div>`;
        return `<div class="ng"><s>${g}</s><b>${v}</b></div>`;
      }).join('')}</div>
        <p class="legend"><span class="ok">正解</span> <span class="ng">まちがい（右下が正しい数）</span> <span class="blank">空らん</span></p>`;
    } else if (o.mode === 'seq') {
      value = G.best; total = 0;
      rows = [['順番', G.c.reverse ? '逆から' : 'そのまま'], ['マス', `${G.c.size}×${G.c.size}`]];
    } else if (o.mode === 'spot') {
      value = G.correct; total = G.c.rounds;
      rows = Object.entries(SPOT_KINDS).map(([k, name]) => {
        const rs = G.results.filter(x => x.kind === k);
        return [name, rs.length ? `${rs.filter(x => x.ok).length} / ${rs.length}` : '-'];
      });
    } else {
      total = G.qs.length; value = G.correct;
      rows = [['テーマ', esc(G.theme.name)]];
      detail = `<div class="plist">${G.pairs.map((p, i) => {
        const r = G.results.find(x => x.q.i === i);
        return `<div class="${r && r.ok ? 'hit' : 'miss'}"><span>${r && r.ok ? '○' : '×'}</span>${esc(p.l)} ― ${esc(p.r)}${r && !r.ok ? `<small>（${esc(r.given)} を選んだ）</small>` : ''}</div>`;
      }).join('')}</div>`;
    }
    const pct = total ? Math.round(value / total * 100) : 0;
    if (total) rows.unshift(['正解率', `${pct}%`]);
    if (o.mode === 'words' || o.mode === 'grid' || o.mode === 'pair') rows.push(['覚えた時間', `${fmtSec(G.memoUsed)}（${fmtSec(G.c.memo * 1000)} 中）`]);
    if (o.mode === 'words' || o.mode === 'grid') rows.push(['思い出した時間', `${fmtSec(Math.min(recallMs, G.limit))}`]);
    rows.push(['難しさ', DIFFS[o.diff].name]);
    const prev = getBest(o);
    const isRec = value > prev;
    if (isRec) store.set(bestKey(o), value);
    recordDay(value);
    const r = o.mode === 'seq' ? rankSeq(o.diff, value) : rankIndex(pct);
    isRec ? sfx.rec() : sfx.end();
    const need = o.mode === 'seq' ? RANK_SEQ[o.diff][r + 1] - value : Math.ceil(total * RANK_PCT[r + 1] / 100) - value;
    const next = r >= RANKS.length - 1 ? '最高の称号です！' : `「${RANKS[r + 1]}」まで あと ${Math.max(1, need)} 個`;
    const unit = v => total ? `${v} / ${total}` : `${v} 個`;
    stageHtml('');
    showPanel(`<h2>${MODES[o.mode].name}</h2>
      <div class="big">${value}<small>${total ? ` / ${total}` : ' 個 つなげた'}</small></div>
      ${isRec ? '<div class="newrec">★ 自己ベスト更新！ ★</div>' : ''}
      <div class="rank">称号：${RANKS[r]}</div>
      <p class="comment">${next}</p>
      ${detail}
      <table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}
        <tr><td>自己ベスト</td><td>${unit(Math.max(prev, value))}</td></tr></table>
      <button class="go" data-act="retry">もう一度</button><br>
      <button class="sub2" data-act="title">モードをえらぶ</button>`);
  }

  // ---- 画面（タイトル・ポーズ・結果） ----
  function showPanel(html) {
    overlay.innerHTML = `<div class="panel">${html}</div>`;
    overlay.classList.remove('hidden');
    const p = overlay.firstElementChild; if (p) p.scrollTop = 0;
  }
  function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

  function confText(mode, diff) {
    const c = CONF[mode][diff];
    if (mode === 'words') return `単語 ${c.n} 個・覚える ${c.memo / 60} 分・書き出す ${c.recall / 60} 分`;
    if (mode === 'grid') return `${c.size}×${c.size} マス・覚える ${c.memo} 秒・穴埋め ${c.recall} 秒`;
    if (mode === 'seq') return `${c.size}×${c.size} マス・${c.start} 個から・ライフ ${SEQ_LIVES}${c.reverse ? '・逆の順に答える' : ''}`;
    if (mode === 'spot') return `${c.cols}×${c.rows} マスに絵 ${c.items} 個・見る ${c.memo} 秒・${c.rounds} 回`;
    return `${c.n} 組・覚える ${c.memo} 秒・${PAIR_CHOICES} 択${c.reverse ? '（逆向きの問題もあり）' : ''}`;
  }
  function showTitle() {
    countToken++;
    G = null; paused = false;
    $pause.classList.add('hide');
    stage.classList.remove('paused');
    stageHtml('');
    setStats(['のこり', 'いま', '数']); [0, 1, 2].forEach(i => setVal(i, '-'));
    $bar.classList.add('hide');
    const d = daily();
    const total = o => o.mode === 'words' ? CONF.words[o.diff].n : o.mode === 'grid' ? CONF.grid[o.diff].size ** 2
      : o.mode === 'spot' ? CONF.spot[o.diff].rounds : CONF.pair[o.diff].n;
    showPanel(`<h1>記憶道場</h1>
      <p class="sub">覚えて、思い出す。毎日の記憶トレーニング</p>
      <div class="today"><span>連続 <b>${d.streak}</b> 日</span><span>今日おぼえた <b>${d.count}</b> 個</span><span>これまで <b>${d.total}</b> 個</span></div>
      <div class="modes">${Object.entries(MODES).map(([k, m]) => {
        const o = { mode: k, diff: opts.diff }, b = getBest(o);
        return `<button data-mode="${k}" class="${opts.mode === k ? 'on' : ''}"><span class="badge">${m.badge}</span>
          <span class="nm">${m.name}<small>${b ? (k === 'seq' ? `ベスト ${b}個` : `ベスト ${b}/${total(o)}`) : ''}</small></span><span class="ds">${m.desc}</span></button>`;
      }).join('')}</div>
      <div class="opt"><span class="lbl">難しさ</span><div class="row">${Object.entries(DIFFS).map(([k, v]) =>
        `<button data-opt="diff" data-v="${k}" class="${opts.diff === k ? 'on' : ''}">${v.name}</button>`).join('')}</div>
        <span class="conf">${confText(opts.mode, opts.diff)}</span></div>
      <button class="go" data-act="start">スタート</button>
      <p class="keys-help">覚え終わったら「覚えた！」で早めに進めます。<br>PC：Esc でポーズ／数字マスは数字キー・矢印キー・Backspace／順番記憶は 1〜9 キー（左上から）／ペア記憶は 1〜4 キー</p>
      <a href="../index.html">← ゲーム一覧へ</a>`);
  }

  // ---- 入力 ----
  overlay.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    audio();  // スマホで音を出せるようにする
    if (b.dataset.mode) { opts.mode = b.dataset.mode; store.set('mode', opts.mode); sfx.key(); showTitle(); return; }
    if (b.dataset.opt) { opts[b.dataset.opt] = b.dataset.v; store.set(b.dataset.opt, b.dataset.v); sfx.key(); showTitle(); return; }
    const act = b.dataset.act;
    if (act === 'start' || act === 'retry') { if (G && act === 'retry') Object.assign(opts, G.o); start(); }
    else if (act === 'resume') resume();
    else if (act === 'title') showTitle();
  });

  stage.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !G || paused) return;
    const d = b.dataset;
    if (d.act === 'memodone') endMemo();
    else if (d.act === 'finish') finish();
    else if (d.act === 'add') addEntries();
    else if (d.del !== undefined) {
      G.entries.splice(+d.del, 1); sfx.key(); drawChips();
    } else if (d.cell !== undefined) { G.cur = +d.cell; sfx.key(); drawGridInput(); }
    else if (d.num !== undefined) gridNum(+d.num);
    else if (d.choice !== undefined) choosePair(+d.choice);
    else if (d.sp !== undefined) tapSeq(+d.sp);
    else if (d.spot !== undefined) tapSpot(+d.spot);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (paused) resume(); else pause();
      e.preventDefault(); return;
    }
    if (!overlay.classList.contains('hidden')) {
      if (e.key === 'Enter' || e.key === ' ') {
        const b = overlay.querySelector('button.go');
        if (b) { e.preventDefault(); b.click(); }
      }
      return;
    }
    if (!G || paused || e.target.tagName === 'INPUT') return;
    if (G.mode === 'grid' && G.phase === 'recall') {
      if (/^[1-9]$/.test(e.key)) gridNum(+e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') gridNum(0);
      else if (e.key === 'ArrowLeft') gridMove(-1, 0);
      else if (e.key === 'ArrowRight') gridMove(1, 0);
      else if (e.key === 'ArrowUp') gridMove(0, -1);
      else if (e.key === 'ArrowDown') gridMove(0, 1);
      else return;
      e.preventDefault();
    } else if (G.mode === 'pair' && G.phase === 'recall' && /^[1-9]$/.test(e.key)) {
      choosePair(+e.key - 1);
    } else if (G.mode === 'seq' && /^[1-9]$/.test(e.key)) {
      tapSeq(+e.key - 1);
    }
  });
  window.addEventListener('resize', () => {
    if (G && G.mode === 'grid' && (G.phase === 'memo' || G.phase === 'recall')) fitGrid(G.phase === 'recall');
    if (G && (G.mode === 'seq' || G.mode === 'spot')) fitBoard();
  });

  showTitle();
})();
