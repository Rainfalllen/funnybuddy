/* ============================================================
 * tarots.js —— 塔罗牌（消耗牌的一种）
 * 使用时通常需要选择手牌中的 1~3 张进行改造。
 * 每张：{ id, kind:"tarot", name, face, price, needCards:[min,max], desc, apply(cards, game) }
 *   - needCards 为需要选择的手牌数量范围；[0,0] 表示无需选牌
 *   - apply(selectedCards, game) 对选中的牌做改造，返回提示文本
 * ============================================================ */
const TAROT_POOL = [
  {
    id: "the_magician", name: "魔术师", face: "🎩", price: 3, needCards: [1, 2],
    desc: "将选中的 1~2 张牌变为<b>幸运牌</b>",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "lucky")); return "幸运牌"; },
  },
  {
    id: "the_empress", name: "皇后", face: "👑", price: 3, needCards: [1, 2],
    desc: "将选中的 1~2 张牌变为<b>倍率牌</b>(+4 倍率)",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "mult")); return "倍率牌"; },
  },
  {
    id: "the_hierophant", name: "教皇", face: "📿", price: 3, needCards: [1, 2],
    desc: "将选中的 1~2 张牌变为<b>加成牌</b>(+30 筹码)",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "bonus")); return "加成牌"; },
  },
  {
    id: "the_tower", name: "高塔", face: "🗼", price: 3, needCards: [1, 1],
    desc: "将选中的 1 张牌变为<b>石头牌</b>(+50 筹码)",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "stone")); return "石头牌"; },
  },
  {
    id: "the_devil", name: "恶魔", face: "😈", price: 3, needCards: [1, 1],
    desc: "将选中的 1 张牌变为<b>黄金牌</b>(回合留手 +$3)",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "gold")); return "黄金牌"; },
  },
  {
    id: "the_justice", name: "正义", face: "⚖️", price: 3, needCards: [1, 1],
    desc: "将选中的 1 张牌变为<b>玻璃牌</b>(×2 倍率,易碎)",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "glass")); return "玻璃牌"; },
  },
  {
    id: "the_chariot", name: "战车", face: "🛡️", price: 3, needCards: [1, 1],
    desc: "将选中的 1 张牌变为<b>钢铁牌</b>(留手 ×1.5)",
    apply: (cards) => { cards.forEach((c) => (c.enhancement = "steel")); return "钢铁牌"; },
  },
  // 改花色
  {
    id: "the_sun", name: "太阳", face: "☀️", price: 3, needCards: [1, 3],
    desc: "将选中的牌变为<b>红桃</b>♥",
    apply: (cards) => { cards.forEach((c) => setSuit(c, "H")); return "红桃"; },
  },
  {
    id: "the_moon", name: "月亮", face: "🌙", price: 3, needCards: [1, 3],
    desc: "将选中的牌变为<b>梅花</b>♣",
    apply: (cards) => { cards.forEach((c) => setSuit(c, "C")); return "梅花"; },
  },
  {
    id: "the_star", name: "星星", face: "⭐", price: 3, needCards: [1, 3],
    desc: "将选中的牌变为<b>方块</b>♦",
    apply: (cards) => { cards.forEach((c) => setSuit(c, "D")); return "方块"; },
  },
  {
    id: "the_world", name: "世界", face: "🌍", price: 3, needCards: [1, 3],
    desc: "将选中的牌变为<b>黑桃</b>♠",
    apply: (cards) => { cards.forEach((c) => setSuit(c, "S")); return "黑桃"; },
  },
  // 升点数
  {
    id: "strength", name: "力量", face: "💪", price: 3, needCards: [1, 2],
    desc: "选中的 1~2 张牌<b>点数 +1</b>",
    apply: (cards) => { cards.forEach((c) => bumpRank(c, 1)); return "点数+1"; },
  },
  // 版本：多彩
  {
    id: "the_aura", name: "灵光", face: "✨", price: 4, needCards: [1, 1],
    desc: "为选中的 1 张牌附加<b>多彩</b>版本(×1.5 倍率)",
    apply: (cards) => { cards.forEach((c) => (c.edition = "polychrome")); return "多彩"; },
  },
  // 蜡封
  {
    id: "the_seal", name: "封印", face: "🔖", price: 4, needCards: [1, 1],
    desc: "为选中的 1 张牌附加<b>红色蜡封</b>(重复触发)",
    apply: (cards) => { cards.forEach((c) => (c.seal = "red")); return "红封";
    },
  },
  // 给钱
  {
    id: "the_hermit", name: "隐士", face: "🪙", price: 3, needCards: [0, 0],
    desc: "<b>翻倍</b>当前资金（最多 +$20）",
    apply: (_cards, game) => {
      const gain = Math.min(20, Math.max(0, game.money));
      game.money += gain;
      return "+$" + gain;
    },
  },
];

// 统一补上 kind 标识：所有塔罗牌均为 "tarot"。
// （此前各对象未显式声明 kind，导致购买后 useConsumable 无法匹配分支、
//  且存档时 kind 为 undefined 而丢失——这里集中修复。）
TAROT_POOL.forEach((t) => { t.kind = "tarot"; });

const RANK_LABELS = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };
const RANK_CHIPS = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 10, 12: 10, 13: 10, 14: 11 };
const SUIT_INFO = {
  S: { name: "黑桃", symbol: "♠", color: "black" },
  H: { name: "红桃", symbol: "♥", color: "red" },
  D: { name: "方块", symbol: "♦", color: "red" },
  C: { name: "梅花", symbol: "♣", color: "black" },
};

function setSuit(card, suitKey) {
  const info = SUIT_INFO[suitKey];
  if (!info) return;
  card.suit = suitKey;
  card.suitName = info.name;
  card.symbol = info.symbol;
  card.color = info.color;
}
function bumpRank(card, delta) {
  let r = card.rank + delta;
  if (r > 14) r = 14;
  if (r < 2) r = 2;
  card.rank = r;
  card.label = RANK_LABELS[r];
  card.chips = RANK_CHIPS[r];
}

function getTarotById(id) {
  return TAROT_POOL.find((t) => t.id === id);
}

window.Tarots = { TAROT_POOL, getTarotById };
