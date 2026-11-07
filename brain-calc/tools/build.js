// pendigits → 28×28 画像（ゲームと同じ prepare を使う）
const fs = require('fs');
const parse = require('./parse.js');
const DATA = process.argv[2] || 'data';
const HW = require('../handwriting.js');
const flip = s => s.strokes.map(st => st.map(([x, y]) => [x, -y]));
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const U = (a, b) => a + (b - a) * rnd();
function augment(strokes) {
  const th = U(-0.22, 0.22), sh = U(-0.3, 0.3), sx = U(0.8, 1.2), sy = U(0.8, 1.2);
  const c = Math.cos(th), s = Math.sin(th);
  return strokes.map(st => st.map(([x, y]) => {
    x = x * sx + y * sh; y = y * sy;
    return [x * c - y * s + U(-1.5, 1.5), x * s + y * c + U(-1.5, 1.5)];
  }));
}
function build(file, out, copies) {
  const d = parse(file);
  const n = d.length * copies;
  const X = Buffer.alloc(n * 784), Y = Buffer.alloc(n);
  let k = 0;
  for (const smp of d) for (let c = 0; c < copies; c++) {
    const st = c === 0 ? flip(smp) : augment(flip(smp));
    const img = HW.prepare(st, { radius: c === 0 ? 1.35 : U(1.0, 1.8) });
    for (let i = 0; i < 784; i++) X[k * 784 + i] = Math.round(img[i] * 255);
    Y[k] = smp.label; k++;
  }
  fs.writeFileSync(out + '.x', X); fs.writeFileSync(out + '.y', Y);
  console.log(out, n);
}
build(DATA + '/pd/pendigits-orig.tra', 'pd_train', 6);
build(DATA + '/pd/pendigits-orig.tes', 'pd_test', 1);
