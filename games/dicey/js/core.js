/* ============================================================
 * core.js —— 骰子地下城·逻辑层（GameCore）
 *
 * 纯游戏状态与规则，不依赖任何 DOM / 浏览器 API。
 * 与外界仅通过三类接口交互（README 的「逻辑/表现分离」约定）：
 *   1. 事件广播：on(evt, fn) 订阅，内部 emit 推送状态变化与演出节点
 *   2. 只读查询：getState() 返回可序列化快照
 *   3. 操作方法：newGame / chooseNode / assignDie / endTurn / buy …
 *
 * 因此本层既能在浏览器随 <script> 加载，也能在 Node 命令行 require
 * 后用一个自动决策器（cli.js）独立跑通整局，验证逻辑可脱离表现层。
 * ============================================================ */
(function () {
  "use strict";

  // ---- 依赖解析：浏览器取全局，Node 命令行用 require ----
  const __root = (typeof globalThis !== "undefined") ? globalThis
               : (typeof window !== "undefined") ? window : {};
  const __req = (typeof require !== "undefined") ? require : null;
  const Data = __root.DiceData || (__req && __req("./data.js"));

  const {
    STATUSES, rollDie, checkCondition, resolveValue, effectTarget,
    REWARD_EQUIPMENT, findEquipment, findEnemy, findEvent, CHARACTER, LEVELS, CHAPTERS,
  } = Data;

  // ---- 存储抽象：仅浏览器启用 localStorage；命令行下安全降级为 null ----
  const __storage = (typeof window !== "undefined" && window.localStorage) ? window.localStorage : null;
  const SAVE_KEY = "funnybuddy_dicey";

  // ---------- 规则常量 ----------
  const CONFIG = {
    MAP_ROWS: 6,            // 地牢层数（含 Boss 层）
    CHOICES_PER_ROW: 3,     // 每层提供的节点选择数
    REWARD_CHOICES: 3,      // 战斗后三选一装备
    SHOP_EQUIP_COUNT: 3,    // 商店每次上架装备数
    REROLL_COST: 4,         // 商店刷新价
    HEAL_NODE_AMOUNT: 13,   // 营火治疗量
    SHOP_HEAL_COST: 5,      // 商店购买治疗价
    SHOP_HEAL_AMOUNT: 10,
    UPGRADE_COST: 6,        // 商店升级装备价
    SELL_RATIO: 0.5,        // 卖出回收比例
  };

  let __idSeq = 1;
  const uid = (p) => p + (__idSeq++);

  // ---------- 极简事件发射器 ----------
  class Emitter {
    constructor() { this._handlers = {}; }
    on(event, fn) { (this._handlers[event] = this._handlers[event] || []).push(fn); return this; }
    emit(event, payload) { (this._handlers[event] || []).forEach((fn) => fn(payload)); }
  }

  // ============================================================
  // GameCore
  // ============================================================
  class GameCore extends Emitter {
    constructor(opts) {
      super();
      opts = opts || {};
      this.CONFIG = CONFIG;
      // 注入随机源，便于命令行/测试复现（默认 Math.random）
      this._rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    }

    rnd() { return this._rng(); }
    _rollDie() { return rollDie(this._rng); }
    _pick(arr) { return arr[Math.floor(this._rng() * arr.length)]; }
    _shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this._rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    // 按 weight 不放回地加权抽取 n 件（默认权重 1）。用于奖励/商店，
    // 让技巧向工具装备出现频率更低，避免污染随机池（文档 §24.2）。
    _pickWeighted(pool, n) {
      const items = pool.slice();
      const out = [];
      while (out.length < n && items.length) {
        let total = 0;
        items.forEach((it) => (total += it.weight != null ? it.weight : 1));
        let r = this._rng() * total;
        let idx = 0;
        for (; idx < items.length; idx++) {
          r -= items[idx].weight != null ? items[idx].weight : 1;
          if (r <= 0) break;
        }
        if (idx >= items.length) idx = items.length - 1;
        out.push(items.splice(idx, 1)[0]);
      }
      return out;
    }

    emit(event, payload) {
      super.emit(event, payload);
      if (event === "change") this.save();
      if (event === "gameWin" || event === "gameLose") this.clearSave();
    }
    _log(text, type = "info") { this.emit("log", { text, type }); }

    // ============================================================
    // 生命周期
    // ============================================================
    newGame() {
      const c = CHARACTER;
      this.player = {
        id: c.id, name: c.name, icon: c.icon,
        maxHp: c.maxHp, hp: c.maxHp,
        diceCount: c.diceCount, capacity: c.capacity,
        level: 1, xp: 0, gold: 8,
        equipment: c.startEquipment.map((id) => this._makeEquipInstance(findEquipment(id))),
        limit: { name: c.limitBreak.name, desc: c.limitBreak.desc, charge: 0, chargeMax: c.limitBreak.chargeMax },
      };
      this.battle = null;
      this.shop = null;
      this.reward = null;
      this.event = null; this._eventDef = null;
      this.chapter = 1;            // 当前章节（多章节地牢，1 起算）
      this.phase = "map";          // map | battle | reward | shop | event | gameover
      this._buildMap();
      this.clearSave();
      this._log("🗺️ 踏入地牢，祝你好运！", "good");
      this.emit("change");
    }

    // 把装备定义实例化（携带战斗内的可变字段 usesLeft / 累计槽进度 / 实例 id）
    _makeEquipInstance(def) {
      return Object.assign({}, def, { instId: uid("eq"), usesLeft: def.usesPerTurn, sumProgress: 0 });
    }

    // 当前章节配置（越界时安全回退到末章）
    _chapter() {
      const i = Math.min(Math.max((this.chapter || 1) - 1, 0), CHAPTERS.length - 1);
      return CHAPTERS[i];
    }

    // ---------- 地图 ----------
    _buildMap() {
      const rows = [];
      const types = ["battle", "battle", "elite", "treasure", "shop", "heal", "event"];
      for (let r = 0; r < CONFIG.MAP_ROWS; r++) {
        if (r === 0) {
          // 首层：固定一场普通战斗，作为教学
          rows.push([this._makeNode("battle")]);
        } else if (r === CONFIG.MAP_ROWS - 1) {
          rows.push([this._makeNode("boss")]);
        } else {
          const n = CONFIG.CHOICES_PER_ROW;
          const picks = [];
          // 保证每层至少有一个战斗类节点，其余随机
          picks.push(this._makeNode(this.rnd() < 0.35 ? "elite" : "battle"));
          const pool = this._shuffle(types);
          let i = 0;
          while (picks.length < n) {
            const t = pool[i++ % pool.length];
            picks.push(this._makeNode(t));
          }
          rows.push(this._shuffle(picks));
        }
      }
      this.map = { rows, rowIndex: 0, cleared: false, path: [] };
    }

    _makeNode(type) {
      const node = { id: uid("nd"), type };
      if (type === "battle") {
        const pool = Data.ENEMY_POOL.filter((e) => !e.elite && !e.boss);
        node.enemyId = this._pick(pool).id;
      } else if (type === "elite") {
        const pool = Data.ENEMY_POOL.filter((e) => e.elite);
        node.enemyId = this._pick(pool).id;
      } else if (type === "boss") {
        node.enemyId = Data.ENEMY_POOL.find((e) => e.boss).id;
      } else if (type === "event") {
        node.eventId = this._pick(Data.EVENTS).id;
      }
      return node;
    }

    nodeMeta(type) {
      return ({
        battle:   { icon: "⚔️", label: "战斗" },
        elite:    { icon: "💀", label: "精英" },
        treasure: { icon: "🎁", label: "宝箱" },
        shop:     { icon: "🛒", label: "商店" },
        heal:     { icon: "🔥", label: "营火" },
        event:    { icon: "❔", label: "事件" },
        boss:     { icon: "🐉", label: "Boss" },
      })[type] || { icon: "❓", label: "未知" };
    }

    // 玩家在当前层选择一个节点
    chooseNode(nodeId) {
      if (this.phase !== "map" || !this.map) return { ok: false };
      const row = this.map.rows[this.map.rowIndex];
      const node = row.find((n) => n.id === nodeId);
      if (!node) return { ok: false };
      this._currentNode = node;
      // 记录玩家在本层选择的节点，用于在路线图上回溯已走过的路径
      if (!this.map.path) this.map.path = [];
      this.map.path[this.map.rowIndex] = node.id;
      switch (node.type) {
        case "battle":
        case "elite":
        case "boss":
          this._startBattle(findEnemy(node.enemyId), node.type);
          break;
        case "treasure":
          this._log("🎁 你打开了一个宝箱", "good");
          this._offerReward("treasure");
          break;
        case "shop":
          this._openShop();
          break;
        case "event":
          this._openEvent(findEvent(node.eventId));
          break;
        case "heal": {
          const amt = Math.min(CONFIG.HEAL_NODE_AMOUNT, this.player.maxHp - this.player.hp);
          this.player.hp += amt;
          this._log(`🔥 在营火旁休整，回复 ${amt} 点生命`, "good");
          this.emit("heal", { target: "player", amount: amt });
          this._advanceMap();
          break;
        }
        default:
          this._advanceMap();
      }
      return { ok: true };
    }

    // 节点结算完毕，推进到下一层；走完一章则进入下一章，最终章 Boss 后才通关
    _advanceMap() {
      this.map.rowIndex++;
      this._currentNode = null;
      if (this.map.rowIndex >= this.map.rows.length) {
        // —— 本章已通关（刚击败本章 Boss）——
        if (this.chapter < CHAPTERS.length) {
          this.chapter++;
          // 进入更深章节：回复约三成生命作为喘息，并重建更凶险的地牢
          const heal = Math.min(this.player.maxHp - this.player.hp, Math.ceil(this.player.maxHp * 0.3));
          if (heal > 0) this.player.hp += heal;
          this._buildMap();
          this.phase = "map";
          const ch = this._chapter();
          this._log(`${ch.icon} 你深入地牢更深处——第 ${this.chapter} 章「${ch.name}」，敌人愈发凶险${heal > 0 ? `（生命回复 ${heal}）` : ""}`, "good");
          this.emit("chapterClear", { chapter: this.chapter, name: ch.name, icon: ch.icon, heal });
          this.emit("change");
          return;
        }
        // —— 最终章 Boss 已败 → 全程通关 ——
        this.phase = "gameover";
        this._log("🏆 你击败了地牢领主，征服了所有章节，成功通关！", "good");
        this.emit("change");
        this.emit("gameWin", { gold: this.player.gold, level: this.player.level, chapter: this.chapter });
        return;
      }
      this.phase = "map";
      this.emit("change");
    }

    // ============================================================
    // 战斗
    // ============================================================
    _startBattle(enemyDef, nodeType) {
      // 章节强度缩放：越深的章节敌人血量更厚、伤害更高、奖励更丰
      const ch = this._chapter();
      const hpScale = ch.hpScale || 1;
      const chIdx = (this.chapter || 1) - 1;
      const scaledHp = Math.round(enemyDef.maxHp * hpScale);
      const enemy = {
        id: enemyDef.id,
        // Boss 在不同章节换上更具压迫感的名号与形象
        name: enemyDef.boss ? ch.bossName : enemyDef.name,
        icon: enemyDef.boss ? ch.bossIcon : enemyDef.icon,
        maxHp: scaledHp, hp: scaledHp,
        diceCount: enemyDef.diceCount, ai: enemyDef.ai || "balanced",
        rewardGold: Math.round(enemyDef.rewardGold * (1 + chIdx * 0.4)),
        rewardXp: Math.round(enemyDef.rewardXp * (1 + chIdx * 0.3)),
        dmgScale: ch.dmgScale || 1,         // 敌人伤害按章节放大（在伤害结算/意图中生效）
        boss: !!enemyDef.boss, elite: !!enemyDef.elite,
        block: 0, status: { poison: 0, burn: 0, freeze: 0, weak: 0, thorns: 0, vuln: 0 },
        equipment: enemyDef.equipment.map((e) => this._makeEquipInstance(e)),
        dice: [],
      };
      // 重置玩家战斗态
      this.player.block = 0;
      this.player.status = { poison: 0, burn: 0, freeze: 0, weak: 0, thorns: 0, vuln: 0 };
      this.player.dice = [];
      this.player.equipment.forEach((eq) => (eq.usesLeft = eq.usesPerTurn));

      this.battle = { enemy, turn: "player", turnNo: 1, over: false };
      this.phase = "battle";
      this._log(`⚔️ 遭遇 ${enemy.icon} ${enemy.name}（HP ${enemy.maxHp}）`, "blind");
      this.emit("battleStart", { enemy: this._publicUnit(enemy) });
      this._beginPlayerTurn();
    }

    // 玩家回合开始：结算持续状态 → 投骰 → 冰冻处理
    _beginPlayerTurn() {
      const p = this.player;
      this.battle.turn = "player";
      p.block = 0;
      p.equipment.forEach((eq) => { eq.usesLeft = eq.usesPerTurn; eq.sumProgress = 0; });
      if (this._tickStatuses(p, "player")) return;     // 中毒/燃烧可能致死
      p.dice = this._roll(p.diceCount);
      this._applyFreeze(p);
      // 预先为敌人投骰并推演意图，让玩家在自己回合就能看到「敌人即将做什么」
      this._prepareEnemyIntent();
      this._log(`🎲 你的回合，投出 [${p.dice.map((d) => d.value).join(", ")}]`, "play");
      this.emit("diceRolled", { who: "player", dice: p.dice.map((d) => ({ id: d.id, value: d.value })) });
      this.emit("change");
    }

    // ---------- 敌人意图预告 ----------
    // 在玩家回合开始时，为敌人预投骰子（存入 enemy.pendingDice，敌人回合直接使用），
    // 并以「干跑」方式推演 AI 会怎么用这些骰子，汇总成 intent 供 UI 展示。
    // 推演只读不结算，因此不会改变任何真实血量/状态。
    _prepareEnemyIntent() {
      const e = this.battle && this.battle.enemy;
      if (!e) return;
      const p = this.player;
      // 预测敌人回合开始时是否会因毒/燃烧死亡——若会，则无意图
      const willDieToDot = (e.status.poison + e.status.burn) >= e.hp;
      e.pendingDice = this._roll(e.diceCount);
      // 冰冻对预投骰子的影响（与真实回合一致），并在此消耗冰冻层数（敌人回合不再二次结算）
      if (e.status.freeze > 0 && e.pendingDice.length) {
        let hi = e.pendingDice[0];
        e.pendingDice.forEach((d) => { if (d.value > hi.value) hi = d; });
        hi.value = 1;
        e.status.freeze--;
        this._log(`❄ ${this._name(e)} 被冰冻，最高骰子冻成 1`, "good");
      }

      const intent = { damage: 0, shield: 0, heal: 0, statuses: {}, willDieToDot, actions: [] };
      if (willDieToDot) { this.battle.intent = intent; return; }

      // 干跑：复制骰子可用状态，按与 _enemyPlay 相同的贪心评分挑选动作
      const sim = e.pendingDice.map((d) => ({ value: d.value, used: false }));
      const uses = {};
      e.equipment.forEach((eq) => (uses[eq.instId] = eq.usesPerTurn));
      let guard = 30;
      while (guard-- > 0) {
        const free = sim.filter((d) => !d.used);
        if (!free.length) break;
        let best = null;
        for (const die of free) {
          for (const eq of e.equipment) {
            if (uses[eq.instId] <= 0) continue;
            if (!checkCondition(eq.condition, die.value)) continue;
            const score = this._scoreAction(e, p, eq, die.value);
            if (!best || score > best.score) best = { die, eq, score };
          }
        }
        if (!best) break;
        best.die.used = true;
        uses[best.eq.instId] -= 1;
        // 累计该动作对意图的贡献
        for (const eff of best.eq.effects) {
          const val = resolveValue(eff.value, best.die.value);
          switch (eff.type) {
            case "damage": {
              const times = eff.times && eff.times > 1 ? eff.times : 1;
              const base = (e.dmgScale && e.dmgScale > 1) ? Math.ceil(val * e.dmgScale) : val;
              intent.damage += this._applyVuln(p, this._applyWeak(e, base)) * times;
              break;
            }
            case "shield": intent.shield += val; break;
            case "heal":   intent.heal += val; break;
            case "poison": case "burn": case "freeze": case "weak": case "thorns": case "vuln":
              intent.statuses[eff.type] = (intent.statuses[eff.type] || 0) + val; break;
            default: break;
          }
        }
        intent.actions.push({ equip: best.eq.name, icon: best.eq.icon });
      }
      this.battle.intent = intent;
    }

    _roll(count) {
      const dice = [];
      for (let i = 0; i < count; i++) dice.push({ id: uid("d"), value: this._rollDie(), used: false });
      return dice;
    }

    // 冰冻：把当前最高点数的骰子冻成 1，freeze 层 -1
    _applyFreeze(unit) {
      if (unit.status.freeze > 0 && unit.dice.length) {
        let hi = unit.dice[0];
        unit.dice.forEach((d) => { if (d.value > hi.value) hi = d; });
        hi.value = 1;
        unit.status.freeze--;
        this._log(`❄ ${this._name(unit)} 被冰冻，最高骰子冻成 1`, "bad");
      }
    }

    // 持续状态结算（毒/燃烧）。返回 true 表示该单位因此死亡（流程已处理）。
    _tickStatuses(unit, side) {
      let dmg = 0;
      if (unit.status.poison > 0) {
        dmg += unit.status.poison;
        this._log(`☠ ${this._name(unit)} 中毒，受到 ${unit.status.poison} 点伤害`, "bad");
      }
      if (unit.status.burn > 0) {
        dmg += unit.status.burn;
        this._log(`🔥 ${this._name(unit)} 燃烧，受到 ${unit.status.burn} 点伤害`, "bad");
      }
      if (dmg > 0) {
        unit.hp -= dmg;                                  // 持续伤害无视护盾
        this.emit("damage", { side, amount: dmg, kind: "dot", hp: Math.max(0, unit.hp) });
      }
      // 衰减：毒 -1，燃烧减半（向下取整），荆棘 -1，易伤 -1
      if (unit.status.poison > 0) unit.status.poison -= 1;
      if (unit.status.burn > 0) unit.status.burn = Math.floor(unit.status.burn / 2);
      if (unit.status.thorns > 0) unit.status.thorns -= 1;
      if (unit.status.vuln > 0) unit.status.vuln -= 1;

      if (unit.hp <= 0) {
        if (side === "player") this._lose();
        else this._win();
        return true;
      }
      return false;
    }

    // ---------- 玩家操作：把一个骰子分配到某件装备 ----------
    assignDie(dieId, equipInstId) {
      if (this.phase !== "battle" || this.battle.turn !== "player" || this.battle.over) return { ok: false };
      const p = this.player;
      const die = p.dice.find((d) => d.id === dieId && !d.used);
      const eq = p.equipment.find((e) => e.instId === equipInstId);
      if (!die || !eq) return { ok: false };
      if (eq.usesLeft <= 0) return { ok: false, reason: "used" };
      if (!checkCondition(eq.condition, die.value)) return { ok: false, reason: "condition" };

      die.used = true;
      eq.usesLeft--;

      // 累计槽：先累加进度，未达阈值则只投入不触发
      if (eq.condition && eq.condition.type === "sum") {
        eq.sumProgress = (eq.sumProgress || 0) + die.value;
        if (eq.sumProgress < eq.condition.value) {
          this._log(`💣 ${this._name(p)} 向【${eq.name}】蓄能（${eq.sumProgress}/${eq.condition.value}）`, "play");
          this.emit("equipCharge", { instId: eq.instId, progress: eq.sumProgress, need: eq.condition.value });
          this.emit("change");
          if (p.dice.every((d) => d.used)) this.emit("diceExhausted", {});
          return { ok: true, charged: true };
        }
        eq.sumProgress = 0;          // 达阈值：结算后清零，可再次蓄力
      }

      this._resolveEquipment(p, this.battle.enemy, eq, die.value, "player");
      if (this.battle.over) return { ok: true };
      this.emit("change");
      // 若所有骰子用尽，提示（仍可手动结束回合）
      if (p.dice.every((d) => d.used)) this.emit("diceExhausted", {});
      return { ok: true };
    }

    // 结算一件装备的全部效果。
    // sumValue：累计槽触发时传入的累计总和，用于把 dice 占位换成实际累计点数（可选）。
    _resolveEquipment(source, opponent, eq, dieValue, side) {
      const events = [];
      const oppSide = side === "player" ? "enemy" : "player";
      for (const eff of eq.effects) {
        const tgtSide = effectTarget(eff);
        const target = tgtSide === "self" ? source : opponent;
        const targetSide = tgtSide === "self" ? side : oppSide;
        let val = resolveValue(eff.value, dieValue);

        switch (eff.type) {
          case "damage": {
            // 敌人伤害按章节强度放大（多章节地牢：越深越痛）
            if (side === "enemy" && source.dmgScale && source.dmgScale > 1) val = Math.ceil(val * source.dmgScale);
            // 多段攻击（times）：逐段结算；穿透（pierce）：无视护盾
            const times = eff.times && eff.times > 1 ? eff.times : 1;
            for (let t = 0; t < times; t++) {
              let dmg = this._applyWeak(source, val);
              dmg = this._applyVuln(target, dmg);
              const dealt = this._dealDamage(target, dmg, targetSide, source, side, !!eff.pierce);
              events.push({ type: "damage", amount: dealt, pierce: !!eff.pierce });
              if (this.battle && this.battle.over) break;
            }
            break;
          }
          case "shield":
            target.block += val;
            events.push({ type: "shield", amount: val });
            this.emit("status", { side: targetSide, key: "shield", value: target.block });
            break;
          case "heal": {
            const before = target.hp;
            target.hp = Math.min(target.maxHp, target.hp + val);
            events.push({ type: "heal", amount: target.hp - before });
            this.emit("heal", { target: targetSide, amount: target.hp - before });
            break;
          }
          case "poison":
          case "burn":
          case "freeze":
          case "weak":
          case "thorns":
          case "vuln":
            target.status[eff.type] += val;
            events.push({ type: eff.type, amount: val });
            this.emit("status", { side: targetSide, key: eff.type, value: target.status[eff.type] });
            break;
          case "modify":
            this._applyModify(source, eff.op);
            events.push({ type: "modify", op: eff.op });
            break;
          case "cleanse": {
            const removed = this._cleanse(target, val || 1);
            events.push({ type: "cleanse", amount: removed.length, removed });
            if (removed.length) {
              this._log(`✨ ${this._name(target)} 净化了 ${removed.map((k) => STATUSES[k].name).join("、")}`, "good");
              this.emit("status", { side: targetSide, key: "cleanse", value: removed.length });
            }
            break;
          }
          default:
            break;
        }
        if (this.battle && this.battle.over) break;
      }
      this._log(`${eq.icon || "▫"} ${this._name(source)} 使用【${eq.name}】(${dieValue})`, side === "player" ? "play" : "discard");
      this.emit("equipUsed", { side, equip: eq.name, icon: eq.icon, dieValue, events });
      if (opponent.hp <= 0) { side === "player" ? this._win() : this._lose(); }
    }

    // 骰子改造：作用于「来源单位本回合其余未使用的骰子」
    _applyModify(source, op) {
      const Data2 = Data;
      const spec = Data2.MODIFY_OP && Data2.MODIFY_OP[op];
      const targets = (source.dice || []).filter((d) => !d.used);
      if (!targets.length) return;
      targets.forEach((d) => {
        if (op === "reroll") d.value = this._rollDie();
        else if (spec && spec.apply) d.value = spec.apply(d.value);
      });
      this._log(`🎲 ${this._name(source)} 改造了其余骰子（${(spec && spec.label) || op}）`, source === this.player ? "play" : "discard");
      this.emit("diceModified", {
        who: source === this.player ? "player" : "enemy",
        dice: (source.dice || []).map((d) => ({ id: d.id, value: d.value, used: d.used })),
      });
    }

    // 虚弱：造成的伤害降低约 1/3（向上取整，至少 1）
    _applyWeak(source, dmg) {
      if (source.status && source.status.weak > 0) return Math.max(1, Math.ceil(dmg * 0.66));
      return dmg;
    }
    // 易伤：受到的攻击伤害提高 50%（向上取整）
    _applyVuln(target, dmg) {
      if (target.status && target.status.vuln > 0) return Math.ceil(dmg * 1.5);
      return dmg;
    }
    // 净化：移除目标最多 n 个负面状态，返回被移除的状态键数组
    _cleanse(target, n) {
      const order = ["poison", "burn", "freeze", "weak", "vuln"];
      const removed = [];
      for (const k of order) {
        if (removed.length >= n) break;
        if (target.status[k] > 0) { target.status[k] = 0; removed.push(k); }
      }
      return removed;
    }

    // 造成伤害：先扣护盾，再扣生命。玩家受到生命伤害会为大招充能。返回实际造成的总伤害。
    // source/sourceSide：攻击发起者，用于结算被攻击方的「荆棘」反伤。
    // pierce：穿透，无视护盾直接扣生命（文档 §22.2.1）。
    _dealDamage(target, amount, targetSide, source, sourceSide, pierce) {
      let remaining = amount;
      let absorbed = 0;
      if (!pierce && target.block > 0) {
        absorbed = Math.min(target.block, remaining);
        target.block -= absorbed;
        remaining -= absorbed;
      }
      target.hp -= remaining;
      this.emit("damage", { side: targetSide, amount, absorbed, pierce: !!pierce, hp: Math.max(0, target.hp) });
      // 大招充能：玩家受到的「生命」伤害
      if (targetSide === "player" && remaining > 0) {
        const lim = this.player.limit;
        lim.charge = Math.min(lim.chargeMax, lim.charge + remaining);
        this.emit("limitCharge", { charge: lim.charge, max: lim.chargeMax });
      }
      // 荆棘反伤：被攻击方对攻击者反弹荆棘层数（无视护盾，发生在攻击命中后）
      if (source && sourceSide && target.status && target.status.thorns > 0 && target.hp > 0) {
        const t = target.status.thorns;
        source.hp -= t;
        this._log(`🌵 ${this._name(target)} 的荆棘反弹 ${t} 点伤害给 ${this._name(source)}`, "bad");
        this.emit("damage", { side: sourceSide, amount: t, absorbed: 0, kind: "thorns", hp: Math.max(0, source.hp) });
        if (source.hp <= 0) { sourceSide === "player" ? this._lose() : this._win(); }
      }
      return amount;
    }

    // ---------- 大招：重掷所有未使用骰子 ----------
    useLimitBreak() {
      if (this.phase !== "battle" || this.battle.turn !== "player" || this.battle.over) return { ok: false };
      const lim = this.player.limit;
      if (lim.charge < lim.chargeMax) return { ok: false, reason: "charge" };
      lim.charge = 0;
      this.player.dice.forEach((d) => { if (!d.used) d.value = this._rollDie(); });
      this._log(`💥 大招【${lim.name}】！重掷所有骰子`, "good");
      this.emit("limitUsed", {});
      this.emit("change");
      return { ok: true };
    }

    // ---------- 结束玩家回合 → 敌人回合 ----------
    endTurn() {
      if (this.phase !== "battle" || this.battle.turn !== "player" || this.battle.over) return { ok: false };
      // 玩家虚弱在回合结束衰减
      if (this.player.status.weak > 0) this.player.status.weak--;
      this._enemyTurn();
      return { ok: true };
    }

    _enemyTurn() {
      const b = this.battle;
      const e = b.enemy;
      const p = this.player;
      b.turn = "enemy";
      e.block = 0;
      e.equipment.forEach((eq) => (eq.usesLeft = eq.usesPerTurn));
      this.emit("change");

      if (this._tickStatuses(e, "enemy")) return;       // 毒/燃烧可能直接击杀敌人
      // 使用玩家回合时已预投并展示过意图的骰子，保证「预告 = 实际」；缺失时兜底重投
      if (e.pendingDice && e.pendingDice.length) {
        e.dice = e.pendingDice;
        e.pendingDice = null;
      } else {
        e.dice = this._roll(e.diceCount);
        this._applyFreeze(e);
      }
      this._log(`🎲 ${e.name} 投出 [${e.dice.map((d) => d.value).join(", ")}]`, "discard");
      this.emit("diceRolled", { who: "enemy", dice: e.dice.map((d) => ({ id: d.id, value: d.value })) });

      // AI：贪心地把骰子分配给收益最高的装备
      this._enemyPlay(e, p);
      if (b.over) return;

      if (e.status.weak > 0) e.status.weak--;
      // 回到玩家回合
      b.turnNo++;
      this.emit("enemyTurnEnd", {});
      this._beginPlayerTurn();
    }

    // 敌人 AI：评分模型驱动的贪心分配
    _enemyPlay(e, p) {
      let guard = 30;
      while (guard-- > 0) {
        const dice = e.dice.filter((d) => !d.used);
        if (!dice.length) break;
        let best = null;
        for (const die of dice) {
          for (const eq of e.equipment) {
            if (eq.usesLeft <= 0) continue;
            if (!checkCondition(eq.condition, die.value)) continue;
            const score = this._scoreAction(e, p, eq, die.value);
            if (!best || score > best.score) best = { die, eq, score };
          }
        }
        if (!best) break;                                 // 没有可用组合
        best.die.used = true;
        best.eq.usesLeft--;
        this._resolveEquipment(e, p, best.eq, best.die.value, "enemy");
        if (this.battle.over) return;
      }
    }

    // 行动评分：伤害/治疗/护盾/状态加权 + 击杀奖励
    _scoreAction(e, p, eq, dieValue) {
      const W = e.ai === "aggressive" ? { dmg: 1.2, def: 0.4, st: 1.0, heal: 0.8 }
              : e.ai === "defensive"  ? { dmg: 0.8, def: 1.2, st: 1.0, heal: 1.4 }
              :                          { dmg: 1.0, def: 0.8, st: 1.2, heal: 1.0 };
      let score = 0;
      for (const eff of eq.effects) {
        const val = resolveValue(eff.value, dieValue);
        switch (eff.type) {
          case "damage": {
            const times = eff.times && eff.times > 1 ? eff.times : 1;
            const dv = (e.dmgScale && e.dmgScale > 1) ? Math.ceil(val * e.dmgScale) : val;
            let real = this._applyWeak(e, dv);
            real = this._applyVuln(p, real) * times;     // 计入易伤加成与多段
            const real2 = eff.pierce ? real : Math.max(0, real - p.block); // 穿透无视护盾
            score += real * W.dmg + (eff.pierce ? p.block * 0.5 : 0);
            if (real2 >= p.hp) score += 100;             // 可击杀玩家：最高优先
            break;
          }
          case "shield": score += val * W.def; break;
          case "heal":   score += (e.hp < e.maxHp * 0.6 ? val * W.heal : val * 0.2); break;
          case "poison":
          case "burn":   score += val * 1.6 * W.st; break;
          case "freeze": score += 3 * W.st; break;
          case "weak":   score += val * 1.2 * W.st; break;
          case "thorns": score += val * 1.0 * W.def; break;
          case "vuln":   score += val * 1.3 * W.st; break;   // 易伤：放大后续伤害
          case "modify": score += 1.0; break;        // 改造价值较低，避免敌人优先空转
          case "cleanse": {                            // 净化：仅在自身有负面状态时有价值
            const neg = e.status.poison + e.status.burn + e.status.freeze + e.status.weak + e.status.vuln;
            score += neg > 0 ? 3 : 0;
            break;
          }
          default: break;
        }
      }
      return score;
    }

    // ---------- 战斗结束 ----------
    _win() {
      if (this.battle.over) return;
      this.battle.over = true;
      const e = this.battle.enemy;
      this._log(`🎉 击败 ${e.name}！`, "good");
      this.emit("battleWin", { enemy: e.name });

      // 奖励：金币 + 经验
      this.player.gold += e.rewardGold;
      this._gainXp(e.rewardXp);
      this._log(`💰 获得 $${e.rewardGold} 与 ${e.rewardXp} 经验`, "buy");

      if (e.boss) {
        // 击败 Boss → 推进地图（会触发通关）
        this._advanceMap();
        return;
      }
      // 普通/精英战斗后三选一装备
      this._offerReward("battle");
    }

    _lose() {
      if (this.battle && this.battle.over) return;
      if (this.battle) this.battle.over = true;
      this.phase = "gameover";
      this._log("💀 你倒在了地牢深处……", "bad");
      this.emit("change");
      this.emit("gameLose", { level: this.player.level });
    }

    // ---------- 经验与升级 ----------
    _gainXp(amount) {
      const p = this.player;
      p.xp += amount;
      // 可能连续升级
      while (true) {
        const next = LEVELS.find((l) => l.level === p.level + 1);
        if (!next || p.xp < next.need) break;
        p.level = next.level;
        if (next.maxHp) { p.maxHp += next.maxHp; p.hp += next.maxHp; }
        if (next.dice) p.diceCount += next.dice;
        if (next.capacity) p.capacity += next.capacity;
        const parts = [];
        if (next.maxHp) parts.push(`最大生命+${next.maxHp}`);
        if (next.dice) parts.push("骰子+1");
        if (next.capacity) parts.push("装备栏+1");
        this._log(`⬆️ 升到 ${p.level} 级！${parts.join("，")}`, "good");
        this.emit("levelUp", { level: p.level, rewards: parts });
      }
    }

    // ============================================================
    // 战斗奖励：三选一装备（可跳过）
    // ============================================================
    // opts：字符串（来源）或 { source, tag }（tag 用于按构筑方向过滤奖励池）
    _offerReward(opts) {
      const o = typeof opts === "string" ? { source: opts } : (opts || {});
      let candidates = REWARD_EQUIPMENT;
      if (o.tag) {
        const filtered = REWARD_EQUIPMENT.filter((e) => (e.tags || []).includes(o.tag));
        if (filtered.length >= CONFIG.REWARD_CHOICES) candidates = filtered;
      }
      const pool = this._pickWeighted(candidates, CONFIG.REWARD_CHOICES);
      this.reward = { source: o.source || "battle", options: pool.map((d) => d.id) };
      this.phase = "reward";
      this.emit("change");
      this.emit("rewardOpen", { source: this.reward.source, options: pool.map((d) => ({ id: d.id, name: d.name })) });
    }

    // 当前装备占用的总格数
    usedCapacity(equipment) {
      return (equipment || this.player.equipment).reduce((s, e) => s + (e.size || 1), 0);
    }

    // 领取奖励装备（容量不足时返回需要替换）
    pickReward(equipId) {
      if (this.phase !== "reward" || !this.reward) return { ok: false };
      const def = findEquipment(equipId);
      if (!def || !this.reward.options.includes(equipId)) return { ok: false };
      if (this.usedCapacity() + (def.size || 1) > this.player.capacity) {
        return { ok: false, reason: "capacity", need: def.size || 1 };
      }
      this.player.equipment.push(this._makeEquipInstance(def));
      this._log(`✨ 获得装备【${def.name}】`, "good");
      this.reward = null;
      this._advanceMap();
      return { ok: true };
    }

    // 用新装备替换掉一件已有装备（容量不足时使用）
    replaceWithReward(equipId, removeInstId) {
      if (this.phase !== "reward" || !this.reward) return { ok: false };
      const def = findEquipment(equipId);
      if (!def || !this.reward.options.includes(equipId)) return { ok: false };
      const idx = this.player.equipment.findIndex((e) => e.instId === removeInstId);
      if (idx < 0) return { ok: false };
      const removed = this.player.equipment.splice(idx, 1)[0];
      if (this.usedCapacity() + (def.size || 1) > this.player.capacity) {
        // 仍放不下：撤销
        this.player.equipment.splice(idx, 0, removed);
        return { ok: false, reason: "capacity" };
      }
      this.player.equipment.push(this._makeEquipInstance(def));
      this._log(`🔄 用【${def.name}】替换了【${removed.name}】`, "good");
      this.reward = null;
      this._advanceMap();
      return { ok: true };
    }

    skipReward() {
      if (this.phase !== "reward") return { ok: false };
      this._log("跳过了奖励", "info");
      this.reward = null;
      this._advanceMap();
      return { ok: true };
    }

    // 直接丢弃一件装备（装备栏管理）
    discardEquipment(instId) {
      const idx = this.player.equipment.findIndex((e) => e.instId === instId);
      if (idx < 0) return { ok: false };
      const [r] = this.player.equipment.splice(idx, 1);
      this._log(`🗑 丢弃了【${r.name}】`, "discard");
      this.emit("change");
      return { ok: true };
    }

    // ============================================================
    // 商店
    // ============================================================
    _openShop() {
      this._rollShop();
      this.phase = "shop";
      this.emit("change");
      this.emit("shopOpen", {});
    }
    _rollShop() {
      const items = this._pickWeighted(REWARD_EQUIPMENT, CONFIG.SHOP_EQUIP_COUNT)
        .map((d) => ({ id: uid("si"), equipId: d.id, price: d.price, sold: false }));
      this.shop = { items, healCost: CONFIG.SHOP_HEAL_COST, healAmount: CONFIG.SHOP_HEAL_AMOUNT };
    }
    rerollShop() {
      if (this.phase !== "shop") return { ok: false };
      if (this.player.gold < CONFIG.REROLL_COST) return { ok: false, reason: "money" };
      this.player.gold -= CONFIG.REROLL_COST;
      this._rollShop();
      this._log(`🔄 刷新商店 -$${CONFIG.REROLL_COST}`, "info");
      this.emit("change");
      return { ok: true };
    }
    buyEquipment(itemId) {
      if (this.phase !== "shop") return { ok: false };
      const item = this.shop.items.find((i) => i.id === itemId);
      if (!item || item.sold) return { ok: false };
      const def = findEquipment(item.equipId);
      if (this.player.gold < item.price) return { ok: false, reason: "money" };
      if (this.usedCapacity() + (def.size || 1) > this.player.capacity) return { ok: false, reason: "capacity" };
      this.player.gold -= item.price;
      this.player.equipment.push(this._makeEquipInstance(def));
      item.sold = true;
      this._log(`🛒 购买【${def.name}】 -$${item.price}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    buyHeal() {
      if (this.phase !== "shop") return { ok: false };
      if (this.player.hp >= this.player.maxHp) return { ok: false, reason: "full" };
      if (this.player.gold < this.shop.healCost) return { ok: false, reason: "money" };
      this.player.gold -= this.shop.healCost;
      const amt = Math.min(this.shop.healAmount, this.player.maxHp - this.player.hp);
      this.player.hp += amt;
      this._log(`💚 购买治疗，回复 ${amt} 点生命 -$${this.shop.healCost}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    // 升级一件已有装备（若它有升级版本）
    upgradeEquipment(instId) {
      if (this.phase !== "shop") return { ok: false };
      const eq = this.player.equipment.find((e) => e.instId === instId);
      if (!eq || !eq.upgradeId) return { ok: false, reason: "noupgrade" };
      if (this.player.gold < CONFIG.UPGRADE_COST) return { ok: false, reason: "money" };
      const def = findEquipment(eq.upgradeId);
      if (!def) return { ok: false };
      this.player.gold -= CONFIG.UPGRADE_COST;
      const idx = this.player.equipment.findIndex((e) => e.instId === instId);
      this.player.equipment[idx] = this._makeEquipInstance(def);
      this._log(`⚒️ 升级【${eq.name}】→【${def.name}】 -$${CONFIG.UPGRADE_COST}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    sellEquipment(instId) {
      const idx = this.player.equipment.findIndex((e) => e.instId === instId);
      if (idx < 0) return { ok: false };
      const eq = this.player.equipment[idx];
      const value = Math.max(1, Math.floor((eq.price || 4) * CONFIG.SELL_RATIO));
      this.player.equipment.splice(idx, 1);
      this.player.gold += value;
      this._log(`💰 卖出【${eq.name}】 +$${value}`, "buy");
      this.emit("change");
      return { ok: true, value };
    }
    leaveShop() {
      if (this.phase !== "shop") return { ok: false };
      this.shop = null;
      this._advanceMap();
      return { ok: true };
    }

    // ============================================================
    // 事件（文档 §24）：展示文本与若干选项，选项含 cost/reward 指令
    // ============================================================
    _openEvent(eventDef) {
      if (!eventDef) { this._advanceMap(); return; }
      this.event = { id: eventDef.id, resolved: false };
      this._eventDef = eventDef;
      this.phase = "event";
      this._log(`❔ 事件：${eventDef.name}`, "blind");
      this.emit("change");
      this.emit("eventOpen", { id: eventDef.id, name: eventDef.name });
    }

    // 判断某个选项当前是否可选（金币/生命/可升级装备等前置条件）
    _eventChoiceAvailable(choice) {
      const req = choice.requires;
      if (!req) return true;
      const p = this.player;
      if (req.minGold != null && p.gold < req.minGold) return false;
      if (req.minHp != null && p.hp < req.minHp) return false;
      if (req.hasUpgradable && !p.equipment.some((e) => e.upgradeId)) return false;
      return true;
    }

    // 玩家选择事件选项 → 结算 cost 与 reward
    chooseEventOption(index) {
      if (this.phase !== "event" || !this._eventDef) return { ok: false };
      const choice = this._eventDef.choices[index];
      if (!choice) return { ok: false };
      if (!this._eventChoiceAvailable(choice)) return { ok: false, reason: "requires" };

      // 1) 先付出代价
      const cost = choice.cost || {};
      if (cost.gold) this.player.gold = Math.max(0, this.player.gold - cost.gold);
      if (cost.hp) {
        this.player.hp -= cost.hp;
        this.emit("damage", { side: "player", amount: cost.hp, absorbed: 0, kind: "event", hp: Math.max(0, this.player.hp) });
        if (this.player.hp <= 0) { this._log("事件的代价过于沉重……", "bad"); this._lose(); return { ok: true }; }
      }
      this._log(`你选择：${choice.text}`, "play");

      // 2) 再结算收益（可能打开奖励界面，由其负责后续推进）
      const opened = this._applyEventReward(choice.reward || {});
      this.event = null;
      this._eventDef = null;
      if (!opened) this._advanceMap();           // 未打开二级界面时直接推进地图
      return { ok: true };
    }

    // 执行一组 reward 指令。返回 true 表示已打开了需要玩家进一步操作的界面（如三选一）。
    _applyEventReward(reward) {
      const p = this.player;
      // 概率分支：按权重随机选一个子 reward 执行
      if (reward.chance) {
        let total = 0; reward.chance.forEach((c) => (total += c.weight || 1));
        let r = this.rnd() * total, pick = reward.chance[0];
        for (const c of reward.chance) { r -= (c.weight || 1); if (r <= 0) { pick = c; break; } }
        this._log("命运的骰子滚动……", "blind");
        return this._applyEventReward(pick.reward || {});
      }
      if (reward.hp) {
        if (reward.hp > 0) {
          const amt = Math.min(reward.hp, p.maxHp - p.hp);
          p.hp += amt; this._log(`💚 回复 ${amt} 点生命`, "good");
          this.emit("heal", { target: "player", amount: amt });
        } else {
          p.hp += reward.hp;
          this.emit("damage", { side: "player", amount: -reward.hp, absorbed: 0, kind: "event", hp: Math.max(0, p.hp) });
          this._log(`💢 受到 ${-reward.hp} 点伤害`, "bad");
          if (p.hp <= 0) { this._lose(); return false; }
        }
      }
      if (reward.maxHp) { p.maxHp += reward.maxHp; p.hp += reward.maxHp; this._log(`❤️ 最大生命 +${reward.maxHp}`, "good"); }
      if (reward.gold) { p.gold += reward.gold; this._log(`💰 获得 $${reward.gold}`, "buy"); }
      if (reward.fullHeal) {
        const amt = p.maxHp - p.hp; p.hp = p.maxHp;
        this._log(`💚 生命完全恢复（+${amt}）`, "good");
        if (amt > 0) this.emit("heal", { target: "player", amount: amt });
      }
      if (reward.upgradeRandom) {
        const ok = this._upgradeRandomEquipment();
        if (!ok) { p.gold += 2; this._log("没有可升级的装备，铁匠塞给你 $2 作为补偿", "buy"); }
      }
      if (reward.randomEquip) {
        const def = this._pickWeighted(REWARD_EQUIPMENT, 1)[0];
        if (def) {
          if (this.usedCapacity() + (def.size || 1) <= p.capacity) {
            p.equipment.push(this._makeEquipInstance(def));
            this._log(`✨ 获得装备【${def.name}】`, "good");
          } else {
            // 容量不足：转为一次三选一奖励，交由替换/丢弃流程处理
            this._offerReward({ source: "event" });
            return true;
          }
        }
      }
      if (reward.rewardChoice) {
        this._offerReward(reward.rewardChoice);     // 打开三选一，领取后自然推进地图
        return true;
      }
      this.emit("change");
      return false;
    }

    // 随机升级一件「拥有升级版本」的装备，成功返回 true
    _upgradeRandomEquipment() {
      const ups = this.player.equipment.filter((e) => e.upgradeId);
      if (!ups.length) return false;
      const eq = this._pick(ups);
      const def = findEquipment(eq.upgradeId);
      if (!def) return false;
      const idx = this.player.equipment.findIndex((e) => e.instId === eq.instId);
      this.player.equipment[idx] = this._makeEquipInstance(def);
      this._log(`⚒️ 装备升级：【${eq.name}】→【${def.name}】`, "good");
      this.emit("change");
      return true;
    }

    leaveEvent() {
      if (this.phase !== "event") return { ok: false };
      this.event = null;
      this._eventDef = null;
      this._advanceMap();
      return { ok: true };
    }

    // ============================================================
    // 只读查询
    // ============================================================
    _name(unit) { return unit === this.player ? "你" : (unit.name || "敌人"); }
    _publicUnit(u) {
      return {
        name: u.name, icon: u.icon, hp: u.hp, maxHp: u.maxHp,
        boss: !!u.boss, elite: !!u.elite,
        block: u.block, status: Object.assign({}, u.status),
        dice: (u.dice || []).map((d) => ({ id: d.id, value: d.value, used: d.used })),
        equipment: (u.equipment || []).map((e) => this._publicEquip(e)),
      };
    }
    _publicEquip(e) {
      return {
        instId: e.instId, id: e.id, name: e.name, icon: e.icon, size: e.size || 1,
        usesPerTurn: e.usesPerTurn, usesLeft: e.usesLeft,
        condition: e.condition, effects: e.effects, tags: e.tags || [],
        upgradeId: e.upgradeId || null, price: e.price || 0,
        sumProgress: e.sumProgress || 0,
        desc: Data.describeEquipment(e),
      };
    }

    getState() {
      const p = this.player;
      const ch = this._chapter();
      const base = {
        phase: this.phase,
        chapter: this.chapter || 1,
        maxChapter: CHAPTERS.length,
        chapterName: ch.name,
        chapterIcon: ch.icon,
        player: p ? {
          name: p.name, icon: p.icon, hp: p.hp, maxHp: p.maxHp,
          block: p.block || 0, status: Object.assign({}, p.status || {}),
          diceCount: p.diceCount, capacity: p.capacity, usedCapacity: this.usedCapacity(),
          level: p.level, xp: p.xp, gold: p.gold,
          nextNeed: (LEVELS.find((l) => l.level === p.level + 1) || {}).need || null,
          equipment: p.equipment.map((e) => this._publicEquip(e)),
          dice: (p.dice || []).map((d) => ({ id: d.id, value: d.value, used: d.used })),
          limit: Object.assign({}, p.limit),
        } : null,
      };
      if (this.map) {
        const path = this.map.path || [];
        const nodeInfo = (n) => ({
          id: n.id, type: n.type, meta: this.nodeMeta(n.type),
          enemy: n.enemyId ? (() => { const e = findEnemy(n.enemyId); return { id: e.id, name: e.name, icon: e.icon, hp: e.maxHp }; })() : null,
        });
        base.map = {
          rowIndex: this.map.rowIndex,
          totalRows: this.map.rows.length,
          // 兼容旧用法：当前层节点
          currentRow: (this.map.rows[this.map.rowIndex] || []).map(nodeInfo),
          // 完整路线：每层带 done / current / upcoming 状态，并标记已选节点
          rows: this.map.rows.map((row, r) => ({
            index: r,
            state: r < this.map.rowIndex ? "done" : (r === this.map.rowIndex ? "current" : "upcoming"),
            nodes: row.map((n) => Object.assign(nodeInfo(n), { chosen: path[r] === n.id })),
          })),
        };
      }
      if (this.phase === "battle" && this.battle) {
        base.battle = {
          turn: this.battle.turn, turnNo: this.battle.turnNo, over: this.battle.over,
          enemy: this._publicUnit(this.battle.enemy),
          // 敌人意图仅在玩家回合预告（敌人回合时意图正在执行）
          intent: (this.battle.turn === "player" && !this.battle.over && this.battle.intent)
            ? this.battle.intent : null,
        };
      }
      if (this.phase === "reward" && this.reward) {
        base.reward = {
          source: this.reward.source,
          options: this.reward.options.map((id) => this._publicEquip(this._makeEquipInstance(findEquipment(id)))),
        };
      }
      if (this.phase === "shop" && this.shop) {
        base.shop = {
          healCost: this.shop.healCost, healAmount: this.shop.healAmount,
          rerollCost: CONFIG.REROLL_COST, upgradeCost: CONFIG.UPGRADE_COST,
          items: this.shop.items.map((it) => ({
            id: it.id, sold: it.sold, price: it.price,
            equip: this._publicEquip(this._makeEquipInstance(findEquipment(it.equipId))),
          })),
        };
      }
      if (this.phase === "event" && this._eventDef) {
        const def = this._eventDef;
        base.event = {
          id: def.id, name: def.name, icon: def.icon, desc: def.desc,
          choices: def.choices.map((c, i) => ({
            index: i, text: c.text,
            available: this._eventChoiceAvailable(c),
          })),
        };
      }
      return base;
    }

    // ============================================================
    // 存档（localStorage；命令行下安全降级，不报错）
    // ============================================================
    save() {
      if (!__storage || !this.player) return;
      try {
        const p = this.player;
        const data = {
          v: 1,
          phase: this.phase,
          chapter: this.chapter || 1,
          player: {
            maxHp: p.maxHp, hp: p.hp, diceCount: p.diceCount, capacity: p.capacity,
            level: p.level, xp: p.xp, gold: p.gold,
            equipment: p.equipment.map((e) => e.id),
            limit: { charge: p.limit.charge },
          },
          map: this.map ? { rows: this.map.rows, rowIndex: this.map.rowIndex, path: this.map.path || [] } : null,
        };
        // 战斗中不存盘（避免半场状态过于复杂）；仅在地图/商店/奖励阶段存
        if (this.phase !== "battle") __storage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch (e) { /* 静默 */ }
    }
    hasSave() {
      try { return !!(__storage && __storage.getItem(SAVE_KEY)); } catch (e) { return false; }
    }
    clearSave() {
      try { if (__storage) __storage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    }
    load() {
      try {
        const raw = __storage && __storage.getItem(SAVE_KEY);
        if (!raw) return false;
        const d = JSON.parse(raw);
        if (!d || !d.player) return false;
        const c = CHARACTER;
        const pd = d.player;
        this.player = {
          id: c.id, name: c.name, icon: c.icon,
          maxHp: pd.maxHp, hp: pd.hp, diceCount: pd.diceCount, capacity: pd.capacity,
          level: pd.level, xp: pd.xp, gold: pd.gold,
          equipment: (pd.equipment || []).map((id) => this._makeEquipInstance(findEquipment(id))).filter(Boolean),
          limit: { name: c.limitBreak.name, desc: c.limitBreak.desc, charge: (pd.limit && pd.limit.charge) || 0, chargeMax: c.limitBreak.chargeMax },
        };
        this.chapter = d.chapter || 1;
        this.map = d.map ? { rows: d.map.rows, rowIndex: d.map.rowIndex, path: d.map.path || [] } : null;
        this.battle = null; this.shop = null; this.reward = null;
        this.event = null; this._eventDef = null;
        // 战斗/奖励阶段读档统一回到地图，避免半场态缺失
        this.phase = "map";
        this._log("📂 已读取存档，继续探索", "good");
        return true;
      } catch (e) { return false; }
    }
    resume() { this.emit("change"); }
  }

  // ---- 通用导出 ----
  if (typeof module !== "undefined" && module.exports) module.exports = GameCore;
  if (__root) __root.GameCore = GameCore;
})();
