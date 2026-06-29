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
    shield: { key: "shield", name: "护盾", icon: "🛡", color: "#cfd8dc", desc: "抵消等量伤害，自己回合开始时清空" },
  };

  // ---------- 骰子条件 ----------
  // 判定一个点数 value 是否满足条件 cond = { type, value? }
  function checkCondition(cond, value) {
    if (!cond) return true;
    switch (cond.type) {
      case "any":   return true;
      case "even":  return value % 2 === 0;
      case "odd":   return value % 2 === 1;
      case "max":   return value <= cond.value;       // 只能放入 ≤ value 的骰子
      case "min":   return value >= cond.value;       // 只能放入 ≥ value 的骰子
      case "exact": return value === cond.value;       // 只能放入指定点数
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
  };
  function describeEffect(eff) {
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

  // 效果默认作用目标：进攻类→对手，增益类→自己
  function effectTarget(eff) {
    if (eff.target) return eff.target;
    return (eff.type === "shield" || eff.type === "heal") ? "self" : "enemy";
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

    // —— 防御 / 治疗 ——
    { id: "buckler", name: "圆盾", icon: "🛡️", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "any" }, effects: [{ type: "shield", value: "dice" }],
      price: 4, tags: ["defense"], upgradeId: "buckler_plus" },
    { id: "buckler_plus", name: "塔盾", icon: "🛡️", size: 1, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "shield", value: "dice+2" }],
      price: 7, tags: ["defense"] },
    { id: "spiked_shield", name: "荆棘盾", icon: "🛡️", size: 2, usesPerTurn: 1, rarity: "rare",
      condition: { type: "any" }, effects: [{ type: "shield", value: "dice" }, { type: "damage", value: 2 }],
      price: 7, tags: ["defense", "attack"] },
    { id: "bandage", name: "绷带", icon: "🩹", size: 1, usesPerTurn: 1, rarity: "common",
      condition: { type: "max", value: 3 }, effects: [{ type: "heal", value: "dice+2" }],
      price: 5, tags: ["heal"] },

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
    { id: "slime", name: "史莱姆", icon: "🟢", maxHp: 12, diceCount: 2, ai: "aggressive",
      rewardGold: 4, rewardXp: 2, tags: ["basic"],
      equipment: [{ id: "claw", name: "撞击", icon: "💥", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice" }] }] },

    { id: "bat", name: "暗夜蝙蝠", icon: "🦇", maxHp: 10, diceCount: 2, ai: "aggressive",
      rewardGold: 4, rewardXp: 2, tags: ["basic"],
      equipment: [{ id: "bite", name: "撕咬", icon: "🦷", usesPerTurn: 2, condition: { type: "max", value: 3 }, effects: [{ type: "damage", value: "dice" }] }] },

    { id: "spider", name: "毒蛛", icon: "🕷️", maxHp: 14, diceCount: 2, ai: "balanced",
      rewardGold: 5, rewardXp: 2, tags: ["poison"],
      equipment: [
        { id: "fang", name: "尖牙", icon: "🦷", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: 2 }] },
        { id: "venom", name: "吐毒", icon: "🧪", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "poison", value: 2 }] },
      ] },

    { id: "goblin", name: "哥布林", icon: "👺", maxHp: 16, diceCount: 2, ai: "aggressive",
      rewardGold: 5, rewardXp: 3, tags: ["basic"],
      equipment: [{ id: "stab", name: "突刺", icon: "🗡️", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice+1" }] }] },

    { id: "skeleton", name: "骷髅战士", icon: "💀", maxHp: 16, diceCount: 2, ai: "balanced",
      rewardGold: 5, rewardXp: 3, tags: ["defense"],
      equipment: [
        { id: "slash", name: "挥砍", icon: "🗡️", usesPerTurn: 1, condition: { type: "odd" }, effects: [{ type: "damage", value: "dice+2" }] },
        { id: "boneguard", name: "骨盾", icon: "🛡️", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "shield", value: "dice" }] },
      ] },

    { id: "imp", name: "炎魔小鬼", icon: "👹", maxHp: 15, diceCount: 2, ai: "aggressive",
      rewardGold: 6, rewardXp: 3, tags: ["fire"],
      equipment: [{ id: "fireball", name: "火球", icon: "🔥", usesPerTurn: 1, condition: { type: "min", value: 3 }, effects: [{ type: "burn", value: "dice" }] }] },

    { id: "frost_wisp", name: "霜灵", icon: "🧊", maxHp: 17, diceCount: 2, ai: "balanced",
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
    { id: "dungeon_lord", name: "地牢领主", icon: "🐉", maxHp: 56, diceCount: 3, ai: "balanced", boss: true,
      rewardGold: 20, rewardXp: 8, tags: ["boss"],
      equipment: [
        { id: "doomstrike", name: "末日斩", icon: "⚔️", usesPerTurn: 1, condition: { type: "any" }, effects: [{ type: "damage", value: "dice+2" }] },
        { id: "venomspit", name: "毒息", icon: "🧪", usesPerTurn: 1, condition: { type: "even" }, effects: [{ type: "poison", value: 3 }] },
        { id: "quake", name: "震地", icon: "💥", usesPerTurn: 1, condition: { type: "exact", value: 6 }, effects: [{ type: "damage", value: 10 }] },
        { id: "mend", name: "自愈", icon: "💚", usesPerTurn: 1, condition: { type: "max", value: 2 }, effects: [{ type: "heal", value: "dice+1" }] },
      ] },
  ];

  function findEnemy(id) {
    return ENEMY_POOL.find((e) => e.id === id) || null;
  }

  // ============================================================
  // 角色定义（MVP 单角色：战士）
  // ============================================================
  const CHARACTER = {
    id: "warrior",
    name: "战士",
    icon: "🛡️",
    maxHp: 26,
    diceCount: 3,
    capacity: 5,               // 装备栏容量（格数）
    startEquipment: ["shortsword", "buckler", "handaxe"],
    limitBreak: { name: "狂战重掷", desc: "立即重掷当前所有未使用的骰子", chargeMax: 8 },
  };

  // ---------- 成长表（累计 XP 达到 need 即升级，奖励自动结算） ----------
  const LEVELS = [
    { level: 2, need: 3,  maxHp: 4 },
    { level: 3, need: 7,  maxHp: 4, dice: 1 },
    { level: 4, need: 12, maxHp: 5 },
    { level: 5, need: 18, maxHp: 5, capacity: 1 },
    { level: 6, need: 25, maxHp: 6, dice: 1 },
  ];

  // ============================================================
  // 导出（浏览器挂 window.DiceData；Node 可 require）
  // ============================================================
  const exported = {
    DICE, STATUSES,
    rollDie,
    checkCondition, describeCondition, conditionMult,
    resolveValue, describeValue, describeEffect, describeEquipment, effectTarget,
    EQUIPMENT_POOL, REWARD_EQUIPMENT, findEquipment,
    ENEMY_POOL, findEnemy,
    CHARACTER, LEVELS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  const g = (typeof globalThis !== "undefined") ? globalThis
          : (typeof window !== "undefined") ? window : null;
  if (g) g.DiceData = exported;
})();
