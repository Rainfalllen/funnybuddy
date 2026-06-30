/* ============================================================
 * data.js —— 骰子地下城·静态数据与纯函数工具层
 *
 * 这里集中存放所有「可序列化的规则数据」与「不依赖状态的纯函数」：
 *   - 状态效果（毒/燃烧/冰冻/虚弱/护盾）的元数据
 *   - 骰子条件（任意/奇偶/最大/最小/指定）的判定与描述
 *   - 效果数值解析（"dice" / "dice+2" / 固定数字）
 *   - 装备池、敌人池、角色定义、成长表
 *
 * 本模块完全不依赖 DOM / 浏览器，可被浏览器 <script> 加载，
 * 也可被 Node 命令行 require —— 与 README 的「逻辑/表现分离」约定一致。
 * ============================================================ */
(function () {
  "use strict";

  // ---------- 骰子 ----------
  const DICE = { MIN: 1, MAX: 6, FLIP_BASE: 7 };

  // 投掷一个骰子（注入 rng 便于命令行/测试复现）
  function rollDie(rng) {
    const r = typeof rng === "function" ? rng : Math.random;
    return DICE.MIN + Math.floor(r() * (DICE.MAX - DICE.MIN + 1));
  }

  // ---------- 状态效果元数据 ----------
  // 仅描述「是什么」，具体结算逻辑在 core.js（保持数据与流程分离）。
  const STATUSES = {
    poison: { key: "poison", name: "中毒", icon: "☠", color: "#7ed957", desc: "回合开始受到层数点伤害，随后层数 -1" },
    burn:   { key: "burn",   name: "燃烧", icon: "🔥", color: "#ff7a45", desc: "回合开始受到层数点伤害，随后层数减半" },
    freeze: { key: "freeze", name: "冰冻", icon: "❄",  color: "#58c8f0", desc: "下个回合最高点数的骰子被冻成 1" },
    weak:   { key: "weak",   name: "虚弱", icon: "💧", color: "#b08fe0", desc: "造成的伤害降低约 1/3，每回合 -1 层" },
    thorns: { key: "thorns", name: "荆棘", icon: "🌵", color: "#9ad14b", desc: "被攻击时对攻击者反弹层数点伤害，每回合 -1 层" },
    vuln:   { key: "vuln",   name: "易伤", icon: "🎯", color: "#ef6a6a", desc: "受到的攻击伤害提高 50%，每回合 -1 层" },
    shield: { key: "shield", name: "护盾", icon: "🛡", color: "#cfd8dc", desc: "抵消等量伤害，自己回合开始时清空" },
  };

  // ---------- 骰子条件 ----------
  // 判定一个点数 value 是否满足条件 cond = { type, value? }
  // 注：sum（累计槽）对单个骰子总是「可放入」，是否触发由 core 的累计进度决定。
  function checkCondition(cond, value) {
    if (!cond) return true;
    switch (cond.type) {
      case "any":   return true;
      case "even":  return value % 2 === 0;
      case "odd":   return value % 2 === 1;
      case "max":   return value <= cond.value;       // 只能放入 ≤ value 的骰子
      case "min":   return value >= cond.value;       // 只能放入 ≥ value 的骰子
      case "exact": return value === cond.value;       // 只能放入指定点数
      case "sum":   return true;                        // 累计槽：任意骰子皆可投入累加
      default:      return false;
    }
  }

  // 条件的简短文字（用于装备槽显示）
  function describeCondition(cond) {
    if (!cond) return "任意";
    switch (cond.type) {
      case "any":   return "任意";
      case "even":  return "偶数";
      case "odd":   return "奇数";
      case "max":   return "≤" + cond.value;
      case "min":   return "≥" + cond.value;
      case "exact": return "=" + cond.value;
      case "sum":   return "累计" + cond.value;
      default:      return "?";
    }
  }

  // 条件难度系数（仅用于平衡参考 / 商店定价，可选）
  function conditionMult(cond) {
    if (!cond) return 1;
    switch (cond.type) {
      case "any":   return 1.0;
      case "even":
      case "odd":   return 1.2;
      case "max":   return 1.1;
      case "min":   return 1.2;
      case "exact": return 1.8;
      case "sum":   return 2.0;
      default:      return 1;
    }
  }

  // ---------- 效果数值解析 ----------
  // spec 取值：数字（固定值）/ "dice"（等于骰子点数）/ "dice+N" / "dice-N"
  function resolveValue(spec, dieValue) {
    if (typeof spec === "number") return spec;
    if (typeof spec === "string") {
      if (spec === "dice") return dieValue;
      const m = spec.match(/^dice([+\-]\d+)$/);
      if (m) return Math.max(0, dieValue + parseInt(m[1], 10));
    }
    return 0;
  }

  // 效果数值的文字（用于描述：把 "dice+2" 写成 "点数+2"）
  function describeValue(spec) {
    if (typeof spec === "number") return String(spec);
    if (spec === "dice") return "点数";
    if (typeof spec === "string") {
      const m = spec.match(/^dice([+\-]\d+)$/);
      if (m) return "点数" + m[1];
    }
    return String(spec);
  }

  // 单条效果的文字描述
  const EFFECT_VERB = {
    damage: { verb: "造成", unit: "伤害" },
    shield: { verb: "获得", unit: "护盾" },
    heal:   { verb: "回复", unit: "生命" },
    poison: { verb: "施加", unit: "中毒" },
    burn:   { verb: "施加", unit: "燃烧" },
    freeze: { verb: "施加", unit: "冰冻" },
    weak:   { verb: "施加", unit: "虚弱" },
    thorns: { verb: "获得", unit: "荆棘" },
    vuln:   { verb: "施加", unit: "易伤" },
  };

  // 骰子改造操作（modify）：作用于「本回合其余未使用的骰子」
  const MODIFY_OP = {
    plus:   { label: "全部 +1", apply: (v) => Math.min(DICE.MAX, v + 1) },
    minus:  { label: "全部 -1", apply: (v) => Math.max(DICE.MIN, v - 1) },
    flip:   { label: "全部翻面", apply: (v) => DICE.FLIP_BASE - v },
    reroll: { label: "全部重掷", apply: null /* core 用 rng 处理 */ },
  };
  function describeEffect(eff) {
    if (eff.type === "modify") {
      const op = MODIFY_OP[eff.op];
      return op ? `其余骰子${op.label}` : "改造骰子";
    }
    if (eff.type === "cleanse") return "净化一个负面状态";
    if (eff.type === "damage") {
      const times = eff.times && eff.times > 1 ? `${eff.times} 次 ` : "";
      const pierce = eff.pierce ? "穿透" : "";
      return `造成 ${times}${describeValue(eff.value)} 点${pierce}伤害`;
    }
    const v = EFFECT_VERB[eff.type] || { verb: "", unit: eff.type };
    return `${v.verb} ${describeValue(eff.value)} ${v.unit}`;
  }
  // 装备完整描述："偶数 → 造成 点数+2 伤害；施加 2 中毒"
  function describeEquipment(eq) {
    if (eq.desc) return eq.desc;
    const head = describeCondition(eq.condition);
    const body = (eq.effects || []).map(describeEffect).join("；");
    return `${head} → ${body}`;
  }

  // 效果默认作用目标：进攻类→对手，增益/自我类→自己
  function effectTarget(eff) {
    if (eff.target) return eff.target;
    return (eff.type === "shield" || eff.type === "heal" || eff.type === "thorns" ||
            eff.type === "modify" || eff.type === "cleanse")
      ? "self" : "enemy";
  }

  // ============================================================
  // 装备池（玩家可获得 / 商店出售）
  //   id          唯一标识
  //   name/icon   显示
  //   size        占用装备栏格数
  //   usesPerTurn 每回合可触发次数
  //   condition   骰子条件
  //   effects     效果数组（按顺序结算）
  //   price       商店价格
  //   rarity      common / rare / epic
  //   upgradeId   升级后的装备 id（铁匠/商店升级用）
  //   tags        流派标签
  // ============================================================
  const EQUIPMENT_POOL = [
    // —— 基础攻击 ——
    { id: "shortsword", name: "短剑", icon: "🗡️", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "any" }, effects: [{ type: "damage", value: "dice" }],
      price: 4, tags: ["attack"], upgradeId: "shortsword_plus" },
    { id: "shortsword_plus", name: "精钢短剑", icon: "🗡️", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "damage", value: "dice+2" }],
      price: 7, tags: ["attack"] },

    { id: "dagger", name: "匕首", icon: "🔪", size: 1, usesPerTurn: 2, rarity: "common",
      condition: { type: "max", value: 3 }, effects: [{ type: "damage", value: "dice+1" }],
      price: 5, tags: ["attack"], upgradeId: "dagger_plus" },
    { id: "dagger_plus", name: "淬毒匕首", icon: "🔪", size: 1, usesPerTurn: 2, rarity: "rare",
      condition: { type: "max", value: 3 }, effects: [{ type: "damage", value: "dice+1" }, { type: "poison", value: 1 }],
      price: 8, tags: ["attack", "poison"] },

    { id: "handaxe", name: "手斧", icon: "🪓", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "odd" }, effects: [{ type: "damage", value: "dice+2" }],
      price: 5, tags: ["attack"] },
    { id: "mace", name: "钉锤", icon: "🔨", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "even" }, effects: [{ type: "damage", value: "dice+2" }],
      price: 5, tags: ["attack"] },

    { id: "greatsword", name: "巨剑", icon: "⚔️", size: 2, usesPerTurn: 1, rarity: "rare",
      condition: { type: "min", value: 4 }, effects: [{ type: "damage", value: "dice+4" }],
      price: 8, tags: ["attack"] },
    { id: "warhammer", name: "战锤", icon: "🔨", size: 2, usesPerTurn: 1, rarity: "epic",
      condition: { type: "exact", value: 6 }, effects: [{ type: "damage", value: 14 }],
      price: 9, tags: ["attack"] },
    { id: "throwing_knives", name: "飞刀", icon: "🎯", size: 2, usesPerTurn: 3, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "damage", value: 3 }],
      price: 8, tags: ["attack"] },

    // —— 进阶攻击：穿透 / 多段 / 易伤（文档 §22.2.1） ——
    { id: "estoc", name: "穿甲刺", icon: "🩸", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "min", value: 4 }, effects: [{ type: "damage", value: "dice", pierce: true }],
      price: 7, tags: ["attack"] },
    { id: "twin_claw", name: "双爪", icon: "🐾", size: 2, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "damage", value: "dice", times: 2 }],
      price: 8, tags: ["attack"] },
    { id: "hunters_mark", name: "猎人标记", icon: "🎯", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "odd" }, effects: [{ type: "vuln", value: 2 }, { type: "damage", value: 2 }],
      price: 6, tags: ["attack"] },

    // —— 防御 / 治疗 ——
    { id: "buckler", name: "圆盾", icon: "🛡️", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "any" }, effects: [{ type: "shield", value: "dice" }],
      price: 4, tags: ["defense"], upgradeId: "buckler_plus" },
    { id: "buckler_plus", name: "塔盾", icon: "🛡️", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "shield", value: "dice+2" }],
      price: 7, tags: ["defense"] },
    { id: "spiked_shield", name: "荆棘盾", icon: "🛡️", size: 2, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "shield", value: "dice" }, { type: "thorns", value: 2 }, { type: "damage", value: 1 }],
      price: 7, tags: ["defense"] },
    { id: "bandage", name: "绷带", icon: "🩹", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "max", value: 3 }, effects: [{ type: "heal", value: "dice+2" }],
      price: 5, tags: ["heal"] },
    { id: "thorn_vest", name: "棘刺甲", icon: "🌵", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "odd" }, effects: [{ type: "thorns", value: 3 }],
      price: 6, tags: ["defense"], weight: 0.6 },
    { id: "purify_bell", name: "净化铃", icon: "🔔", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "max", value: 3 }, effects: [{ type: "cleanse", value: 1 }, { type: "shield", value: "dice" }],
      price: 6, tags: ["defense"], weight: 0.7 },

    // —— 骰子改造（不直接造成伤害，而是改善其余骰子的质量；技巧向，降低出现权重避免污染随机池） ——
    { id: "whetstone", name: "磨刀石", icon: "🪨", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "max", value: 3 }, effects: [{ type: "modify", op: "plus" }],
      price: 5, tags: ["utility"], weight: 0.5 },
    { id: "mirror", name: "镜面符", icon: "🪞", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "min", value: 5 }, effects: [{ type: "modify", op: "flip" }],
      price: 6, tags: ["utility"], weight: 0.5 },
    { id: "dice_cup", name: "骰盅", icon: "🎰", size: 2, usesPerTurn: 1, rarity: "rare",
      condition: { type: "max", value: 2 }, effects: [{ type: "modify", op: "reroll" }],
      price: 7, tags: ["utility"], weight: 0.5 },

    // —— 累计槽：多次投入骰子，总和达阈值后造成大额伤害 ——
    { id: "charge_cannon", name: "蓄能炮", icon: "💣", size: 2, usesPerTurn: 3, rarity: "epic",
      condition: { type: "sum", value: 8 }, effects: [{ type: "damage", value: 15 }],
      price: 9, tags: ["attack"], weight: 0.5 },

    // —— 状态流派 ——
    { id: "poison_vial", name: "毒瓶", icon: "🧪", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "any" }, effects: [{ type: "poison", value: 3 }],
      price: 5, tags: ["poison"], upgradeId: "poison_vial_plus" },
    { id: "poison_vial_plus", name: "剧毒之瓶", icon: "🧪", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "poison", value: 5 }],
      price: 8, tags: ["poison"] },
    { id: "fire_wand", name: "火杖", icon: "🔥", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "min", value: 3 }, effects: [{ type: "burn", value: "dice" }],
      price: 7, tags: ["fire"] },
    { id: "frost_staff", name: "霜杖", icon: "❄️", size: 2, usesPerTurn: 1, rarity: "rare",
      condition: { type: "even" }, effects: [{ type: "freeze", value: 1 }, { type: "damage", value: 2 }],
      price: 7, tags: ["ice"] },
    { id: "lightning_rod", name: "电杖", icon: "⚡", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "odd" }, effects: [{ type: "weak", value: 2 }, { type: "damage", value: "dice" }],
      price: 7, tags: ["electric"] },
  ];

  // 只在「奖励 / 商店」里出现的装备（排除升级专属版本，避免直接刷到强化版）
  const REWARD_EQUIPMENT = EQUIPMENT_POOL.filter((e) => !/_plus$/.test(e.id));

  function findEquipment(id) {
    return EQUIPMENT_POOL.find((e) => e.id === id) || null;
  }

  // ============================================================
  // 敌人池
  //   敌人的 equipment 直接内联（可拥有玩家池中没有的专属技能）
  //   ai：评分权重模型用的性格（aggressive / balanced / defensive）
  // ============================================================
  const ENEMY_POOL = [
    { id: "slime", name: "史莱姆", icon: "🟢", maxHp: 15, diceCount: 2, ai: "aggressive",
      rewardGold: 4, rewardXp: 2, tags: ["basic"],
      equipment: [{ id: "claw", name: "撞击", icon: "💥", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice" }] }] },

    { id: "bat", name: "暗夜蝙蝠", icon: "🦇", maxHp: 13, diceCount: 2, ai: "aggressive",
      rewardGold: 4, rewardXp: 2, tags: ["basic"],
      equipment: [{ id: "bite", name: "撕咬", icon: "🦷", usesPerTurn: 2, condition: { type: "max", value: 3 }, effects: [{ type: "damage", value: "dice" }] }] },

    { id: "spider", name: "毒蛛", icon: "🕷️", maxHp: 17, diceCount: 2, ai: "balanced",
      rewardGold: 5, rewardXp: 2, tags: ["poison"],
      equipment: [
        { id: "fang", name: "尖牙", icon: "🦷", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: 2 }] },
        { id: "venom", name: "吐毒", icon: "🧪", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "poison", value: 2 }] },
      ] },

    { id: "goblin", name: "哥布林", icon: "👺", maxHp: 19, diceCount: 2, ai: "aggressive",
      rewardGold: 5, rewardXp: 3, tags: ["basic"],
      equipment: [{ id: "stab", name: "突刺", icon: "🗡️", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice+1" }] }] },

    { id: "skeleton", name: "骷髅战士", icon: "💀", maxHp: 19, diceCount: 2, ai: "balanced",
      rewardGold: 5, rewardXp: 3, tags: ["defense"],
      equipment: [
        { id: "slash", name: "挥砍", icon: "🗡️", usesPerTurn: 1, condition: { type: "odd" }, effects: [{ type: "damage", value: "dice+2" }] },
        { id: "boneguard", name: "骨盾", icon: "🛡️", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "shield", value: "dice" }] },
      ] },

    { id: "imp", name: "炎魔小鬼", icon: "👹", maxHp: 18, diceCount: 2, ai: "aggressive",
      rewardGold: 6, rewardXp: 3, tags: ["fire"],
      equipment: [{ id: "fireball", name: "火球", icon: "🔥", usesPerTurn: 1, condition: { type: "min", value: 3 }, effects: [{ type: "burn", value: "dice" }] }] },

    { id: "frost_wisp", name: "霜灵", icon: "🧊", maxHp: 20, diceCount: 2, ai: "balanced",
      rewardGold: 6, rewardXp: 3, tags: ["ice"],
      equipment: [{ id: "chill", name: "寒霜", icon: "❄️", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "freeze", value: 1 }, { type: "damage", value: 2 }] }] },

    // —— 精英 ——
    { id: "ogre", name: "食人魔", icon: "👿", maxHp: 32, diceCount: 3, ai: "aggressive", elite: true,
      rewardGold: 10, rewardXp: 5, tags: ["elite"],
      equipment: [
        { id: "club", name: "巨棒", icon: "🏏", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice+2" }] },
        { id: "smash", name: "重砸", icon: "💥", usesPerTurn: 1, condition: { type: "exact", value: 6 }, effects: [{ type: "damage", value: 10 }] },
      ] },

    { id: "cursed_knight", name: "诅咒骑士", icon: "🐲", maxHp: 30, diceCount: 3, ai: "balanced", elite: true,
      rewardGold: 10, rewardXp: 5, tags: ["elite"],
      equipment: [
        { id: "darkblade", name: "暗影斩", icon: "🗡️", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice+1" }] },
        { id: "curse", name: "诅咒", icon: "💀", usesPerTurn: 1, condition: { type: "min", value: 4 }, effects: [{ type: "weak", value: 2 }, { type: "damage", value: 3 }] },
        { id: "guard", name: "守势", icon: "🛡️", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "shield", value: "dice" }] },
      ] },

    // —— Boss ——
    { id: "dungeon_lord", name: "地牢领主", icon: "🐉", maxHp: 44, diceCount: 3, ai: "balanced", boss: true,
      rewardGold: 20, rewardXp: 8, tags: ["boss"],
      equipment: [
        { id: "doomstrike", name: "末日斩", icon: "⚔️", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice+1" }] },
        { id: "venomspit", name: "毒息", icon: "🧪", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "poison", value: 3 }] },
        { id: "quake", name: "震地", icon: "💥", usesPerTurn: 1, condition: { type: "exact", value: 6 }, effects: [{ type: "damage", value: 8 }] },
        { id: "mend", name: "自愈", icon: "💚", usesPerTurn: 1, condition: { type: "max", value: 2 }, effects: [{ type: "heal", value: "dice+1" }] },
      ] },
  ];

  function findEnemy(id) {
    return ENEMY_POOL.find((e) => e.id === id) || null;
  }

  // ============================================================
  // 事件池（文档 §24）
  //   每个事件提供若干 choices；选项含 cost（消耗）与 reward（收益），
  //   全部为可序列化的语义化指令，由 core.resolveEvent 解释执行。
  //   cost / reward 支持的键：
  //     hp:数值        生命变化（cost 为扣除，reward 为回复；负数亦可）
  //     maxHp:数值     最大生命提升
  //     gold:数值      金币变化
  //     upgradeRandom  随机升级一件可升级装备
  //     randomEquip    随机获得一件装备（满则进入替换/丢弃）
  //     rewardChoice   打开一次三选一装备奖励（可带 tag 过滤构筑方向）
  //     cleanseAll     清除自身全部负面状态（局外无意义，预留）
  //     chance         概率分支：[{ weight, reward }]
  //   requires：选项可用前置条件（minGold / minHp / hasUpgradable）
  // ============================================================
  const EVENTS = [
    {
      id: "dice_altar", name: "神秘骰坛", icon: "🎲",
      desc: "一座刻满点数符号的石坛静静发光，似乎在等待献祭。",
      choices: [
        { text: "献祭 4 点生命，升级一件随机装备", cost: { hp: 4 }, reward: { upgradeRandom: 1 }, requires: { minHp: 5, hasUpgradable: true } },
        { text: "投入 3 金币，获得一件随机装备", cost: { gold: 3 }, reward: { randomEquip: 1 }, requires: { minGold: 3 } },
        { text: "凝视坛心，恢复 6 点生命", cost: {}, reward: { hp: 6 } },
        { text: "敬而远之，离开", cost: {}, reward: {} },
      ],
    },
    {
      id: "broken_forge", name: "破损铁匠铺", icon: "🔥",
      desc: "炉火尚未熄灭，但工具已经生锈。也许还能再打一件兵器。",
      choices: [
        { text: "支付 6 金币，升级一件随机装备", cost: { gold: 6 }, reward: { upgradeRandom: 1 }, requires: { minGold: 6, hasUpgradable: true } },
        { text: "强行使用炉火：一半概率升级装备，一半概率受到 5 点伤害", cost: {},
          reward: { chance: [{ weight: 50, reward: { upgradeRandom: 1 } }, { weight: 50, reward: { hp: -5 } }] }, requires: { hasUpgradable: true } },
        { text: "翻找废料，得到 5 金币", cost: {}, reward: { gold: 5 } },
        { text: "离开", cost: {}, reward: {} },
      ],
    },
    {
      id: "wandering_merchant", name: "流浪商人", icon: "🧙",
      desc: "一个裹着斗篷的商人从阴影里探出头：「想做笔买卖吗？」",
      choices: [
        { text: "花 4 金币，从三件装备里挑一件", cost: { gold: 4 }, reward: { rewardChoice: { source: "event" } }, requires: { minGold: 4 } },
        { text: "用 8 点生命换取 8 金币", cost: { hp: 8 }, reward: { gold: 8 }, requires: { minHp: 9 } },
        { text: "婉拒离开", cost: {}, reward: {} },
      ],
    },
    {
      id: "twin_shrine", name: "双生神龛", icon: "⚖️",
      desc: "两座神龛分立两侧，一座象征力量，一座象征坚韧。只能选其一。",
      choices: [
        { text: "力量之龛：最大生命 +2，并获得一件攻击装备", cost: {}, reward: { maxHp: 2, rewardChoice: { source: "event", tag: "attack" } } },
        { text: "坚韧之龛：立即回复至满血", cost: {}, reward: { fullHeal: 1 } },
        { text: "两手空空地离开", cost: {}, reward: {} },
      ],
    },
  ];

  function findEvent(id) {
    return EVENTS.find((e) => e.id === id) || null;
  }

  // ============================================================
  // 角色定义（MVP 单角色：战士）
  // ============================================================
  const CHARACTER = {
    id: "warrior",
    name: "战士",
    icon: "🛡️",
    maxHp: 30,
    diceCount: 3,
    capacity: 5,               // 装备栏容量（格数）
    startEquipment: ["shortsword", "buckler", "handaxe"],
    limitBreak: { name: "狂战重掷", desc: "立即重掷当前所有未使用的骰子", chargeMax: 6 },
  };

  // ---------- 成长表（累计 XP 达到 need 即升级，奖励自动结算） ----------
  // 一局需跨越多章节，敌人随章节持续增强，因此成长表延伸至 10 级，
  // 让玩家在第 2、3 章仍能稳定变强，避免「停止成长却面对更强敌人」。
  const LEVELS = [
    { level: 2,  need: 3,  maxHp: 4 },
    { level: 3,  need: 7,  maxHp: 4, dice: 1 },
    { level: 4,  need: 12, maxHp: 5 },
    { level: 5,  need: 18, maxHp: 5, capacity: 1 },
    { level: 6,  need: 25, maxHp: 6, dice: 1 },
    { level: 7,  need: 33, maxHp: 6 },
    { level: 8,  need: 42, maxHp: 6, dice: 1 },
    { level: 9,  need: 52, maxHp: 7, capacity: 1 },
    { level: 10, need: 64, maxHp: 8, dice: 1 },
  ];

  // ============================================================
  // 章节（多章节地牢，文档 §10 / §14）
  //   一局由多个章节串联，每章是一个独立的 6 层地牢，击败本章 Boss 后
  //   深入下一章。越深的章节敌人血量更厚、伤害更高（hpScale / dmgScale），
  //   Boss 也换上更具压迫感的名号与形象。章节间会回复部分生命作为喘息。
  // ============================================================
  const CHAPTERS = [
    { name: "腐朽地窖", icon: "🕯️", hpScale: 1.0,  dmgScale: 1.0,  bossName: "地牢守卫", bossIcon: "🗿" },
    { name: "熔火回廊", icon: "🔥", hpScale: 1.3,  dmgScale: 1.18, bossName: "炼狱魔将", bossIcon: "👹" },
    { name: "王座深渊", icon: "👑", hpScale: 1.65, dmgScale: 1.38, bossName: "地牢领主", bossIcon: "🐉" },
  ];

  // ============================================================
  // 导出（浏览器挂 window.DiceData；Node 可 require）
  // ============================================================
  const exported = {
    DICE, STATUSES, MODIFY_OP,
    rollDie,
    checkCondition, describeCondition, conditionMult,
    resolveValue, describeValue, describeEffect, describeEquipment, effectTarget,
    EQUIPMENT_POOL, REWARD_EQUIPMENT, findEquipment,
    ENEMY_POOL, findEnemy,
    EVENTS, findEvent,
    CHARACTER, LEVELS, CHAPTERS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  const g = (typeof globalThis !== "undefined") ? globalThis
          : (typeof window !== "undefined") ? window : null;
  if (g) g.DiceData = exported;
})();
