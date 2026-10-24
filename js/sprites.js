'use strict';
// 16x16 のドット絵定義。'.' は透明。足りない行は上側を透明で埋める（下揃え）。
const PAL = {
  k: '#101018', w: '#f8f8f8', s: '#f0b888', b: '#3060d0', B: '#203890',
  y: '#f8d030', r: '#e03030', R: '#902020', g: '#40c040', G: '#207020',
  c: '#b8b8c8', C: '#606070', o: '#a06030', O: '#603818', p: '#a040c0',
  P: '#602880', e: '#e8e0c0', l: '#80e0ff', L: '#3090d0', n: '#f08030',
};

const HERO_TOP = [
  '....kkkkkk......',
  '...kcccwcck.....',
  '...kcccccck.....',
  '...kkkkkkkk..c..',
  '...kssssksk..c..',
  '...ksssssskk.c..',
  '....kssssk...c..',
  '...kkbbbbkk.kyk.',
  '..kbbbbbbbbkss..',
  '..kbbybbbbbkk...',
  '..kssbbbbbbk....',
  '...kbbbbbbk.....',
  '...kBBBBBBk.....',
];

const SPRITE_DEFS = {
  hero0: HERO_TOP.concat([
    '...kBBkkBBk.....',
    '...kook.kook....',
    '...kkkk.kkkk....',
  ]),
  hero1: HERO_TOP.concat([
    '...kBBk.kBBk....',
    '..kook...kook...',
    '..kkkk...kkkk...',
  ]),
  slime: [
    '......kkkk......',
    '....kkggggkk....',
    '...kggwggggggk..',
    '..kggwgggkggggk.',
    '..kgggggggggggk.',
    '.kggggggggggGGgk',
    '.kGgggggggggGGGk',
    '..kkkkkkkkkkkkk.',
  ],
  bat0: [
    '.k............k.',
    '.kk....kk....kk.',
    '.kpk..kppk..kpk.',
    '.kppkkpppkkkppk.',
    '.kpppppwpwppppk.',
    '..kpppppppppppk.',
    '...kpkpppppkpk..',
    '...kk.kpppk.kk..',
    '.......kkk......',
    '................',
  ],
  bat1: [
    '................',
    '......kkk.......',
    '.....kppppk.....',
    '..kkkpwpwpkkk...',
    '.kpppppppppppk..',
    'kpppkpppppkpppk.',
    'kppk.kpppk.kppk.',
    'kpk...kkk...kpk.',
    'kk...........kk.',
    '................',
  ],
  goblin: [
    '.....kkkkk......',
    '....kgggggk.....',
    '...kggkgkggk....',
    '..kgggrgrgggk...',
    '...kgggggggk....',
    '....kgkkkgk.....',
    '...kooooooook...',
    '..kgoooooooogk..',
    '..kgkooooookgk..',
    '...k.kOOOOk.k...',
    '....kOOOOOOk....',
    '....kgk..kgk....',
    '...kGGk..kGGk...',
    '...kkkk..kkkk...',
  ],
  skeleton: [
    '.....kkkkk......',
    '....keeeeek.....',
    '....kekekek.....',
    '....keeeeek.....',
    '.....kekek......',
    '......kek.......',
    '...kkeeeeekk....',
    '..kek.eke.kek...',
    '..ke.keeek.ek...',
    '..k..eeeee..k...',
    '.....keeek......',
    '....kek.kek.....',
    '....ke...ek.....',
    '...kek...kek....',
    '...kkk...kkk....',
  ],
  knight: [
    '....rr..........',
    '...rrkkkkk......',
    '...kCCCCCCk.....',
    '...kCCkkkkk.....',
    '...kCCkrkrk.....',
    '...kCCCCCCk..c..',
    '....kCCCCk...c..',
    '..kkCCCCCCkk.c..',
    '.kCCcCCCCCCCkyk.',
    '.kRRCCCCCCCkCk..',
    '.kRRRCCCCCCk....',
    '.kRRRCCCCCk.....',
    '..kRkCCCCCk.....',
    '...kCCkkCCk.....',
    '...kCCk.kCCk....',
    '..kkkkk.kkkkk...',
  ],
  wizard: [
    '......kk........',
    '.....kPPk.......',
    '....kPPPPk......',
    '...kPPPPPPk.....',
    '..kkkkkkkkkk....',
    '....kssksk..y...',
    '....kssssk.kyk..',
    '...kpwwwwpk.ok..',
    '..kpppwwppppok..',
    '..kppppppppkok..',
    '..kpppppppk.ok..',
    '..kpppppppk.ok..',
    '.kppppppppPk....',
    '.kpppppppPPk....',
    '.kPPPPPPPPPk....',
    '.kkkkkkkkkkk....',
  ],
  ghost: [
    '.....kkkkk......',
    '....kwwwwwk.....',
    '...kwwwwwwwk....',
    '...kwlwwwlwk....',
    '...kwwwwwwwk....',
    '...kwwwkwwwk....',
    '..kwwwwwwwwwk...',
    '..kwwwwwwwwwk...',
    '..kwwwwwwwwwk...',
    '..kwwwwwwwwwk...',
    '..kwkwwkwwkwk...',
    '..kk.kk.kk.kk...',
    '................',
    '................',
  ],
  dragon: [
    '..........kk....',
    '.........krrk...',
    '........krrrrk..',
    '..k.....krwrrrkk',
    '.krk...krrrrrrrk',
    'krrrk..krrkkkkk.',
    'krrrrkkrrk......',
    '.krrrrrrrk......',
    '..krrrrRrrk..kk.',
    '..krrrRRRrrkkrk.',
    '.krrrRyyRRrrrrk.',
    '.krrRyyyyRrrrk..',
    '..krRyyyyRrrk...',
    '...krRRRRrrk....',
    '...krk..krk.....',
    '..kkkk.kkkk.....',
  ],
  gold: [
    '......kkkk......',
    '.....kOOOOk.....',
    '......kOOk......',
    '.....kyyyyk.....',
    '....kyyyyyyk....',
    '...kyyykyyyyk...',
    '...kyykkkyyyk...',
    '...kyyykyyyyk...',
    '...kyyyyyyyyk...',
    '....kkkkkkkk....',
    '................',
  ],
  potion: [
    '......kkk.......',
    '......kok.......',
    '.....kkkkk......',
    '......kwk.......',
    '......kwk.......',
    '.....kwrrk......',
    '....kwrrrrk.....',
    '...kwrrrrrrk....',
    '...krrrrrrrk....',
    '...krrrrrrRk....',
    '....krrrrRk.....',
    '.....kkkkk......',
    '................',
  ],
  key: [
    '...kkkk.........',
    '..kyyyyk........',
    '.kyk..kykkkkkkk.',
    '.kyk..kyyyyyyyyk',
    '.kyk..kykkkykyk.',
    '..kyyyyk..k.k.k.',
    '...kkkk.........',
    '................',
    '................',
    '................',
  ],
  food: [
    '......kkkk......',
    '.....knnnnk.....',
    '....knnnnnnk....',
    '....knnRnnnk....',
    '....knnnnnnk....',
    '.....knnnnk.....',
    '......kkwwk.....',
    '.......kwwwk....',
    '........kwwk....',
    '.........kk.....',
  ],
  slayer: [
    '.............kk.',
    '............klk.',
    '...........klwk.',
    '..........klwk..',
    '.........klwk...',
    '........klwk....',
    '.......klwk.....',
    '..k...klwk......',
    '..kk.klwk.......',
    '...kkywk........',
    '....kyk.........',
    '...kyykk........',
    '..kok..kk.......',
    '.kok............',
    '.kk.............',
  ],
};
// 魔法の水はポーションの色違い
SPRITE_DEFS.elixir = SPRITE_DEFS.potion.map(r => r.replace(/r/g, 'l').replace(/R/g, 'L'));

function makeSprite(rows) {
  const full = Array(Math.max(0, 16 - rows.length)).fill('').concat(rows);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const x = c.getContext('2d');
  full.forEach((row, y) => {
    for (let i = 0; i < 16; i++) {
      const col = PAL[row[i]];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(i, y, 1, 1);
    }
  });
  return c;
}

function flipCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.translate(src.width, 0);
  x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  return c;
}

// SPR[name] = { r: 右向き, l: 左向き }
const SPR = {};
for (const [name, rows] of Object.entries(SPRITE_DEFS)) {
  const img = makeSprite(rows);
  SPR[name] = { r: img, l: flipCanvas(img) };
}
