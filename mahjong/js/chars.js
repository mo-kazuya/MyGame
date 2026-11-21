'use strict';
// 対戦相手（CPU）の一覧。名前・強さ（★）・打ち方の癖。
// game.js の CPU はこの style を見て打ち方を変えます。
//
// style の項目（書かなければ DEFAULT_STYLE の値）
//   call     鳴き方 'eager' よく鳴く / 'normal' / 'yakuhai' 役牌のポンだけ / 'careful' 手が進む鳴きだけ・リーチがいたら鳴かない / 'none' 鳴かない
//   somete   手牌が一色に寄ったら染め手（混一色・清一色）をめざす
//   tanyao   么九牌（1・9・字牌）から先に切る（タンヤオ狙い）
//   chiitoi  対子が多ければ七対子をめざす
//   keepW    ドラ・役牌の対子をどれだけ大事にするか（0 ならほぼ気にしない）
//   fold     リーチを受けたとき、シャンテン数がこれ以上ならオリる
//   push1    1シャンテンで押す危険度の上限（大きいほど押す）
//   push0    テンパイで押す危険度の上限
//   dama     役がある手で、この翻数以上ならリーチしない（0 ならいつもリーチ）
//   damaBad  役があって待ちが悪い（残り 4 枚以下）ならリーチしない
//   blunder  ときどき効率の悪い牌を切る確率
//   strong   強い思考（先読み・手の値段・危険度の読み・押し引きの損得）を使う
(function (root) {
  const DEFAULT_STYLE = {
    call: 'normal', somete: false, tanyao: false, chiitoi: false, keepW: 0,
    fold: 2, push1: 4, push0: 9, dama: 0, damaBad: false, blunder: 0, strong: false,
  };
  const CHARS = [
    { id: 'mio', name: 'ミオ', color: '#ff9ac8', stars: 1, label: 'はじめたて',
      desc: '麻雀をおぼえたばかり。ときどき変な牌を切るし、リーチされても気にしない',
      style: { blunder: 0.3, fold: 9, push1: 99, push0: 99, call: 'yakuhai' } },
    { id: 'saki', name: 'サキ', color: '#ffb35a', stars: 2, label: 'タンヤオ速攻',
      desc: '端っこと字牌から切って、食いタンでさっさと和了る',
      style: { call: 'eager', tanyao: true, push1: 5, push0: 10 } },
    { id: 'fuyu', name: 'フユ', color: '#9ad8ff', stars: 2, label: '七対子好き',
      desc: '対子が集まると七対子へ一直線。鳴きはほとんどしない',
      style: { call: 'yakuhai', chiitoi: true } },
    { id: 'haru', name: 'ハル', color: '#8fe39a', stars: 2, label: '鳴き屋',
      desc: 'どんどん鳴いて早和了り。染め手が好き',
      style: { call: 'eager', somete: true, fold: 3, push1: 6, push0: 12 } },
    { id: 'natsu', name: 'ナツ', color: '#ff7a6a', stars: 2, label: 'リーチ一直線',
      desc: '鳴かずにリーチ。押しが強い',
      style: { call: 'yakuhai', fold: 3, push1: 10, push0: 99 } },
    { id: 'aki', name: 'アキ', color: '#e0b070', stars: 3, label: '慎重派',
      desc: '守り重視。高い手や待ちが悪い手はダマで待つ',
      style: { call: 'careful', fold: 1, push1: 0, push0: 4, dama: 3, damaBad: true } },
    { id: 'gou', name: 'ゴウ', color: '#c79aff', stars: 3, label: '高打点派',
      desc: 'ドラと役牌を抱えて大きな手を狙う。高い手なら押してくる',
      style: { call: 'yakuhai', somete: true, keepW: 1.6, push1: 7, push0: 14, dama: 5 } },
    { id: 'rin', name: 'リン', color: '#7ad0c0', stars: 3, label: 'バランス型',
      desc: '攻めも守りもそつなくこなす、雀荘の常連',
      style: { keepW: 0.3 } },
    { id: 'shinobu', name: 'シノブ', color: '#ffe36a', stars: 5, label: '雀豪',
      desc: '先を読んで良い形を作り、手の値段と危険度をはかって押し引きする強敵',
      style: { strong: true } },
  ];
  const byId = {};
  for (const c of CHARS) { c.style = Object.assign({}, DEFAULT_STYLE, c.style); byId[c.id] = c; }
  // トーナメントの 3 段階：その段階の相手を選ぶ候補（決勝はシノブが必ず出る）
  const TOUR = [
    { name: '予選', pool: ['mio', 'saki', 'fuyu', 'haru', 'natsu'], fixed: [], pass: 2 },
    { name: '準決勝', pool: ['haru', 'natsu', 'saki', 'fuyu', 'aki', 'rin'], fixed: [], pass: 2 },
    { name: '決勝', pool: ['aki', 'gou', 'rin'], fixed: ['shinobu'], pass: 1 },
  ];
  root.MJ_CHARS = { CHARS, byId, DEFAULT_STYLE, TOUR };
})(window);
