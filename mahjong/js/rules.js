'use strict';
// 麻雀のルール計算（シャンテン数・待ち・和了の役・符・点数）。
// 画面を使わないので node からも読み込めます（tools/test.js）。
//
// 牌の種類（kind）は 0〜33 の番号で表します。
//   0〜8 萬子（1萬〜9萬） 9〜17 筒子 18〜26 索子
//   27 東 28 南 29 西 30 北 31 白 32 發 33 中
// 手牌は「種類ごとの枚数」の配列（長さ 34）で渡します。
(function (root) {
  const WIND = ['東', '南', '西', '北'];
  const NAMES = [];
  for (const s of ['萬', '筒', '索']) for (let i = 1; i <= 9; i++) NAMES.push(i + s);
  NAMES.push('東', '南', '西', '北', '白', '發', '中');

  const isYao = k => k >= 27 || k % 9 === 0 || k % 9 === 8; // 么九牌（1・9・字牌）
  // ドラ表示牌の次の牌がドラ
  const doraOf = k => k < 27 ? Math.floor(k / 9) * 9 + (k % 9 + 1) % 9
    : k < 31 ? 27 + (k - 27 + 1) % 4 : 31 + (k - 31 + 1) % 3;
  // 緑一色に使える牌（2・3・4・6・8索と發）
  const GREEN = new Set([19, 20, 21, 23, 25, 32]);

  // ---------- シャンテン数 ----------
  // 面子手のシャンテン数。fixed は鳴いた面子（暗槓も含む）の数
  function shantenStd(c0, fixed) {
    const c = c0.slice();
    let best = 8;
    function rec(i, m, t, p) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) {
        const s = 8 - 2 * m - Math.min(t, 4 - m) - p;
        if (s < best) best = s;
        return;
      }
      if (c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t, p); c[i] += 3; }
      if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (c[i] >= 2) {
        c[i] -= 2;
        if (p === 0) rec(i, m, t, 1);
        if (m + t < 4) rec(i, m, t + 1, p);
        c[i] += 2;
      }
      if (m + t < 4 && i < 27) {
        if (i % 9 <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; rec(i, m, t + 1, p); c[i]++; c[i + 1]++; }
        if (i % 9 <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; rec(i, m, t + 1, p); c[i]++; c[i + 2]++; }
      }
      // この牌を使わない（浮き牌）
      const keep = c[i]; c[i] = 0; rec(i + 1, m, t, p); c[i] = keep;
    }
    rec(0, fixed, 0, 0);
    return best;
  }
  function shantenChiitoi(c) {
    let pairs = 0, kinds = 0;
    for (let k = 0; k < 34; k++) { if (c[k] >= 1) kinds++; if (c[k] >= 2) pairs++; }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }
  function shantenKokushi(c) {
    let kinds = 0, pair = 0;
    for (let k = 0; k < 34; k++) if (isYao(k) && c[k]) { kinds++; if (c[k] >= 2) pair = 1; }
    return 13 - kinds - pair;
  }
  // 和了形なら -1、聴牌なら 0
  function shanten(c, fixed) {
    let s = shantenStd(c, fixed || 0);
    if (!fixed) s = Math.min(s, shantenChiitoi(c), shantenKokushi(c));
    return s;
  }

  // ---------- 和了形 ----------
  function isChiitoi(c) {
    let pairs = 0;
    for (let k = 0; k < 34; k++) { if (c[k] === 2) pairs++; else if (c[k] !== 0) return false; }
    return pairs === 7;
  }
  function isKokushi(c) {
    let n = 0;
    for (let k = 0; k < 34; k++) {
      if (isYao(k)) { if (!c[k]) return false; n += c[k]; } else if (c[k]) return false;
    }
    return n === 14;
  }
  function canSets(c, i) {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return true;
    if (c[i] >= 3) { c[i] -= 3; const ok = canSets(c, i); c[i] += 3; if (ok) return true; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; const ok = canSets(c, i); c[i]++; c[i + 1]++; c[i + 2]++;
      if (ok) return true;
    }
    return false;
  }
  function isAgari(c, fixed) {
    if (!fixed && (isChiitoi(c) || isKokushi(c))) return true;
    for (let p = 0; p < 34; p++) {
      if (c[p] >= 2) { c[p] -= 2; const ok = canSets(c, 0); c[p] += 2; if (ok) return true; }
    }
    return false;
  }
  // 13 枚（鳴きがあれば 3 枚ずつ少ない）の手の待ち
  function waits(c0, fixed) {
    const c = c0.slice(), out = [];
    for (let k = 0; k < 34; k++) {
      if (c[k] >= 4) continue;
      c[k]++;
      if (isAgari(c, fixed || 0)) out.push(k);
      c[k]--;
    }
    return out;
  }
  // 雀頭 + 面子への分け方をすべて
  function decompose(c0) {
    const c = c0.slice(), out = [];
    function ext(i, sets, pair) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) { out.push({ pair, sets: sets.slice() }); return; }
      if (c[i] >= 3) { c[i] -= 3; sets.push({ t: 'pon', k: i }); ext(i, sets, pair); sets.pop(); c[i] += 3; }
      if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ t: 'chi', k: i });
        ext(i, sets, pair);
        sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    for (let p = 0; p < 34; p++) if (c[p] >= 2) { c[p] -= 2; ext(0, [], p); c[p] += 2; }
    return out;
  }

  // ---------- 役と符 ----------
  // 状況で付く役（立直・一発・ツモ・海底など）
  function situational(h, menzen) {
    const yaku = [], yakuman = [];
    if (h.tenhou) yakuman.push(['天和', 1]);
    if (h.chiihou) yakuman.push(['地和', 1]);
    if (h.doubleRiichi) yaku.push(['ダブル立直', 2]);
    else if (h.riichi) yaku.push(['立直', 1]);
    if (h.ippatsu) yaku.push(['一発', 1]);
    if (menzen && h.tsumo) yaku.push(['門前清自摸和', 1]);
    if (h.last) yaku.push([h.tsumo ? '海底摸月' : '河底撈魚', 1]);
    if (h.rinshan) yaku.push(['嶺上開花', 1]);
    if (h.chankan) yaku.push(['槍槓', 1]);
    return { yaku, yakuman };
  }
  // 使っている牌の種類だけで決まる役（断么九・混一色・清一色・混老頭・字一色など）
  function colorYaku(all, menzen) {
    const yaku = [], yakuman = [];
    const present = [];
    for (let k = 0; k < 34; k++) if (all[k]) present.push(k);
    const honors = present.some(k => k >= 27);
    const suits = new Set(present.filter(k => k < 27).map(k => Math.floor(k / 9)));
    if (present.every(k => !isYao(k))) yaku.push(['断么九', 1]);
    if (present.every(isYao)) {
      if (!honors) yakuman.push(['清老頭', 1]);
      else if (suits.size === 0) yakuman.push(['字一色', 1]);
      else yaku.push(['混老頭', 2]);
    }
    if (suits.size === 1) {
      if (honors) yaku.push(['混一色', menzen ? 3 : 2]);
      else yaku.push(['清一色', menzen ? 6 : 5]);
    }
    if (present.every(k => GREEN.has(k))) yakuman.push(['緑一色', 1]);
    return { yaku, yakuman };
  }
  // 面子手の役と符
  function regular(h, groups, pair, wait, menzen) {
    const yaku = [], yakuman = [];
    const chis = groups.filter(g => g.t === 'chi');
    const pons = groups.filter(g => g.t !== 'chi');
    const kans = groups.filter(g => g.t === 'kan').length;
    const pairYakuhai = pair >= 31 || pair === h.seatWind || pair === h.roundWind;

    // 符
    let fu = 20;
    for (const g of pons) {
      let f = 2;
      if (isYao(g.k)) f *= 2;
      if (g.concealed) f *= 2;
      if (g.t === 'kan') f *= 4;
      fu += f;
    }
    if (pair >= 31) fu += 2;
    if (pair === h.seatWind) fu += 2;
    if (pair === h.roundWind) fu += 2;
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    const pinfu = menzen && chis.length === 4 && !pairYakuhai && wait === 'ryanmen';
    if (pinfu) fu = h.tsumo ? 20 : 30;
    else {
      if (menzen && !h.tsumo) fu += 10;
      if (h.tsumo) fu += 2;
      fu = Math.max(30, Math.ceil(fu / 10) * 10);
    }

    // 役
    if (pinfu) yaku.push(['平和', 1]);
    if (menzen) {
      const cnt = {};
      for (const g of chis) cnt[g.k] = (cnt[g.k] || 0) + 1;
      let pk = 0;
      for (const v of Object.values(cnt)) pk += Math.floor(v / 2);
      if (pk >= 2) yaku.push(['二盃口', 3]);
      else if (pk === 1) yaku.push(['一盃口', 1]);
    }
    for (const g of pons) {
      if (g.k >= 31) yaku.push(['役牌 ' + NAMES[g.k], 1]);
      if (g.k === h.seatWind) yaku.push(['自風 ' + WIND[g.k - 27], 1]);
      if (g.k === h.roundWind) yaku.push(['場風 ' + WIND[g.k - 27], 1]);
    }
    for (let n = 0; n < 7; n++) {
      if ([0, 1, 2].every(s => chis.some(g => g.k === s * 9 + n))) { yaku.push(['三色同順', menzen ? 2 : 1]); break; }
    }
    for (let s = 0; s < 3; s++) {
      if ([0, 3, 6].every(o => chis.some(g => g.k === s * 9 + o))) { yaku.push(['一気通貫', menzen ? 2 : 1]); break; }
    }
    const groupYao = g => g.t === 'chi' ? (g.k % 9 === 0 || g.k % 9 === 6) : isYao(g.k);
    if (chis.length && groups.every(groupYao) && isYao(pair)) {
      if (pair >= 27 || pons.some(g => g.k >= 27)) yaku.push(['混全帯么九', menzen ? 2 : 1]);
      else yaku.push(['純全帯么九', menzen ? 3 : 2]);
    }
    if (pons.length === 4) yaku.push(['対々和', 2]);
    const anko = pons.filter(g => g.concealed).length;
    if (anko === 4) yakuman.push(['四暗刻', 1]);
    else if (anko === 3) yaku.push(['三暗刻', 2]);
    for (let n = 0; n < 9; n++) {
      if ([0, 1, 2].every(s => pons.some(g => g.k === s * 9 + n))) { yaku.push(['三色同刻', 2]); break; }
    }
    if (kans === 4) yakuman.push(['四槓子', 1]);
    else if (kans === 3) yaku.push(['三槓子', 2]);
    const dragons = pons.filter(g => g.k >= 31).length;
    if (dragons === 3) yakuman.push(['大三元', 1]);
    else if (dragons === 2 && pair >= 31) yaku.push(['小三元', 2]);
    const winds = pons.filter(g => g.k >= 27 && g.k <= 30).length;
    if (winds === 4) yakuman.push(['大四喜', 1]);
    else if (winds === 3 && pair >= 27 && pair <= 30) yakuman.push(['小四喜', 1]);
    return { yaku, yakuman, fu };
  }

  // 基本点（符 × 2^(翻+2)、満貫以上は切り上げ）
  function basePoints(han, fu) {
    if (han >= 13) return { base: 8000, label: '数え役満' };
    if (han >= 11) return { base: 6000, label: '三倍満' };
    if (han >= 8) return { base: 4000, label: '倍満' };
    if (han >= 6) return { base: 3000, label: '跳満' };
    const b = fu * Math.pow(2, han + 2);
    if (han >= 5 || b >= 2000) return { base: 2000, label: '満貫' };
    return { base: b, label: '' };
  }
  function finalize(res, h) {
    if (res.yakuman.length) {
      const n = res.yakuman.reduce((a, y) => a + y[1], 0);
      return { yaku: res.yakuman, yakuman: n, han: 0, fu: res.fu, base: 8000 * n, label: n > 1 ? n + '倍役満' : '役満' };
    }
    if (!res.yaku.length) return null; // 役なし
    const yaku = res.yaku.slice();
    if (h.dora) yaku.push(['ドラ', h.dora]);
    if (h.aka) yaku.push(['赤ドラ', h.aka]);
    if ((h.riichi || h.doubleRiichi) && h.ura) yaku.push(['裏ドラ', h.ura]);
    const han = yaku.reduce((a, y) => a + y[1], 0);
    const bp = basePoints(han, res.fu);
    return { yaku, yakuman: 0, han, fu: res.fu, base: bp.base, label: bp.label };
  }
  const better = (a, b) => a.base !== b.base ? a.base > b.base : a.han !== b.han ? a.han > b.han : a.fu > b.fu;

  // 和了の評価。役がなければ null。
  //   h.cc        手の中の牌（和了牌を含む）の枚数配列
  //   h.melds     [{ t: 'chi'|'pon'|'kan', k: いちばん小さい牌, open: 鳴いたか }]
  //   h.win       和了牌の種類   h.tsumo ツモ和了か
  //   h.seatWind / h.roundWind  自風・場風（27〜30）
  //   h.riichi h.doubleRiichi h.ippatsu h.last(海底・河底) h.rinshan h.chankan h.tenhou h.chiihou
  //   h.dora h.aka h.ura  ドラ・赤ドラ・裏ドラの枚数
  function evaluate(h) {
    const melds = h.melds || [];
    const menzen = melds.every(m => !m.open);
    const cc = h.cc;
    const all = cc.slice();
    for (const m of melds) {
      if (m.t === 'chi') { all[m.k]++; all[m.k + 1]++; all[m.k + 2]++; } else all[m.k] += 3;
    }
    const sit = situational(h, menzen);
    const col = colorYaku(all, menzen);
    // 九蓮宝燈
    if (melds.length === 0) {
      for (let s = 0; s < 3; s++) {
        const b = s * 9;
        let n = 0;
        for (let k = b; k < b + 9; k++) n += cc[k];
        if (n === 14 && cc[b] >= 3 && cc[b + 8] >= 3 && [1, 2, 3, 4, 5, 6, 7].every(i => cc[b + i] >= 1)) {
          col.yakuman.push(['九蓮宝燈', 1]);
        }
      }
    }
    let best = null;
    const consider = res => { const sc = finalize(res, h); if (sc && (!best || better(sc, best))) best = sc; };

    if (melds.length === 0) {
      if (isKokushi(cc)) consider({ yakuman: [...sit.yakuman, ['国士無双', 1]], yaku: [], fu: 0 });
      if (isChiitoi(cc)) {
        consider({ yakuman: [...sit.yakuman, ...col.yakuman], yaku: [...sit.yaku, ['七対子', 2], ...col.yaku], fu: 25 });
      }
    }
    for (const d of decompose(cc)) {
      const places = [];
      if (d.pair === h.win) places.push({ wait: 'tanki', idx: -1 });
      d.sets.forEach((s, i) => {
        if (s.t === 'pon' && s.k === h.win) places.push({ wait: 'shanpon', idx: i });
        if (s.t === 'chi' && h.win >= s.k && h.win <= s.k + 2) {
          const pos = h.win - s.k;
          let w = 'ryanmen';
          if (pos === 1) w = 'kanchan';
          else if (pos === 0 && s.k % 9 === 6) w = 'penchan';
          else if (pos === 2 && s.k % 9 === 0) w = 'penchan';
          places.push({ wait: w, idx: i });
        }
      });
      for (const pl of places) {
        // ロンで完成した刻子は明刻あつかい
        const groups = d.sets.map((s, i) => ({ t: s.t, k: s.k, concealed: !(s.t === 'pon' && i === pl.idx && !h.tsumo) }));
        for (const m of melds) groups.push({ t: m.t, k: m.k, concealed: !m.open });
        const r = regular(h, groups, d.pair, pl.wait, menzen);
        consider({ yakuman: [...sit.yakuman, ...col.yakuman, ...r.yakuman], yaku: [...sit.yaku, ...col.yaku, ...r.yaku], fu: r.fu });
      }
    }
    return best;
  }

  const ceil100 = x => Math.ceil(x / 100) * 100;

  const api = { NAMES, WIND, isYao, doraOf, shanten, waits, isAgari, decompose, evaluate, basePoints, ceil100 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mj = api;
})(typeof window !== 'undefined' ? window : globalThis);
