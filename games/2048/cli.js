#!/usr/bin/env node
/* ============================================================
 * cli.js —— 2048 命令行运行器（无 DOM）
 * 复用与浏览器完全相同的逻辑层 core.js，用一个简单自动决策器
 * 自动对局，证明「逻辑可脱离浏览器独立运行」。
 *
 *   node games/2048/cli.js              # 自动打一局并打印全过程
 *   node games/2048/cli.js --quiet      # 只打印关键节点与最终结果
 *   node games/2048/cli.js --moves=500  # 限制最大步数（默认 2000）
 * ============================================================ */
"use strict";

const Game2048 = require("./js/core.js");

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const maxMoves =
  parseInt((args.find((a) => a.startsWith("--moves=")) || "").split("=")[1], 10) || 2000;

const game = new Game2048();
game.newGame();

// 简单启发式：偏好「下 / 左」把大牌堆到角落，其次右，最后才上。
const PRIORITY = ["down", "left", "right", "up"];

function pickMove(g) {
  // 选择第一个能产生移动的方向（按优先级试探，不真正改状态——逻辑层无副作用预演）
  // 这里直接调用 move 并依据返回值判断；逻辑层会在无移动时返回 false 且不改变棋盘。
  for (const dir of PRIORITY) {
    // 预演：克隆一份状态太重，改为「真正走一步」，因为 move 仅在有效时才生效。
    if (g.move(dir)) return dir;
  }
  return null;
}

let moves = 0;
const state0 = game.getState();
if (!quiet) {
  console.log("== 2048 · 命令行自动对局 ==");
  console.log(game.toString());
}

game.on("win", (d) => {
  if (!quiet) console.log(`>>> 达成 2048！当前得分 ${d.score}（继续冲击更高分）`);
  game.continueGame(); // 自动继续，看能堆多高
});

let lastMilestone = 0;
while (moves < maxMoves) {
  const dir = pickMove(game);
  if (!dir) break; // 无任何方向可动 → 结束
  moves++;
  const st = game.getState();
  if (!quiet) {
    console.log(`第 ${moves} 步 → ${dir}  得分 ${st.score}`);
    console.log(game.toString());
  } else {
    // 静默模式：每翻一倍最高块时报告一次
    const maxTile = Math.max(...st.grid.flat());
    if (maxTile >= lastMilestone * 2 && maxTile >= 64) {
      lastMilestone = maxTile;
      console.log(`步数 ${moves} · 得分 ${st.score} · 最高块 ${maxTile}`);
    }
  }
  if (st.over) break;
}

const final = game.getState();
const maxTile = Math.max(...final.grid.flat());
console.log("---------------------------------------");
console.log(game.toString());
console.log(
  `结束：步数 ${moves} · 得分 ${final.score} · 最高块 ${maxTile} · ` +
    (final.over ? "无路可走" : "达到步数上限") +
    (final.won ? " · 已达成 2048" : "")
);
console.log("逻辑层在命令行独立运行完毕（全程无 DOM）。");
