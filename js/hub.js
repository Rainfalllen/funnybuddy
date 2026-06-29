/* ============================================================
 * hub.js —— 小游戏合集大厅
 * 在 GAMES 数组里增删条目即可扩展合集。
 *   - status: "ready"（可玩）/ "soon"（敬请期待）
 *   - path:   游戏入口（相对大厅 index.html）
 * ============================================================ */
const GAMES = [
  {
    id: "balatro",
    title: "小丑牌",
    subtitle: "Balatro JS",
    desc: "出牌、凑牌型、组小丑、滚雪球的卡牌肉鸽。",
    emoji: "🤡",
    tags: ["卡牌", "Roguelike", "策略"],
    accent: "#e7b94e",
    path: "games/balatro/index.html",
    status: "ready",
  },
  {
    id: "2048",
    title: "2048",
    subtitle: "Merge to 2048",
    desc: "滑动合并相同数字，挑战凑出 2048。支持键盘 / 触摸。",
    emoji: "🔢",
    tags: ["益智", "数字", "休闲"],
    accent: "#edc22e",
    path: "games/2048/index.html",
    status: "ready",
  },
  {
    id: "dicey",
    title: "骰子地下城",
    subtitle: "Dicey Dungeon JS",
    desc: "掷骰子、把骰子配进装备、闯地牢的骰子构筑肉鸽。",
    emoji: "🎲",
    tags: ["骰子", "Roguelike", "策略"],
    accent: "#6fd08e",
    path: "games/dicey/index.html",
    status: "ready",
  },
  // —— 占位：后续新增的小游戏放这里 ——
  {
    id: "coming-2",
    title: "敬请期待",
    subtitle: "Coming Soon",
    desc: "更多小游戏正在路上……",
    emoji: "🕹️",
    tags: ["即将上线"],
    accent: "#6fae8e",
    path: "",
    status: "soon",
  },
];

function renderGames() {
  const grid = document.getElementById("gameGrid");
  if (!grid) return;
  grid.innerHTML = "";

  GAMES.forEach((g, i) => {
    const ready = g.status === "ready";
    const card = document.createElement(ready ? "a" : "div");
    card.className = "game-card" + (ready ? "" : " is-soon");
    card.style.setProperty("--accent", g.accent || "#e7b94e");
    card.style.animationDelay = i * 0.07 + "s";
    if (ready) {
      card.href = g.path;
      card.setAttribute("aria-label", "进入 " + g.title);
    }

    const tags = (g.tags || [])
      .map((t) => `<span class="tag">${t}</span>`)
      .join("");

    card.innerHTML = `
      <div class="card-glow" aria-hidden="true"></div>
      <div class="card-emoji">${g.emoji || "🎮"}</div>
      <div class="card-body">
        <div class="card-title">${g.title}</div>
        <div class="card-subtitle">${g.subtitle || ""}</div>
        <div class="card-desc">${g.desc || ""}</div>
        <div class="card-tags">${tags}</div>
      </div>
      <div class="card-cta">${ready ? "开始游戏 ▶" : "敬请期待"}</div>
    `;
    grid.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", renderGames);
