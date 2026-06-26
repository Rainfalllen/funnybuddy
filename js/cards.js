/* ============================================================
 * cards.js —— 扑克牌定义、牌型识别与计分基础数据
 * ============================================================ */

// 花色：S黑桃 H红桃 D方块 C梅花
const SUITS = [
  { key: "S", name: "黑桃", symbol: "♠", color: "black" },
  { key: "H", name: "红桃", symbol: "♥", color: "red" },
  { key: "D", name: "方块", symbol: "♦", color: "red" },
  { key: "C", name: "梅花", symbol: "♣", color: "black" },
];

// 点数：rank 用于顺子判断，label 用于显示，chips 为牌面筹码
const RANKS = [
  { rank: 2, label: "2", chips: 2 },
  { rank: 3, label: "3", chips: 3 },
  { rank: 4, label: "4", chips: 4 },
  { rank: 5, label: "5", chips: 5 },
  { rank: 6, label: "6", chips: 6 },
  { rank: 7, label: "7", chips: 7 },
  { rank: 8, label: "8", chips: 8 },
  { rank: 9, label: "9", chips: 9 },
  { rank: 10, label: "10", chips: 10 },
  { rank: 11, label: "J", chips: 10 },
  { rank: 12, label: "Q", chips: 10 },
  { rank: 13, label: "K", chips: 10 },
  { rank: 14, label: "A", chips: 11 },
];

// 牌型基础分（chips 基础筹码，mult 基础倍率）。
// perLevel: 每升一级增加的 { chips, mult }（参考 Balatro 行星牌数值风格）。
const HAND_TYPES = {
  HIGH_CARD:      { name: "高牌",   chips: 5,   mult: 1,  perLevel: { chips: 10, mult: 1 } },
  PAIR:           { name: "对子",   chips: 10,  mult: 2,  perLevel: { chips: 15, mult: 1 } },
  TWO_PAIR:       { name: "两对",   chips: 20,  mult: 2,  perLevel: { chips: 20, mult: 1 } },
  THREE_KIND:     { name: "三条",   chips: 30,  mult: 3,  perLevel: { chips: 20, mult: 2 } },
  STRAIGHT:       { name: "顺子",   chips: 30,  mult: 4,  perLevel: { chips: 30, mult: 3 } },
  FLUSH:          { name: "同花",   chips: 35,  mult: 4,  perLevel: { chips: 15, mult: 2 } },
  FULL_HOUSE:     { name: "葫芦",   chips: 40,  mult: 4,  perLevel: { chips: 25, mult: 2 } },
  FOUR_KIND:      { name: "四条",   chips: 60,  mult: 7,  perLevel: { chips: 30, mult: 3 } },
  STRAIGHT_FLUSH: { name: "同花顺", chips: 100, mult: 8,  perLevel: { chips: 40, mult: 4 } },
  FIVE_KIND:      { name: "五条",   chips: 120, mult: 12, perLevel: { chips: 35, mult: 3 } },
};

// 根据等级计算牌型的实际 chips/mult。level 从 1 开始（1 级 = 基础值）。
// levels 为 { typeKey: level } 映射（缺省视为 1 级）。
function getHandStats(typeKey, levels) {
  const base = HAND_TYPES[typeKey];
  const lvl = Math.max(1, (levels && levels[typeKey]) || 1);
  const inc = lvl - 1;
  return {
    name: base.name,
    level: lvl,
    chips: base.chips + base.perLevel.chips * inc,
    mult: base.mult + base.perLevel.mult * inc,
  };
}

let uidCounter = 0;
function makeCard(suit, rankObj) {
  return {
    id: ++uidCounter,
    suit: suit.key,
    suitName: suit.name,
    symbol: suit.symbol,
    color: suit.color,
    rank: rankObj.rank,
    label: rankObj.label,
    chips: rankObj.chips,
  };
}

// 生成一副标准 52 张牌
function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push(makeCard(s, r));
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------
 * 牌型识别
 * 输入：1~5 张已选牌
 * 输出：{ typeKey, scoringCards }
 *   scoringCards 为真正参与计分的牌（如对子只计两张）
 * ------------------------------------------------------------ */
function evaluateHand(cards) {
  if (!cards.length) return null;

  const ranks = cards.map((c) => c.rank);
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const countValues = Object.values(counts).sort((a, b) => b - a);

  const isFlush = cards.length === 5 && cards.every((c) => c.suit === cards[0].suit);
  const straightInfo = checkStraight(ranks);
  const isStraight = cards.length === 5 && straightInfo.ok;

  // 工具：取出现 n 次的所有牌（按计数分组）
  const groupByCount = (n) => {
    const wantedRanks = Object.keys(counts)
      .filter((r) => counts[r] === n)
      .map(Number);
    return cards.filter((c) => wantedRanks.includes(c.rank));
  };

  let typeKey, scoringCards;

  if (countValues[0] === 5) {
    typeKey = "FIVE_KIND";
    scoringCards = [...cards];
  } else if (isStraight && isFlush) {
    typeKey = "STRAIGHT_FLUSH";
    scoringCards = [...cards];
  } else if (countValues[0] === 4) {
    typeKey = "FOUR_KIND";
    scoringCards = groupByCount(4);
  } else if (countValues[0] === 3 && countValues[1] === 2) {
    typeKey = "FULL_HOUSE";
    scoringCards = [...cards];
  } else if (isFlush) {
    typeKey = "FLUSH";
    scoringCards = [...cards];
  } else if (isStraight) {
    typeKey = "STRAIGHT";
    scoringCards = [...cards];
  } else if (countValues[0] === 3) {
    typeKey = "THREE_KIND";
    scoringCards = groupByCount(3);
  } else if (countValues[0] === 2 && countValues[1] === 2) {
    typeKey = "TWO_PAIR";
    scoringCards = groupByCount(2);
  } else if (countValues[0] === 2) {
    typeKey = "PAIR";
    scoringCards = groupByCount(2);
  } else {
    typeKey = "HIGH_CARD";
    // 高牌只计最大的一张
    const maxRank = Math.max(...ranks);
    scoringCards = [cards.find((c) => c.rank === maxRank)];
  }

  return { typeKey, scoringCards };
}

// 顺子判断（支持 A-2-3-4-5 与 10-J-Q-K-A）
function checkStraight(ranks) {
  if (ranks.length !== 5) return { ok: false };
  const uniq = [...new Set(ranks)];
  if (uniq.length !== 5) return { ok: false };
  const sorted = [...uniq].sort((a, b) => a - b);
  // 普通顺子
  if (sorted[4] - sorted[0] === 4) return { ok: true };
  // A 当作 1 的特殊顺子 A,2,3,4,5
  if (sorted.join(",") === "2,3,4,5,14") return { ok: true };
  return { ok: false };
}

// 导出到全局（无打包环境）
window.Cards = {
  SUITS,
  RANKS,
  HAND_TYPES,
  getHandStats,
  buildDeck,
  shuffle,
  evaluateHand,
};
