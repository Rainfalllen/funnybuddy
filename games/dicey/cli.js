#!/usr/bin/env node
/* ============================================================
 * cli.js —— 骰子地下城「命令行运行器」（纯逻辑层验证）
 *
 * 用途：证明本游戏的逻辑层（data/core）完全不依赖浏览器与 DOM，
 * 可在命令行(Node)独立运行。它复用与浏览器完全相同的 GameCore，
 * 只是把「表现层」换成终端文字输出 + 一个简单的自动决策器（AI）。
 *
 * 运行：
 *   node games/dicey/cli.js            # 自动打一局并打印过程
 *   node games/dicey/cli.js --quiet    # 仅打印关键节点与最终结果
 *   node games/dicey/cli.js --runs=N   # 连续模拟 N 局，统计通关率
 *   node games/dicey/cli.js --seed=123 # 固定随机种子复现
 * ============================================================ */

const GameCore = require("./js/core.js");
const Data = require("./js/data.js");

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const RUNS = (() => {
  const a = args.find((x) => x.startsWith("--runs="));
  return a ? Math.max(1, parseInt(a.split("=")[1], 10) || 1) : 1;
})();
const SEED_ARG = (() => {
  const a = args.find((x) => x.startsWith("--seed="));
  return a ? parseInt(a.split("=")[1], 10) : null;
})();

const log = (...a) => { if (!QUIET) console.log(...a); };

// 可复现的伪随机数发生器（mulberry32）
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// 自动决策器：在玩家回合，把每个骰子分配给「评分最高」的装备
// ============================================================
function actionScore(eff, dieValue, player, enemy, eq) {
  const val = Data.resolveValue(eff.value, dieValue);
  // 累计槽（sum）：投入一个骰子只推进进度，未达阈值不会触发效果。
  // 故按「进度价值」评分，避免把每次投入都当成整段伤害而无脑喂炮。
  if (eq && eq.condition && eq.condition.type === "sum") {
    const need = eq.condition.value || 1;
    const after = (eq.sumProgress || 0) + dieValue;
    if (after < need) return dieValue * 0.6;              // 仅蓄能：价值偏低
    // 达成阈值：本次投入即触发，按真实效果计分
    if (eff.type === "damage") {
      let s = val;
      if (val >= enemy.hp + enemy.block) s += 100;
      return s;
    }
  }
  switch (eff.type) {
    case "damage": {
      let s = eff.pierce ? val - Math.min(val, enemy.block) + val * 0.3 : val; // 穿透更看重
      const times = eff.times && eff.times > 1 ? eff.times : 1;
      s *= times;
      if (val * times >= enemy.hp + (eff.pierce ? 0 : enemy.block)) s += 100;  // 可击杀：最高优先
      return s;
    }
    case "poison": return val * 1.6;
    case "burn":   return val * 1.5;
    case "freeze": return 3;
    case "weak":   return val * 1.2;
    case "vuln":   return val * 1.3;
    case "thorns": return val * 0.8;
    // 血量健康时不太需要防御/治疗，给低权重
    case "shield": return player.hp < player.maxHp * 0.5 ? val * 0.9 : val * 0.2;
    case "heal":   return player.hp < player.maxHp * 0.6 ? val : 0.2;
    default:       return 0;
  }
}

// 估算一件装备「用于防御」的价值（护盾/治疗/净化），不含进攻
function defenseValue(eq, dieValue, player) {
  let v = 0;
  for (const eff of eq.effects) {
    const val = Data.resolveValue(eff.value, dieValue);
    if (eff.type === "shield") v += val;
    else if (eff.type === "heal") v += Math.min(val, player.maxHp - player.hp);
    else if (eff.type === "thorns") v += val * 0.4;
  }
  return v;
}

function playerAutoTurn(core) {
  let guard = 40;
  while (guard-- > 0) {
    const st = core.getState();
    if (st.phase !== "battle" || st.battle.turn !== "player" || st.battle.over) break;
    const p = st.player;
    const enemy = st.battle.enemy;
    const dice = p.dice.filter((d) => !d.used);
    if (!dice.length) break;

    // 大招：骰子普遍偏小且充能满时，重掷一次
    if (p.limit.charge >= p.limit.chargeMax) {
      const avg = dice.reduce((s, d) => s + d.value, 0) / dice.length;
      if (avg <= 2.2) { core.useLimitBreak(); continue; }
    }

    // 本回合总可造成的「立即伤害」上限粗估（用于判断能否斩杀）——只数能直接打出的攻击
    const lethalNow = (() => {
      let dmg = 0;
      for (const die of dice) {
        let bestHit = 0;
        for (const eq of p.equipment) {
          if (eq.usesLeft <= 0) continue;
          if (!Data.checkCondition(eq.condition, die.value)) continue;
          if (eq.condition && eq.condition.type === "sum") continue; // 累计槽不计入即时斩杀
          for (const eff of eq.effects) {
            if (eff.type === "damage") {
              const v = Data.resolveValue(eff.value, die.value) * (eff.times > 1 ? eff.times : 1);
              if (v > bestHit) bestHit = v;
            }
          }
        }
        dmg += bestHit;
      }
      return dmg >= enemy.hp; // 护盾忽略不计，仅作粗略斩杀判断
    })();

    // 意图感知防御：若无法本回合斩杀且预判受到的伤害会击穿当前护盾，先用一个骰子加固
    const intent = st.battle.intent;
    const incoming = intent && !intent.willDieToDot ? intent.damage : 0;
    const needDefense = !lethalNow && incoming > p.block && p.hp - (incoming - p.block) <= p.maxHp * 0.45;
    if (needDefense) {
      let bestDef = null;
      for (const die of dice) {
        for (const eq of p.equipment) {
          if (eq.usesLeft <= 0) continue;
          if (!Data.checkCondition(eq.condition, die.value)) continue;
          const dv = defenseValue(eq, die.value, p);
          if (dv <= 0) continue;
          if (!bestDef || dv > bestDef.dv) bestDef = { die, eq, dv };
        }
      }
      if (bestDef) { const r = core.assignDie(bestDef.die.id, bestDef.eq.instId); if (r.ok) continue; }
    }

    let best = null;
    for (const die of dice) {
      for (const eq of p.equipment) {
        if (eq.usesLeft <= 0) continue;
        if (!Data.checkCondition(eq.condition, die.value)) continue;
        let score = 0;
        for (const eff of eq.effects) score += actionScore(eff, die.value, p, enemy, eq);
        if (!best || score > best.score) best = { die, eq, score };
      }
    }
    if (!best) break;                                       // 没有任何可用组合
    const r = core.assignDie(best.die.id, best.eq.instId);
    if (!r.ok) break;
  }
  // 结束回合（若战斗仍在进行）
  const st = core.getState();
  if (st.phase === "battle" && !st.battle.over && st.battle.turn === "player") core.endTurn();
}

// 奖励阶段：容量够就拿走价格最高的；否则尝试替换；都不行就跳过（保证流程推进）
function autoReward(core) {
  const st = core.getState();
  if (st.phase !== "reward") return;
  const opts = st.reward.options.slice().sort((a, b) => b.price - a.price);
  const p = st.player;

  // 1) 容量充足：直接拿最贵的
  for (const opt of opts) {
    if (p.usedCapacity + opt.size <= p.capacity) {
      const r = core.pickReward(opt.id);
      if (r.ok) return;
    }
  }
  // 2) 容量不足：仅当新装备「更值钱」时才替换掉价值最低的装备（避免降级）
  const owned = p.equipment.slice().sort((a, b) => (a.price || 0) - (b.price || 0));
  for (const opt of opts) {
    for (const old of owned) {
      if ((opt.price || 0) <= (old.price || 0)) continue;        // 不做降级替换
      if (p.usedCapacity - (old.size || 1) + opt.size <= p.capacity) {
        const r = core.replaceWithReward(opt.id, old.instId);
        if (r.ok) return;
      }
    }
  }
  // 3) 放不下又不值得替换：跳过
  core.skipReward();
}

// 商店阶段：缺血先买治疗，再在预算内买最贵的能放下的装备，然后离开
function autoShop(core) {
  let guard = 10;
  while (guard-- > 0) {
    const st = core.getState();
    if (st.phase !== "shop") return;
    const p = st.player;
    if (p.hp < p.maxHp * 0.5 && p.gold >= st.shop.healCost) { core.buyHeal(); continue; }
    // 优先升级已有的可升级装备（性价比高）
    const upgradable = p.equipment.find((e) => e.upgradeId);
    if (upgradable && p.gold >= st.shop.upgradeCost) { core.upgradeEquipment(upgradable.instId); continue; }
    const affordable = st.shop.items
      .filter((it) => !it.sold && it.price <= p.gold && p.usedCapacity + it.equip.size <= p.capacity)
      .sort((a, b) => b.price - a.price);
    if (affordable.length) { core.buyEquipment(affordable[0].id); continue; }
    break;
  }
  core.leaveShop();
}

// 事件阶段：在可选项里挑一个收益指令最丰富的（带兜底「离开」），保证流程推进
function autoEvent(core) {
  const st = core.getState();
  if (st.phase !== "event") return;
  const choices = st.event.choices.filter((c) => c.available);
  if (!choices.length) { core.leaveEvent(); return; }
  // 简单偏好：避开纯扣血的强行选项，优先靠前（通常为升级/获取装备）的可用项
  const pick = choices.find((c) => !/强行|献祭|生命换/.test(c.text)) || choices[0];
  log(`   ❔ 事件【${st.event.name}】→ 选择：${pick.text}`);
  core.chooseEventOption(pick.index);
}

// 地图阶段：优先精英/宝箱（高收益），其次商店/战斗，最后营火
function autoMap(core) {
  const st = core.getState();
  if (st.phase !== "map") return;
  const row = st.map.currentRow;
  const p = st.player;
  const priority = p.hp < p.maxHp * 0.4
    ? ["heal", "shop", "treasure", "battle", "elite", "boss"]
    : ["elite", "treasure", "battle", "shop", "heal", "boss"];
  let target = null;
  for (const t of priority) { target = row.find((n) => n.type === t); if (target) break; }
  if (!target) target = row[0];
  log(`\n🧭 第 ${st.map.rowIndex + 1}/${st.map.totalRows} 层 → 选择【${target.meta.label}】` +
      (target.enemy ? ` ${target.enemy.icon}${target.enemy.name}` : ""));
  core.chooseNode(target.id);
}

// ============================================================
// 跑一整局，返回结果："win" | "lose" | "timeout"
// ============================================================
function playOneGame(seed) {
  const core = new GameCore({ rng: makeRng(seed) });
  let ended = null;
  // 平衡指标采集（文档 §32.2）
  const stats = { battles: 0, bossBattles: 0, turnsTotal: 0, bossTurnsTotal: 0, dmgTaken: 0 };

  core.on("log", (e) => log("   " + e.text));
  core.on("battleStart", (d) => log(`   — 战斗开始：${d.enemy.icon} ${d.enemy.name}`));
  core.on("levelUp", (d) => log(`   ⬆️ Lv.${d.level}（${d.rewards.join("，")}）`));
  core.on("damage", (d) => { if (d.side === "player") stats.dmgTaken += Math.max(0, d.amount - (d.absorbed || 0)); });
  core.on("battleWin", () => {
    const b = core.getState().battle;
    if (!b) return;
    stats.battles++;
    stats.turnsTotal += b.turnNo;
    if (b.enemy && b.enemy.boss) { stats.bossBattles++; stats.bossTurnsTotal += b.turnNo; }
  });
  core.on("gameWin", () => { ended = "win"; });
  core.on("gameLose", () => { ended = "lose"; });

  core.newGame();

  let guard = 400;
  while (!ended && guard-- > 0) {
    const phase = core.getState().phase;
    if (phase === "map") autoMap(core);
    else if (phase === "battle") playerAutoTurn(core);
    else if (phase === "reward") autoReward(core);
    else if (phase === "shop") autoShop(core);
    else if (phase === "event") autoEvent(core);
    else if (phase === "gameover") break;
    else break;
  }
  const state = core.getState();
  // 死亡时所处章节 / 是否倒在 Boss 层（地图最后一层）
  const deathChapter = state.chapter || 1;
  const onBossFloor = state.map ? (state.map.rowIndex >= state.map.totalRows - 1) : false;
  return { ended: ended || "timeout", state, stats, deathChapter, onBossFloor };
}

// ============================================================
// 主入口
// ============================================================
function main() {
  console.log("==================================================");
  console.log("  骰子地下城 · 命令行逻辑验证（无浏览器 / 无 DOM）");
  console.log("==================================================");

  if (RUNS === 1) {
    const seed = SEED_ARG != null ? SEED_ARG : (Date.now() & 0xffffffff);
    const { ended, state } = playOneGame(seed);
    console.log("\n--------------------------------------------------");
    console.log(`随机种子：${seed}`);
    console.log(`结果：${ended === "win" ? "通关胜利 🏆" : ended === "lose" ? "挑战失败 💀" : "异常/超时 ⚠"}`);
    console.log(`最终：等级 ${state.player.level}　生命 ${Math.max(0, state.player.hp)}/${state.player.maxHp}` +
                `　金币 $${state.player.gold}　装备 ${state.player.equipment.length} 件`);
    console.log("逻辑层在命令行环境运行完毕，全程未依赖任何浏览器/DOM API。");
    console.log("--------------------------------------------------");
    return;
  }

  // 多局模拟：统计通关率与平衡指标（文档 §32.2）
  let win = 0, lose = 0, other = 0;
  const deathByChapter = {};        // 各章节死亡数
  let bossFloorDeaths = 0;          // 倒在 Boss 层的次数
  let battles = 0, turns = 0, bossBattles = 0, bossTurns = 0, dmgTaken = 0;
  const baseSeed = SEED_ARG != null ? SEED_ARG : 1;
  for (let i = 0; i < RUNS; i++) {
    const r = playOneGame(baseSeed + i * 9973);
    if (r.ended === "win") win++;
    else if (r.ended === "lose") {
      lose++;
      deathByChapter[r.deathChapter] = (deathByChapter[r.deathChapter] || 0) + 1;
      if (r.onBossFloor) bossFloorDeaths++;
    } else other++;
    battles += r.stats.battles; turns += r.stats.turnsTotal;
    bossBattles += r.stats.bossBattles; bossTurns += r.stats.bossTurnsTotal;
    dmgTaken += r.stats.dmgTaken;
  }
  const pct = (n) => ((n / RUNS) * 100).toFixed(1) + "%";
  console.log("\n--------------------------------------------------");
  console.log(`模拟 ${RUNS} 局：通关 ${win}（${pct(win)}）　失败 ${lose}　异常 ${other}`);
  console.log(`平均普通战斗回合：${battles ? (turns / battles).toFixed(1) : "-"}` +
              `　平均 Boss 战回合：${bossBattles ? (bossTurns / bossBattles).toFixed(1) : "-"}`);
  console.log(`平均每局受到伤害：${(dmgTaken / RUNS).toFixed(1)}　倒在 Boss 层占失败：` +
              `${lose ? ((bossFloorDeaths / lose) * 100).toFixed(0) + "%" : "-"}`);
  const chs = Object.keys(deathByChapter).sort();
  if (chs.length) console.log("死亡章节分布：" + chs.map((c) => `第${c}章 ${deathByChapter[c]}`).join("　"));
  console.log("--------------------------------------------------");
}

main();
