/* ============================================================
 * jokers.js —— 小丑牌定义与效果（逻辑层数据）
 *
 * 每张小丑牌：{ id, name, face, desc, price, rarity, fx, effect(ctx) }
 *
 * 逻辑与表现分离的关键约定：
 *   - effect(ctx)  只负责“计算数值”（修改 ctx.chips / mult / xmult），
 *                  返回 true 表示本次触发（让表现层知道要不要演出）。
 *   - fx           只负责“描述表现”——它是一个指向 JOKER_FX 的键，
 *                  告诉表现层这张牌触发时该放什么颜色的粒子 / 光环 /
 *                  震屏强度 / 音效。effect 完全不碰 DOM，fx 完全不碰数值。
 *   表现层（view.js）拿到 core 写入 step 的 fx 元数据后，统一演出。
 *
 * 计分上下文 ctx 字段：
 *   chips        当前累计筹码
 *   mult         当前累计倍率（加区）
 *   xmult        倍率乘区（最后统一相乘）
 *   scoringCards 参与计分的牌
 *   playedCards  本次打出的所有牌
 *   handTypeKey  牌型 key
 *   game         游戏状态对象
 * ============================================================ */

/* ------------------------------------------------------------
 * JOKER_FX —— 小丑牌触发特效“元数据表”（纯表现，被 view.js 读取）
 *   color     主粒子颜色
 *   glow      外圈/高光颜色
 *   sound     触发音效（对应 window.SFX 上的函数名）
 *   shake     震屏强度：0 无 / 1 轻 / 2 强（强会附带红屏闪光）
 *   particle  迸发粒子数量
 *   label     飘字配色（chip / mult / money）
 *   ring      是否生成扩散光环
 *   ringColor 光环颜色
 *   rainbow   光环是否走彩虹流光（用于 xmult 高光时刻）
 *   big       是否使用更夸张的“腾空”触发动画
 * ------------------------------------------------------------ */
const JOKER_FX = {
  // 加筹码：冷色、克制、无光环
  chips:  { color: "#4aa3e4", glow: "#9ad8ff", sound: "chip",  shake: 0, particle: 12, label: "chip" },
  // 加倍率：暖红、轻微震屏
  mult:   { color: "#e44b4b", glow: "#ff9b9b", sound: "mult",  shake: 1, particle: 16, label: "mult" },
  // 乘区：洋红 + 彩虹光环 + 强震屏，全场最高光
  xmult:  { color: "#ff4af0", glow: "#ffe27a", sound: "xmult", shake: 2, particle: 28, label: "mult", ring: true, ringColor: "#ff4af0", rainbow: true, big: true },
  // 金钱：金色 + 金环
  money:  { color: "#ffd54a", glow: "#ffe98a", sound: "coin",  shake: 0, particle: 16, label: "money", ring: true, ringColor: "#ffd54a" },
  // 随机：紫色 + 紫环 + 颤音
  random: { color: "#9b6bff", glow: "#d8c2ff", sound: "warble", shake: 1, particle: 20, label: "mult", ring: true, ringColor: "#9b6bff" },
};

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
    id: "joker", name: "小丑", face: "😀", price: 2, rarity: "common", fx: "mult",
    desc: "<b>+4</b> 倍率",
    effect: (ctx) => { ctx.mult += 4; return true; },
  },
  {
    id: "greedy", name: "贪婪小丑", face: "♦️", price: 5, rarity: "common", fx: "mult",
    desc: "每张计分的<b>方块</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "D").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "lusty", name: "好色小丑", face: "♥️", price: 5, rarity: "common", fx: "mult",
    desc: "每张计分的<b>红桃</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "H").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "wrathful", name: "暴怒小丑", face: "♠️", price: 5, rarity: "common", fx: "mult",
    desc: "每张计分的<b>黑桃</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "S").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "gluttonous", name: "暴食小丑", face: "♣️", price: 5, rarity: "common", fx: "mult",
    desc: "每张计分的<b>梅花</b>牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.suit === "C").length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "jolly", name: "欢乐小丑", face: "🤪", price: 4, rarity: "common", fx: "mult",
    desc: "打出的牌含<b>对子</b>时 <b>+8</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "PAIR")) { ctx.mult += 8; return true; }
    },
  },
  {
    id: "zany", name: "疯狂小丑", face: "🤡", price: 4, rarity: "common", fx: "mult",
    desc: "打出的牌含<b>三条</b>时 <b>+12</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "THREE")) { ctx.mult += 12; return true; }
    },
  },
  {
    id: "mad", name: "愤怒小丑", face: "😡", price: 4, rarity: "common", fx: "mult",
    desc: "打出的牌含<b>两对</b>时 <b>+10</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "TWO_PAIR")) { ctx.mult += 10; return true; }
    },
  },
  {
    id: "crazy", name: "狂热小丑", face: "😵", price: 4, rarity: "common", fx: "mult",
    desc: "打出的牌含<b>顺子</b>时 <b>+12</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "STRAIGHT")) { ctx.mult += 12; return true; }
    },
  },
  {
    id: "droll", name: "滑稽小丑", face: "😜", price: 4, rarity: "common", fx: "mult",
    desc: "打出的牌含<b>同花</b>时 <b>+10</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "FLUSH")) { ctx.mult += 10; return true; }
    },
  },
  {
    id: "sly", name: "狡黠小丑", face: "🦊", price: 3, rarity: "common", fx: "chips",
    desc: "打出的牌含<b>对子</b>时 <b>+50</b> 筹码",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "PAIR")) { ctx.chips += 50; return true; }
    },
  },
  {
    id: "wily", name: "老练小丑", face: "🦉", price: 4, rarity: "common", fx: "chips",
    desc: "打出的牌含<b>三条</b>时 <b>+100</b> 筹码",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "THREE")) { ctx.chips += 100; return true; }
    },
  },
  {
    id: "clever", name: "聪明小丑", face: "🧠", price: 4, rarity: "common", fx: "chips",
    desc: "打出的牌含<b>两对</b>时 <b>+80</b> 筹码",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "TWO_PAIR")) { ctx.chips += 80; return true; }
    },
  },
  {
    id: "half", name: "半个小丑", face: "🎭", price: 5, rarity: "common", fx: "mult",
    desc: "打出 <b>3张或更少</b> 时 <b>+20</b> 倍率",
    effect: (ctx) => {
      if (ctx.playedCards.length <= 3) { ctx.mult += 20; return true; }
    },
  },
  {
    id: "evensteven", name: "偶数史蒂文", face: "➗", price: 4, rarity: "common", fx: "mult",
    desc: "每张计分的 <b>偶数</b> 牌 <b>+4</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isEven).length;
      if (n) { ctx.mult += 4 * n; return true; }
    },
  },
  {
    id: "oddtodd", name: "奇数托德", face: "➕", price: 4, rarity: "common", fx: "chips",
    desc: "每张计分的 <b>奇数</b> 牌 <b>+31</b> 筹码",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isOdd).length;
      if (n) { ctx.chips += 31 * n; return true; }
    },
  },
  {
    id: "scaryface", name: "鬼脸", face: "👹", price: 4, rarity: "common", fx: "chips",
    desc: "每张计分的 <b>人头</b> 牌(J/Q/K) <b>+30</b> 筹码",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isFace).length;
      if (n) { ctx.chips += 30 * n; return true; }
    },
  },
  {
    id: "fibonacci", name: "斐波那契", face: "🌀", price: 8, rarity: "uncommon", fx: "mult",
    desc: "每张计分的 <b>A/2/3/5/8</b> <b>+8</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => [14, 2, 3, 5, 8].includes(c.rank)).length;
      if (n) { ctx.mult += 8 * n; return true; }
    },
  },
  {
    id: "bull", name: "公牛", face: "🐂", price: 6, rarity: "uncommon", fx: "chips",
    desc: "每拥有 <b>$1</b> 资金 <b>+2</b> 筹码",
    effect: (ctx) => {
      const m = Math.max(0, ctx.game.money);
      if (m) { ctx.chips += 2 * m; return true; }
    },
  },
  {
    id: "banner", name: "旗帜", face: "🚩", price: 5, rarity: "common", fx: "chips",
    desc: "每剩余 <b>1</b> 次弃牌 <b>+30</b> 筹码",
    effect: (ctx) => {
      const d = ctx.game.discardsLeft;
      if (d) { ctx.chips += 30 * d; return true; }
    },
  },
  {
    id: "abstract", name: "抽象小丑", face: "🎨", price: 4, rarity: "common", fx: "mult",
    desc: "每拥有 <b>1</b> 张小丑牌 <b>+3</b> 倍率",
    effect: (ctx) => {
      const n = ctx.game.jokers.length;
      if (n) { ctx.mult += 3 * n; return true; }
    },
  },
  {
    id: "misprint", name: "错版", face: "🎲", price: 4, rarity: "common", fx: "random",
    desc: "<b>+0~23</b> 随机倍率",
    effect: (ctx) => {
      ctx.mult += Math.floor(Math.random() * 24); return true;
    },
  },
  {
    id: "acrobat", name: "杂技演员", face: "🤸", price: 6, rarity: "uncommon", fx: "xmult",
    desc: "本回合 <b>最后一次出牌</b> 时 <b>×3</b> 倍率",
    effect: (ctx) => {
      if (ctx.game.handsLeft === 0) { ctx.xmult *= 3; return true; }
    },
  },
  {
    id: "scholar", name: "学者", face: "📖", price: 4, rarity: "common", fx: "mult",
    desc: "每张计分的 <b>A</b> <b>+20</b> 筹码且 <b>+4</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.rank === 14).length;
      if (n) { ctx.chips += 20 * n; ctx.mult += 4 * n; return true; }
    },
  },
  {
    id: "supernova", name: "超新星", face: "💥", price: 5, rarity: "uncommon", fx: "mult",
    desc: "倍率 <b>+</b> 本局该牌型已打出的次数",
    effect: (ctx) => {
      const cnt = ctx.game.handTypePlays[ctx.handTypeKey] || 0;
      if (cnt) { ctx.mult += cnt; return true; }
    },
  },
  {
    id: "ride", name: "公车惊魂", face: "🚌", price: 6, rarity: "uncommon", fx: "mult",
    desc: "连续打出 <b>不含人头牌</b> 的牌型，每次 <b>+1</b> 倍率（计分时累计）",
    effect: (ctx) => {
      if (ctx.scoringCards.some(isFace)) {
        ctx._resetRide = true; // 由游戏结算后处理
      }
      const v = ctx.game.rideCounter || 0;
      if (v) { ctx.mult += v; return true; }
    },
  },

  // ---------- 倍率乘区（xmult）小丑牌 ----------
  {
    id: "joker_stencil", name: "小丑模板", face: "🃏", price: 8, rarity: "uncommon", fx: "xmult",
    desc: "每有 <b>1</b> 个空小丑栏位 <b>×1</b> 倍率（基于上限5）",
    effect: (ctx) => {
      const empty = 5 - ctx.game.jokers.length;
      if (empty > 0) { ctx.xmult *= (1 + empty); return true; }
    },
  },
  {
    id: "blackboard", name: "黑板", face: "⬛", price: 7, rarity: "uncommon", fx: "xmult",
    desc: "若所有计分牌均为 <b>黑桃/梅花</b>，<b>×3</b> 倍率",
    effect: (ctx) => {
      const all = ctx.scoringCards.length > 0 &&
        ctx.scoringCards.every((c) => c.suit === "S" || c.suit === "C" || c.enhancement === "wild");
      if (all) { ctx.xmult *= 3; return true; }
    },
  },
  {
    id: "the_duo", name: "二重奏", face: "✌️", price: 8, rarity: "rare", fx: "xmult",
    desc: "打出的牌含 <b>对子</b> 时 <b>×2</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "PAIR")) { ctx.xmult *= 2; return true; }
    },
  },
  {
    id: "the_trio", name: "三重奏", face: "🎵", price: 9, rarity: "rare", fx: "xmult",
    desc: "打出的牌含 <b>三条</b> 时 <b>×3</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "THREE")) { ctx.xmult *= 3; return true; }
    },
  },
  {
    id: "the_family", name: "家族", face: "👨‍👩‍👧", price: 10, rarity: "rare", fx: "xmult",
    desc: "打出的牌含 <b>四条</b> 时 <b>×4</b> 倍率",
    effect: (ctx) => {
      if (handContains(ctx.handTypeKey, "THREE") && ctx.handTypeKey === "FOUR_KIND") { ctx.xmult *= 4; return true; }
      if (ctx.handTypeKey === "FOUR_KIND" || ctx.handTypeKey === "FIVE_KIND") { ctx.xmult *= 4; return true; }
    },
  },
  {
    id: "cavendish", name: "卡文迪什", face: "🍌", price: 6, rarity: "uncommon", fx: "xmult",
    desc: "<b>×3</b> 倍率",
    effect: (ctx) => { ctx.xmult *= 3; return true; },
  },
  {
    id: "baron", name: "男爵", face: "🤵", price: 8, rarity: "rare", fx: "xmult",
    desc: "手牌中每张 <b>K</b> <b>×1.5</b> 倍率",
    effect: (ctx) => {
      const n = (ctx.game.hand || []).filter((c) => c.rank === 13).length;
      if (n) { ctx.xmult *= Math.pow(1.5, n); return true; }
    },
  },
  {
    id: "blueprint", name: "蓝图", face: "📐", price: 10, rarity: "rare", fx: "mult",
    desc: "复制 <b>右侧</b> 小丑牌的倍率/筹码效果（简化：+本次已累计倍率的20%）",
    effect: (ctx) => {
      const add = Math.floor((ctx.mult - 0) * 0.2);
      if (add > 0) { ctx.mult += add; return true; }
    },
  },

  // ---------- 增强联动 ----------
  {
    id: "golden", name: "金券", face: "💲", price: 6, rarity: "common", fx: "money",
    desc: "回合结束 <b>+$4</b>（由游戏结算）",
    effect: () => false, // 被动收益，在 winRound 结算
    passiveMoney: 4,
  },
  {
    id: "hologram", name: "全息图", face: "📀", price: 7, rarity: "uncommon", fx: "chips",
    desc: "每张计分的 <b>含特殊版本/增强</b> 的牌 <b>+15</b> 筹码",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => (c.edition && c.edition !== "none") || (c.enhancement && c.enhancement !== "none")).length;
      if (n) { ctx.chips += 15 * n; return true; }
    },
  },

  // ---------- 新增：更多机制细节的小丑牌 ----------
  {
    id: "smiley", name: "笑脸", face: "😁", price: 4, rarity: "common", fx: "mult",
    desc: "每张计分的 <b>人头</b> 牌(J/Q/K) <b>+4</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter(isFace).length;
      if (n) { ctx.mult += 4 * n; return true; }
    },
  },
  {
    id: "walkie", name: "对讲机", face: "📻", price: 4, rarity: "common", fx: "chips",
    desc: "每张计分的 <b>10 或 4</b> <b>+10</b> 筹码且 <b>+4</b> 倍率",
    effect: (ctx) => {
      const n = ctx.scoringCards.filter((c) => c.rank === 10 || c.rank === 4).length;
      if (n) { ctx.chips += 10 * n; ctx.mult += 4 * n; return true; }
    },
  },
  {
    id: "smeared", name: "脏污小丑", face: "🖌️", price: 6, rarity: "uncommon", fx: "chips",
    desc: "每张计分的牌 <b>+12</b> 筹码",
    effect: (ctx) => {
      const n = ctx.scoringCards.length;
      if (n) { ctx.chips += 12 * n; return true; }
    },
  },
  {
    id: "photograph", name: "相片", face: "📷", price: 5, rarity: "uncommon", fx: "xmult",
    desc: "第一张计分的 <b>人头</b> 牌 <b>×2</b> 倍率",
    effect: (ctx) => {
      if (ctx.scoringCards.some(isFace)) { ctx.xmult *= 2; return true; }
    },
  },
  {
    id: "flowerpot", name: "花盆", face: "🪴", price: 8, rarity: "rare", fx: "xmult",
    desc: "计分牌 <b>四种花色齐全</b> 时 <b>×3</b> 倍率（万能牌通配）",
    effect: (ctx) => {
      const need = new Set(["S", "H", "D", "C"]);
      let wild = 0;
      for (const c of ctx.scoringCards) {
        if (c.enhancement === "wild") wild++; else need.delete(c.suit);
      }
      if (need.size <= wild) { ctx.xmult *= 3; return true; }
    },
  },
  {
    id: "swashbuckler", name: "扛把子", face: "🏴‍☠️", price: 6, rarity: "uncommon", fx: "mult",
    desc: "倍率 <b>+</b> 其它所有小丑牌的售价总和",
    effect: (ctx) => {
      let sum = 0;
      for (const j of ctx.game.jokers) {
        if (j.id !== "swashbuckler") sum += Math.max(1, Math.floor((j.price || 2) / 2));
      }
      if (sum) { ctx.mult += sum; return true; }
    },
  },
  {
    id: "spark", name: "电火花", face: "⚡", price: 5, rarity: "uncommon", fx: "random",
    desc: "本次计分 <b>+55</b> 筹码并迸发电流",
    effect: (ctx) => {
      if (!ctx.scoringCards.length) return false;
      ctx.chips += 55; return true;
    },
  },
  {
    id: "ramen", name: "拉面", face: "🍜", price: 7, rarity: "uncommon", fx: "xmult",
    desc: "<b>×2</b> 倍率",
    effect: (ctx) => { ctx.xmult *= 2; return true; },
  },
];

function getJokerById(id) {
  return JOKER_POOL.find((j) => j.id === id);
}

// ---- 通用导出：同时兼容浏览器(window) 与 Node 命令行(module.exports) ----
// 逻辑层数据不依赖 DOM，可在命令行环境直接 require。
(function (exported) {
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  const g = (typeof globalThis !== "undefined") ? globalThis
          : (typeof window !== "undefined") ? window : null;
  if (g) g.Jokers = exported;
})({ JOKER_POOL, JOKER_FX, getJokerById });
