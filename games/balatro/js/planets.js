/* ============================================================
 * planets.js —— 行星牌（消耗牌的一种）
 * 使用后升级对应牌型的等级（chips/mult 永久提升）。
 * 每张：{ id, kind:"planet", name, face, target(牌型key), price }
 * ============================================================ */
const PLANET_POOL = [
  { id: "pluto",   kind: "planet", name: "冥王星", face: "🪐", target: "HIGH_CARD",      price: 3 },
  { id: "mercury", kind: "planet", name: "水星",   face: "☿",  target: "PAIR",           price: 3 },
  { id: "uranus",  kind: "planet", name: "天王星", face: "🌐", target: "TWO_PAIR",       price: 3 },
  { id: "venus",   kind: "planet", name: "金星",   face: "♀",  target: "THREE_KIND",     price: 3 },
  { id: "saturn",  kind: "planet", name: "土星",   face: "🪐", target: "STRAIGHT",       price: 3 },
  { id: "jupiter", kind: "planet", name: "木星",   face: "🌕", target: "FLUSH",          price: 3 },
  { id: "earth",   kind: "planet", name: "地球",   face: "🌍", target: "FULL_HOUSE",     price: 3 },
  { id: "mars",    kind: "planet", name: "火星",   face: "🔴", target: "FOUR_KIND",      price: 3 },
  { id: "neptune", kind: "planet", name: "海王星", face: "🔵", target: "STRAIGHT_FLUSH", price: 3 },
  { id: "planetx", kind: "planet", name: "X行星",  face: "🌟", target: "FIVE_KIND",      price: 4 },
];

function getPlanetById(id) {
  return PLANET_POOL.find((p) => p.id === id);
}
// 取升级某牌型的行星牌定义
function getPlanetByTarget(typeKey) {
  return PLANET_POOL.find((p) => p.target === typeKey);
}

// ---- 通用导出：同时兼容浏览器(window) 与 Node 命令行(module.exports) ----
(function (exported) {
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  const g = (typeof globalThis !== "undefined") ? globalThis
          : (typeof window !== "undefined") ? window : null;
  if (g) g.Planets = exported;
})({ PLANET_POOL, getPlanetById, getPlanetByTarget });
