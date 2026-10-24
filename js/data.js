'use strict';
// 装備・敵・成長テーブル

const WEAPONS = {
  dagger:  { name: 'ダガー',             atk: 3,  price: 0 },
  short:   { name: 'ショートソード',     atk: 6,  price: 80 },
  long:    { name: 'ロングソード',       atk: 11, price: 300 },
  broad:   { name: 'ブロードソード',     atk: 17, price: 900 },
  mithril: { name: 'ミスリルソード',     atk: 24, price: 2000 },
  slayer:  { name: 'ドラゴンスレイヤー', atk: 28, price: 0, slayer: true },
};

const ARMORS = {
  cloth:   { name: '布の服',       def: 0,  price: 0 },
  leather: { name: '革の鎧',       def: 2,  price: 60 },
  chain:   { name: '鎖かたびら',   def: 5,  price: 250 },
  plate:   { name: '鋼の鎧',       def: 9,  price: 800 },
  mithril: { name: 'ミスリルの鎧', def: 14, price: 1800 },
};

const SHIELDS = {
  wood:   { name: '木の盾', def: 1, price: 40 },
  iron:   { name: '鉄の盾', def: 3, price: 300 },
  mirror: { name: '鏡の盾', def: 6, price: 1200 },
};

// マップ上の数字 = 敵の種類
const ENEMIES = {
  '1': { name: 'スライム',     spr: 'slime',    w: 26, h: 16, hp: 8,   atk: 5,  def: 0,  xp: 3,    gold: 2,  ai: 'walk', speed: 0.5, rate: 50 },
  '2': { name: 'コウモリ',     spr: 'bat',      w: 26, h: 18, hp: 6,   atk: 6,  def: 0,  xp: 4,    gold: 2,  ai: 'fly',  speed: 1.2, rate: 45 },
  '3': { name: 'ゴブリン',     spr: 'goblin',   w: 22, h: 28, hp: 18,  atk: 9,  def: 2,  xp: 8,    gold: 6,  ai: 'walk', speed: 0.8, chase: true, rate: 50 },
  '4': { name: 'スケルトン',   spr: 'skeleton', w: 20, h: 30, hp: 34,  atk: 15, def: 5,  xp: 16,   gold: 10, ai: 'walk', speed: 0.9, chase: true, rate: 45 },
  '5': { name: 'ダークナイト', spr: 'knight',   w: 24, h: 30, hp: 70,  atk: 24, def: 11, xp: 38,   gold: 28, ai: 'walk', speed: 0.8, chase: true, rate: 50 },
  '6': { name: 'ウィザード',   spr: 'wizard',   w: 22, h: 30, hp: 26,  atk: 10, def: 3,  xp: 22,   gold: 16, ai: 'walk', speed: 0.4, rate: 60,
         shoot: { rate: 110, dmg: 16, speed: 3 } },
  '7': { name: 'さまよう精霊', spr: 'ghost',    w: 22, h: 24, hp: 10,  atk: 0,  def: 0,  xp: 5,    gold: 0,  ai: 'ghost', peaceful: true, karma: 3 },
  '9': { name: 'ドラゴン',     spr: 'dragon',   w: 56, h: 52, hp: 450, atk: 34, def: 14, xp: 2000, gold: 0,  ai: 'boss', boss: true, rate: 40,
         shoot: { rate: 80, dmg: 28, speed: 3.2 } },
};

// レベル L から L+1 に上がるのに必要な累計経験値
function needXp(level) { return Math.floor(20 * Math.pow(level, 2.1)); }

// 武器の熟練度（使うほど上がる）
function weaponLevel(exp) { return Math.min(9, Math.floor(Math.sqrt(exp / 3))); }

const MAX_ITEM = 9;
const MAX_FOOD = 999;
