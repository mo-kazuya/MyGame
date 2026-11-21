'use strict';
// ルール計算のテスト：node mahjong/tools/test.js
const R = require('../js/rules.js');

// "123m456p789s11z" のような書き方を枚数配列に（z: 1東2南3西4北5白6發7中）
function parse(str) {
  const c = new Array(34).fill(0);
  let nums = [];
  for (const ch of str) {
    if (/[0-9]/.test(ch)) nums.push(+ch);
    else {
      const base = { m: 0, p: 9, s: 18, z: 27 }[ch];
      for (const n of nums) c[base + n - 1]++;
      nums = [];
    }
  }
  return c;
}
const K = s => parse(s).findIndex(v => v > 0);
let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('NG', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
  else console.log('ok', name);
}
const base = { seatWind: 28, roundWind: 27, dora: 0, aka: 0, ura: 0 };
function ev(hand, win, extra) {
  return R.evaluate(Object.assign({}, base, { cc: parse(hand), win: K(win), melds: [] }, extra || {}));
}
const names = r => r ? r.yaku.map(y => y[0] + y[1]).join(',') : null;

eq('shanten complete', R.shanten(parse('123m456p789s11z222z'), 0), -1);
eq('shanten tenpai', R.shanten(parse('123m456p789s1z222z'), 0), 0);
eq('shanten chiitoi', R.shanten(parse('1122m3344p5566s7z'), 0), 0);
eq('shanten kokushi', R.shanten(parse('19m19p19s1234567z'), 0), 0);
eq('shanten bad', R.shanten(parse('258m258p258s1357z'), 0), 6);
eq('waits nobetan', R.waits(parse('2345m'), 3), [K('2m'), K('5m')]);
eq('waits kokushi13', R.waits(parse('19m19p19s1234567z'), 0).length, 13);
eq('waits chuuren', R.waits(parse('1112345678999m'), 0).length, 9);

let r;
r = ev('234m567p345678s55m', '2m', { tsumo: true });
eq('pinfu tsumo', [names(r), r.fu, r.base], ['門前清自摸和1,断么九1,平和1', 20, 640]);
r = ev('234m567p345678s55m', '2m');
eq('pinfu ron', [names(r), r.fu, r.base], ['断么九1,平和1', 30, 480]);
r = ev('234m567p345678s55m', '3m');
eq('kanchan ron', [names(r), r.fu], ['断么九1', 40]);
r = ev('123m456p789s11z222z', '1z');
eq('jikaze', [names(r), r.fu], ['自風 南1', 50]);
r = ev('123m456p789s11z333z', '1z');
eq('yakunashi', r, null);
r = ev('1122m3344p5566s77z', '7z');
eq('chiitoi', [names(r), r.fu, r.base], ['七対子2', 25, 400]);
r = ev('112233m112233p55s', '5s', { riichi: true });
eq('ryanpeikou', names(r), '立直1,二盃口3');
r = ev('123456789m11p789s', '1p', { riichi: true, tsumo: true });
eq('ittsu', names(r), '立直1,門前清自摸和1,一気通貫2');
r = ev('111m999p111s99m555z', '5z', { tsumo: true });
eq('suuankou', [r.label, names(r)], ['役満', '四暗刻1']);
r = ev('111m999p111s99m555z', '5z');
eq('sanankou ron', names(r), '混老頭2,役牌 白1,対々和2,三暗刻2');
r = ev('19m19p19s12345677z', '7z');
eq('kokushi', r.label, '役満');
r = ev('11123455678999m', '5m');
eq('chuuren', [r.label, names(r)], ['役満', '九蓮宝燈1']);
r = R.evaluate(Object.assign({}, base, { cc: parse('234m55p'), win: K('5p'), melds: [{ t: 'pon', k: 31, open: true }, { t: 'chi', k: 18, open: true }, { t: 'pon', k: 32, open: true }] }));
eq('open fu', [names(r), r.fu], ['役牌 白1,役牌 發1', 30]);
r = R.evaluate(Object.assign({}, base, { cc: parse('234m55p'), win: K('5p'), dora: 2, melds: [{ t: 'chi', k: 1, open: true }, { t: 'chi', k: 11, open: true }, { t: 'chi', k: 21, open: true }] }));
eq('kuitan dora', [names(r), r.han, r.fu, r.base], ['断么九1,ドラ2', 3, 30, 960]);
r = ev('123m123p123s789s11z', '1z', { riichi: true, ura: 1 });
eq('sanshoku chanta', names(r), '立直1,三色同順2,混全帯么九2,裏ドラ1');
r = ev('22334455667788p', '8p');
eq('chinitsu', [r.label, r.han], ['三倍満', 11]);
eq('dora wrap', [R.doraOf(8), R.doraOf(30), R.doraOf(33)], [0, 27, 31]);

// 速さの確認
const t0 = Date.now();
let n = 0;
for (let i = 0; i < 2000; i++) {
  const c = new Array(34).fill(0);
  for (let j = 0; j < 14; j++) c[Math.floor(Math.random() * 34)]++;
  if (c.some(v => v > 4)) continue;
  R.shanten(c, 0); n++;
}
console.log(n, 'shanten in', Date.now() - t0, 'ms');
console.log(fail ? fail + ' failed' : 'all ok');
process.exit(fail ? 1 : 0);
