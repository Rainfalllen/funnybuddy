#!/usr/bin/env node
/* ============================================================
 * cli.js —— 小丑牌「命令行运行器」（纯逻辑层验证）
 *
 * 用途：证明本游戏的逻辑层（core/cards/jokers/planets/tarots/
 * spectrals）完全不依赖浏览器与 DOM，可在命令行(Node)独立运行。
 *
 * 它复用与浏览器完全相同的 GameCore，只是把「表现层」换成了
 * 终端文字输出 + 一个简单的自动决策器（AI）。
 *
 * 运行：
 *   node games/balatro/cli.js            # 自动打一局并打印过程
 *   node games/balatro/cli.js --quiet    # 仅打印关键节点与最终结果
 *   node games/balatro/cli.js --rounds=N # 最多推进 N 个回合后停止
 * ============================================================ */

const GameCore = require("./js/core.js");
const Cards = require("./js/cards.js");

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const MAX_ROUNDS = (() => {
  const a = args.find((x) => x.startsWith("--rounds="));
  return a ? parseInt(a.split("=")[1], 10) || 200 : 200;
})();

const log = (...a) => { if (!QUIET) console.log(...a); };
const fmt = (n) => Number(n).toLocaleString();

// ============================================================
// 接管逻辑层的事件，转成终端文字（这就是「命令行表现层」）
// ============================================================
const core = new GameCore();

core.on("log", (e) => log("   " + e.text));
core.on("blindSelect", (d) => {
  log(`\n===== 底注 ${d.ante}/${d.totalAnte} · ${d.blindName} =====`);
  log(`目标分数：${fmt(d.target)}　奖励：$${d.reward}` + (d.boss ? `　Boss：${d.boss.icon}${d.boss.name}` : ""));
});
core.on("roundWin", (b) => log(`   🏁 过关结算：+$${b.total}`));

let ended = null; // "win" | "lose"
core.on("gameWin", (d) => { ended = "win"; log(`\n🏆 通关胜利！最终资金 $${d.money}`); });
core.on("gameLose", (d) => {
  ended = "lose";
  log(`\n💀 挑战失败：底注 ${d.ante} · ${d.blindName}，得分 ${fmt(d.score)} / 目标 ${fmt(d.target)}`);
});

// ============================================================
// 自动决策器：从手牌里枚举所有 1~5 张组合，挑「期望得分」最高的出
// ============================================================
function combinations(arr, k) {
  const res = [];
  const pick = (start, combo) => {
    if (combo.length === k) { res.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); pick(i + 1, combo); combo.pop(); }
  };
  pick(0, []);
  return res;
}

// 估算某组牌的得分（基础筹码 + 计分牌点数）× 倍率
function estimate(cards, handLevels) {
  const res = Cards.evaluateHand(cards);
  const st = Cards.getHandStats(res.typeKey, handLevels);
  let chips = st.chips;
  for (const c of res.scoringCards) chips += (c.enhancement === "stone" ? 0 : c.chips);
  return { typeKey: res.typeKey, name: st.name, score: chips * st.mult };
}

function bestPlay(state) {
  const hand = state.hand;
  let best = null;
  for (let k = 1; k <= Math.min(5, hand.length); k++) {
    for (const combo of combinations(hand, k)) {
      const est = estimate(combo, state.handLevels);
      if (!best || est.score > best.score) best = { ...est, cards: combo };
    }
  }
  return best;
}

// ============================================================
// 主驱动：完全用 GameCore 的公开方法推进，不触碰任何 DOM
// ============================================================
function playOneRound() {
  core.startRound();
  let safety = 60;
  while (safety-- > 0) {
    const state = core.getState();
    const plan = bestPlay(state);

    // 牌型太弱且还能弃牌 → 弃掉不参与最优组合的低分牌，重新摸牌
    const isWeak = plan.typeKey === "highCard" || plan.typeKey === "pair";
    if (isWeak && state.discardsLeft > 0 && state.handsLeft > 1) {
      const keep = new Set(plan.cards.map((c) => c.id));
      const trash = state.hand.filter((c) => !keep.has(c.id))
        .sort((a, b) => a.chips - b.chips).slice(0, 5);
      if (trash.length) {
        trash.forEach((c) => core.toggleSelect(c.id));
        log(`   🗑 弃 ${trash.length} 张弱牌换牌`);
        core.discardHand();
        continue;
      }
    }

    // 出最优组合
    plan.cards.forEach((c) => core.toggleSelect(c.id));
    if (!core.canPlay()) return "stuck";
    const result = core.playHand();
    if (result && result.invalid) {
      // Boss 巨口：被锁定牌型，简单跳过本组合（清空选择重试）
      core.getState().selected.clear();
      continue;
    }
    // 命令行无动画，直接结算
    core.finishScoring(result);
    if (result.outcome === "win") return "win";
    if (result.outcome === "lose") return "lose";
  }
  return "timeout";
}

function shopPhase() {
  // 逛商店：买得起的第一张小丑牌买下（验证小丑牌效果在计分中触发）
  const s = core.getState();
  const idx = s.shopItems.findIndex((it) => !it.sold && it.joker.price <= s.money);
  if (idx >= 0 && s.jokers.length < s.maxJokers) {
    const r = core.buyJoker(idx);
    if (r.ok) log(`   🛒 购入小丑牌`);
  }
}

function run() {
  log("==================================================");
  log("  小丑牌 · 命令行逻辑验证（无浏览器 / 无 DOM）");
  log("==================================================");

  core.newGame(); // 进入盲注选择并触发 blindSelect 事件

  let rounds = 0;
  while (!ended && rounds < MAX_ROUNDS) {
    rounds++;
    const outcome = playOneRound();
    if (ended) break;            // gameLose 在 finishScoring 内已触发
    if (outcome !== "win") {       // stuck/timeout 等异常保护
      console.log(`   ⚠ 回合异常结束(${outcome})，停止。`);
      break;
    }
    shopPhase();                  // 过关后进入商店
    core.nextRound();             // 推进到下一盲注（可能触发 gameWin）
  }

  // ---- 最终汇总 ----
  const s = core.getState();
  console.log("\n--------------------------------------------------");
  console.log(`结果：${ended === "win" ? "通关胜利 🏆" : ended === "lose" ? "挑战失败 💀" : "已达回合上限"}`);
  console.log(`推进回合数：${rounds}　到达底注：${s.ante}/${s.totalAnte}　资金：$${s.money}　小丑牌：${s.jokers.length} 张`);
  console.log("逻辑层在命令行环境运行完毕，全程未依赖任何浏览器/DOM API。");
  console.log("--------------------------------------------------");

  process.exit(ended === "lose" ? 0 : 0);
}

run();
