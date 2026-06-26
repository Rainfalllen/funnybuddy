/* ============================================================
 * jokers.js —— 小丑牌定义与效果
 * 每张小丑牌：{ id, name, face, desc, price, rarity, effect(ctx) }
 *
 * 计分上下文 ctx 字段：
 *   chips      当前累计筹码
 *   mult       当前累计倍率
 *   xmult      倍率乘区（最后统一相乘）
 *   scoringCards 参与计分的牌
 *   playedCards  本次打出的所有牌
 *   handTypeKey  牌型 key
 *   game       游戏状态对象
 * effect 直接修改 ctx，返回 true 表示触发（用于动画/飘字）。
 * ============================================================ */

// 某牌型是否“包含”指定基础牌型（用于 jolly/zany 等小丑）
const CONTAINS = {
  PAIR:     ["PAIR", "TWO_PAIR", "THREE_KIND", "FULL_HOUSE", "FOUR_KIND", "FIVE_KIND"],
  TWO_PAIR: ["TWO_PAIR", "FULL_HOUSE"],
  THREE:    ["THREE_KIND", "FULL_HOUSE", "FOUR_KIND", "FIVE_KIND"],
  STRAIGHT: ["STRAIGHT", "STRAIGHT_FLUSH"],
  FLUSH:    ["FLUSH", "STRAIGHT_FLUSH"],
};
function handContains(handTypeKey, baseType) {
  return CONTAINS[baseType].includes(handTypeKey);
}

const isFace = (c) => c.rank >= 11 && c.rank <= 13;
const isEven = (c) => [2, 4, 6, 8, 10].includes(c.rank);
const isOdd = (c) => [3, 5, 7, 9, 14].includes(c.rank); // A 视为奇数

// 小丑牌图鉴
const JOKER_POOL = [
  {
    id: "joker", name: "小丑", face: "😀", price: 2, rarity: "common",
    desc: "<b>+4</b> 倍率",
    effect: (ctx) => { ctx.mult += 4; return true; },
  },
  {
    id: "greedy", name: "贪婪小丑", face: "♦️", price: 5, rarity: "common",
    desc: "每张计分的<b>方块</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "D").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "lusty", name: "好色小丑", face: "♥️", price: 5, rarity: "common",
    desc: "每张计分的<b>红桃</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "H").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "wrathful", name: "暴怒小丑", face: "♠️", price: 5, rarity: "common",
    desc: "每张计分的<b>黑桃</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "S").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "gluttonous", name: "暴食小丑", face: "♣️", price: 5, rarity: "common",
    desc: "每张计分的<b>梅花</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "C").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "jolly", name: "欢乐小丑", face: "🤪", price: 4, rarity: "common",
    desc: "打出的牌含<b>对子</b>时 <b>+8</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "PAIR")) { ctx.mult += 8; return true; }
    },
  },
  {
    id: "zany", name: "疯狂小丑", face: "🤡", price: 4, rarity: "common",
    desc: "打出的牌含<b>三条</b>时 <b>+12</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "THREE")) { ctx.mult += 12; return true; }
    },
  },
  {
    id: "mad", name: "愤怒小丑", face: "😡", price: 4, rarity: "common",
    desc: "打出的牌含<b>两对</b>时 <b>+10</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "TWO_PAIR")) { ctx.mult += 10; return true; }
    },
  },
  {
    id: "crazy", name: "狂热小丑", face: "😵", price: 4, rarity: "common",
    desc: "打出的牌含<b>顺子</b>时 <b>+12</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "STRAIGHT")) { ctx.mult += 12; return true; }
    },
  },
  {
    id: "droll", name: "滑稽小丑", face: "😜", price: 4, rarity: "common",
    desc: "打出的牌含<b>同花</b>时 <b>+10</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "FLUSH")) { ctx.mult += 10; return true; }
    },
  },
  {
    id: "sly", name: "狡黠小丑", face: "🦊", price: 3, rarity: "common",
    desc: "打出的牌含<b>对子</b>时 <b>+50</b> 筹码",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "PAIR")) { ctx.chips += 50; return true; }
    },
  },
  {
    id: "wily", name: "老练小丑", face: "🦉", price: 4, rarity: "common",
    desc: "打出的牌含<b>三条</b>时 <b>+100</b> 筹码",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "THREE")) { ctx.chips += 100; return true; }
    },
  },
  {
    id: "clever", name: "聪明小丑", face: "🧠", price: 4, rarity: "common",
    desc: "打出的牌含<b>两对</b>时 <b>+80</b> 筹码",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "TWO_PAIR")) { ctx.chips += 80; return true; }
    },
  },
  {
    id: "half", name: "半个小丑", face: "🎭", price: 5, rarity: "common",
    desc: "打出 <b>3张或更少</b> 时 <b>+20</b> 倍率",
    effect: (ctx) => {
      if (ctx.playedCards.length <= 3) { ctx.mult += 20; return true; }
    },
  },
  {
    id: "evensteven", name: "偶数史蒂文", face: "➗", price: 4, rarity: "common",
    desc: "每张计分的 <b>偶数</b> 牌 <b>+4</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isEven).length;
      if (n) { ctx.mult += 4 * n; return true; }
    },
  },
  {
    id: "oddtodd", name: "奇数托德", face: "➕", price: 4, rarity: "common",
    desc: "每张计分的 <b>奇数</b> 牌 <b>+31</b> 筹码",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isOdd).length;
      if (n) { ctx.chips += 31 * n; return true; }
    },
  },
  {
    id: "scaryface", name: "鬼脸", face: "👹", price: 4, rarity: "common",
    desc: "每张计分的 <b>人头</b> 牌(J/Q/K) <b>+30</b> 筹码",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isFace).length;
      if (n) { ctx.chips += 30 * n; return true; }
    },
  },
  {
    id: "fibonacci", name: "斐波那契", face: "🌀", price: 8, rarity: "uncommon",
    desc: "每张计分的 <b>A/2/3/5/8</b> <b>+8</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => [14, 2, 3, 5, 8].includes(c.rank)).length;
      if (n) { ctx.mult += 8 * n; return true; }
    },
  },
  {
    id: "bull", name: "公牛", face: "🐂", price: 6, rarity: "uncommon",
    desc: "每拥有 <b>$1</b> 资金 <b>+2</b> 筹码",
    effect: (ctx) => {
      const m = Math.max(0, ctx.game.money);
      if (m) { ctx.chips += 2 * m; return true; }
    },
  },
  {
    id: "banner", name: "旗帜", face: "🚩", price: 5, rarity: "common",
    desc: "每剩余 <b>1</b> 次弃牌 <b>+30</b> 筹码",
    effect: (ctx) => {
      const d = ctx.game.discardsLeft;
      if (d) { ctx.chips += 30 * d; return true; }
    },
  },
  {
    id: "abstract", name: "抽象小丑", face: "🎨", price: 4, rarity: "common",
    desc: "每拥有 <b>1</b> 张小丑牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.game.jokers.length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "misprint", name: "错版", face: "🎲", price: 4, rarity: "common",
    desc: "<b>+0~23</b> 随机倍率",
    effect: (ctx) => {
      ctx.mult += Math.floor(Math.random() * 24); return true;
    },
  },
  {
    id: "acrobat", name: "杂技演员", face: "🤸", price: 6, rarity: "uncommon",
    desc: "本回合 <b>最后一次出牌</b> 时 <b>×3</b> 倍率",
    effect: (ctx) => {
      if (ctx.game.handsLeft === 0) { ctx.xmult *= 3; return true; }
    },
  },
  {
    id: "scholar", name: "学者", face: "📖", price: 4, rarity: "common",
    desc: "每张计分的 <b>A</b> <b>+20</b> 筹码且 <b>+4</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.rank === 14).length;
      if (n) { ctx.chips += 20 * n; ctx.mult += 4 * n; return true; }
    },
  },
  {
    id: "supernova", name: "超新星", face: "💥", price: 5, rarity: "uncommon",
    desc: "倍率 <b>+</b> 本局该牌型已打出的次数",
    effect: (ctx) => {
      const cnt = ctx.game.handTypePlays[ctx.handTypeKey] || 0;
      if (cnt) { ctx.mult += cnt; return true; }
    },
  },
  {
    id: "ride", name: "公车惊魂", face: "🚌", price: 6, rarity: "uncommon",
    desc: "连续打出 <b>不含人头牌</b> 的牌型，每次 <b>+1</b> 倍率（计分时累计）",
    effect: (ctx) => {
      if (ctx.scoringCards.some(isFace)) {
        ctx._resetRide = true; // 由游戏结算后处理
      }
      const v = ctx.game.rideCounter || 0;
      if (v) { ctx.mult += v; return true; }
    },
  },
];

function getJokerById(id) {
  return JOKER_POOL.find((j) => j.id === id);
}

window.Jokers = { JOKER_POOL, getJokerById };
