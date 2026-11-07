'use strict';
// 手書き数字の読み取り（計算道場）。
// 書いた線を 28×28 の画像にして、小さなニューラルネット（CNN）で 0〜9 を判定する。
// 学習は MNIST と pen-based digits（UCI）で行い、重みは handwriting-model.js に入っている。
(function (root) {
  const SIZE = 28, BOX = 20, SS = 4;   // 画像の大きさ・数字を収める枠・描くときの拡大率
  const BIG = SIZE * SS;

  // strokes: [[[x, y], ...], ...]（画面の座標。y は下向き）
  // → 長さ 784 の Float32Array（0〜1。背景 0、線 1）
  function prepare(strokes, opt) {
    const radius = (opt && opt.radius) || 1.35;
    const pts = [];
    for (const s of strokes) for (const p of s) pts.push(p);
    if (!pts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const w = x1 - x0, h = y1 - y0;
    const size = Math.max(w, h);
    // 縦横比を保って 20×20 に収める（点だけのときは小さな丸）
    const sc = size > 0 ? BOX / size : 1;
    const map = (dx, dy) => strokes.map(s => s.map(([x, y]) => [(x - x0 - w / 2) * sc + SIZE / 2 + dx, (y - y0 - h / 2) * sc + SIZE / 2 + dy]));
    let img = render(map(0, 0), radius);
    // 重心が真ん中に来るようにずらして描き直す（MNIST と同じやり方）
    let m = 0, mx = 0, my = 0;
    for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) { const v = img[i * SIZE + j]; m += v; mx += v * (j + 0.5); my += v * (i + 0.5); }
    if (m > 0) {
      const dx = Math.max(-4, Math.min(4, SIZE / 2 - mx / m)), dy = Math.max(-4, Math.min(4, SIZE / 2 - my / m));
      img = render(map(dx, dy), radius);
    }
    return img;
  }

  // 線を 4 倍の細かさで塗ってから 28×28 に平均して、なめらかにする
  function render(strokes, radius) {
    const big = new Uint8Array(BIG * BIG);
    const r = radius * SS, r2 = r * r;
    const stamp = (cx, cy) => {
      const xa = Math.max(0, Math.floor(cx - r)), xb = Math.min(BIG - 1, Math.ceil(cx + r));
      const ya = Math.max(0, Math.floor(cy - r)), yb = Math.min(BIG - 1, Math.ceil(cy + r));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const ddx = x + 0.5 - cx, ddy = y + 0.5 - cy;
        if (ddx * ddx + ddy * ddy <= r2) big[y * BIG + x] = 1;
      }
    };
    for (const s of strokes) {
      if (!s.length) continue;
      let [px, py] = s[0]; px *= SS; py *= SS;
      stamp(px, py);
      for (let k = 1; k < s.length; k++) {
        const qx = s[k][0] * SS, qy = s[k][1] * SS;
        const d = Math.hypot(qx - px, qy - py), n = Math.ceil(d / 1.5);
        for (let t = 1; t <= n; t++) stamp(px + (qx - px) * t / n, py + (qy - py) * t / n);
        px = qx; py = qy;
      }
    }
    const img = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) {
      let s = 0;
      for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) s += big[(i * SS + a) * BIG + j * SS + b];
      img[i * SIZE + j] = s / (SS * SS);
    }
    return img;
  }

  // ---- ニューラルネット（推論だけ） ----
  // conv3x3(1→c1)+ReLU+pool → conv3x3(c1→c2)+ReLU+pool → conv3x3(c2→c3)+ReLU+pool → 全結合(→h)+ReLU → 全結合(→10)
  let net = null;
  function decode(m) {
    // 重みは int8 を base64 にしたもの。層ごとに倍率 scale がついている
    const bin = typeof atob === 'function' ? atob(m.data) : Buffer.from(m.data, 'base64').toString('binary');
    const q = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24;
    const layers = {};
    let off = 0;
    for (const L of m.layers) {
      const n = L.shape.reduce((a, b) => a * b, 1);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = q[off + i] * L.scale;
      off += n;
      layers[L.name] = { w: f, shape: L.shape };
    }
    return layers;
  }
  function conv(inp, C, H, W, k, bias, O) {
    // 3×3・パディング 1
    const out = new Float32Array(O * H * W);
    for (let o = 0; o < O; o++) {
      const b = bias[o];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = b;
        for (let c = 0; c < C; c++) {
          const ib = c * H * W, kb = (o * C + c) * 9;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy; if (yy < 0 || yy >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx; if (xx < 0 || xx >= W) continue;
              s += inp[ib + yy * W + xx] * k[kb + (dy + 1) * 3 + dx + 1];
            }
          }
        }
        out[o * H * W + y * W + x] = s > 0 ? s : 0;
      }
    }
    return out;
  }
  function pool(inp, C, H, W) {
    const h = Math.floor(H / 2), w = Math.floor(W / 2), out = new Float32Array(C * h * w);
    for (let c = 0; c < C; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = c * H * W + 2 * y * W + 2 * x;
      out[c * h * w + y * w + x] = Math.max(inp[i], inp[i + 1], inp[i + W], inp[i + W + 1]);
    }
    return out;
  }
  function dense(inp, W, b, relu) {
    const O = b.length, I = inp.length, out = new Float32Array(O);
    for (let o = 0; o < O; o++) {
      let s = b[o];
      for (let i = 0; i < I; i++) s += inp[i] * W[o * I + i];
      out[o] = relu && s < 0 ? 0 : s;
    }
    return out;
  }
  function forward(img) {
    const L = net;
    let a = img, C = 1, H = SIZE, W = SIZE;
    for (const n of ['c1', 'c2', 'c3']) {
      const O = L[n + '.w'].shape[0];
      a = conv(a, C, H, W, L[n + '.w'].w, L[n + '.b'].w, O);
      a = pool(a, O, H, W);
      C = O; H = Math.floor(H / 2); W = Math.floor(W / 2);
    }
    a = dense(a, L['f1.w'].w, L['f1.b'].w, true);
    const z = dense(a, L['f2.w'].w, L['f2.b'].w, false);
    let mx = -Infinity; for (const v of z) if (v > mx) mx = v;
    let sum = 0; const p = new Float32Array(10);
    for (let i = 0; i < 10; i++) { p[i] = Math.exp(z[i] - mx); sum += p[i]; }
    for (let i = 0; i < 10; i++) p[i] /= sum;
    return p;
  }

  // 0〜9 それぞれの確からしさ（合計 1）。読み取れないときは null
  function predict(strokes) {
    if (!net) {
      const m = root.HW_MODEL || (typeof require === 'function' ? require('./handwriting-model.js') : null);
      if (!m) return null;
      net = decode(m);
    }
    const img = prepare(strokes);
    return img ? forward(img) : null;
  }
  function setModel(m) { net = decode(m); }

  const api = { prepare, predict, setModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HW = api;
})(typeof window !== 'undefined' ? window : globalThis);
