/* ============================================================
 * spectrals.js —— 幻灵牌（消耗牌的一种，效果更激进）
 * 每张：{ id, kind:"spectral", name, face, price, needCards:[min,max], desc, apply(cards, game) }
 *   apply 可对 game.hand / game.deck 进行增删改，返回提示文本。
 * ============================================================ */
const SPECTRAL_POOL = [
  {
    id: "familiar", name: "魔宠", face: "🐈", price: 4, needCards: [0, 0],
    desc: "随机摧毁 1 张手牌，加入 <b>3 张随机增强人头牌</b>",
    apply: (_cards, game) => {
      if (game.hand.length) game.hand.splice(Math.floor(Math.random() * game.hand.length), 1);
      const faces = [11, 12, 13];
      const enh = ["mult", "bonus", "gold", "steel", "glass"];
      for (let i = 0; i < 3; i++) {
        const card = game._makeRandomCard(faces[Math.floor(Math.random() * faces.length)]);
        card.enhancement = enh[Math.floor(Math.random() * enh.length)];
        game.hand.push(card);
      }
      return "+3 增强人头牌";
    },
  },
  {
    id: "grim", name: "厉鬼", face: "💀", price: 4, needCards: [0, 0],
    desc: "随机摧毁 1 张手牌，加入 <b>2 张随机增强 A</b>",
    apply: (_cards, game) => {
      if (game.hand.length) game.hand.splice(Math.floor(Math.random() * game.hand.length), 1);
      const enh = ["mult", "bonus", "gold", "glass", "lucky"];
      for (let i = 0; i < 2; i++) {
        const card = game._makeRandomCard(14);
        card.enhancement = enh[Math.floor(Math.random() * enh.length)];
        game.hand.push(card);
      }
      return "+2 增强 A";
    },
  },
  {
    id: "incantation", name: "咒文", face: "📜", price: 4, needCards: [0, 0],
    desc: "随机摧毁 1 张手牌，加入 <b>4 张随机增强数字牌</b>",
    apply: (_cards, game) => {
      if (game.hand.length) game.hand.splice(Math.floor(Math.random() * game.hand.length), 1);
      const enh = ["mult", "bonus", "steel", "glass", "lucky"];
      for (let i = 0; i < 4; i++) {
        const rank = 2 + Math.floor(Math.random() * 9); // 2~10
        const card = game._makeRandomCard(rank);
        card.enhancement = enh[Math.floor(Math.random() * enh.length)];
        game.hand.push(card);
      }
      return "+4 增强数字牌";
    },
  },
  {
    id: "talisman", name: "护符", face: "🧿", price: 4, needCards: [1, 1],
    desc: "为选中的 1 张牌附加 <b>金色蜡封</b>",
    apply: (cards) => { cards.forEach((c) => (c.seal = "gold")); return "金封"; },
  },
  {
    id: "deja_vu", name: "既视感", face: "🔁", price: 4, needCards: [1, 1],
    desc: "为选中的 1 张牌附加 <b>红色蜡封</b>",
    apply: (cards) => { cards.forEach((c) => (c.seal = "red")); return "红封"; },
  },
  {
    id: "trance", name: "恍惚", face: "🌀", price: 4, needCards: [1, 1],
    desc: "为选中的 1 张牌附加 <b>蓝色蜡封</b>",
    apply: (cards) => { cards.forEach((c) => (c.seal = "blue")); return "蓝封"; },
  },
  {
    id: "aura", name: "光环", face: "🌈", price: 5, needCards: [1, 1],
    desc: "为选中的 1 张牌附加随机 <b>版本</b>（闪箔/全息/多彩）",
    apply: (cards) => {
      const eds = ["foil", "holographic", "polychrome"];
      const pick = eds[Math.floor(Math.random() * eds.length)];
      cards.forEach((c) => (c.edition = pick));
      return pick;
    },
  },
  {
    id: "cryptid", name: "怪奇", face: "👾", price: 5, needCards: [1, 1],
    desc: "复制选中的 1 张牌，生成 <b>2 张相同副本</b>",
    apply: (cards, game) => {
      cards.forEach((c) => {
        for (let i = 0; i < 2; i++) {
          const copy = Object.assign({}, c, { id: game._nextCardId() });
          game.hand.push(copy);
        }
      });
      return "复制 ×2";
    },
  },
  {
    id: "immolate", name: "献祭", face: "🔥", price: 4, needCards: [0, 0],
    desc: "摧毁随机 5 张手牌，获得 <b>$20</b>",
    apply: (_cards, game) => {
      const n = Math.min(5, game.hand.length);
      for (let i = 0; i < n; i++) game.hand.splice(Math.floor(Math.random() * game.hand.length), 1);
      game.money += 20;
      return "+$20";
    },
  },
  {
    id: "ankh", name: "十字章", face: "☥", price: 6, needCards: [0, 0],
    desc: "复制 1 张随机持有的<b>小丑牌</b>（若有空位）",
    apply: (_cards, game) => {
      if (!game.jokers.length) return "无小丑可复制";
      if (game.jokers.length >= 5) return "小丑栏已满";
      const src = game.jokers[Math.floor(Math.random() * game.jokers.length)];
      game.jokers.push(Object.assign({}, src));
      return "复制 " + src.name;
    },
  },
];

function getSpectralById(id) {
  return SPECTRAL_POOL.find((s) => s.id === id);
}

// ---- 通用导出：同时兼容浏览器(window) 与 Node 命令行(module.exports) ----
(function (exported) {
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  const g = (typeof globalThis !== "undefined") ? globalThis
          : (typeof window !== "undefined") ? window : null;
  if (g) g.Spectrals = exported;
})({ SPECTRAL_POOL, getSpectralById });
