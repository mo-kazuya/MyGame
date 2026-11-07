const parse = require('./parse.js');
const HW = require('../handwriting.js');
const d = parse((process.argv[2] || 'data') + '/pd/pendigits-orig.tes');
const conf = Array.from({ length: 10 }, () => Array(10).fill(0));
let ok = 0, assist = 0, lowConf = 0, t = Date.now();
const P = [];
for (const s of d) {
  const p = HW.predict(s.strokes.map(st => st.map(([x, y]) => [x, -y])));
  let best = 0; for (let i = 1; i < 10; i++) if (p[i] > p[best]) best = i;
  conf[s.label][best]++; if (best === s.label) ok++;
  if (best === s.label || p[s.label] >= 0.15) assist++;
  if (p[best] < 0.6) lowConf++;
  P.push(p[s.label]);
}
const ms = (Date.now() - t) / d.length;
console.log(`JS(int8) 1文字の正解率: ${(ok / d.length * 100).toFixed(2)}%  (${d.length}字, 1字 ${ms.toFixed(2)}ms)`);
console.log(`正解が候補(確率15%以上)に入っている率: ${(assist / d.length * 100).toFixed(2)}%`);
console.log('2桁の答えを両方正しく読む率(推定):', ((ok / d.length) ** 2 * 100).toFixed(1) + '%', ' 3桁:', ((ok / d.length) ** 3 * 100).toFixed(1) + '%');
console.log('まちがい内訳 (正解→読んだ数字: 回数)');
for (let a = 0; a < 10; a++) { const e = []; for (let b = 0; b < 10; b++) if (a !== b && conf[a][b]) e.push(`${b}:${conf[a][b]}`); console.log(` ${a} (${conf[a][a]}/${conf[a].reduce((x, y) => x + y)}) ${e.join(' ')}`); }
