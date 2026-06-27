/* ============================================================
 * core.js —— 逻辑层（GameCore）
 * 纯游戏状态与规则，不依赖任何 DOM。
 * 通过事件（emit/on）向外界（表现层）广播状态变化，
 * 通过方法接收外界（控制层）的操作指令。
 * ============================================================ */
(function () {
  const { HAND_TYPES, ENHANCEMENTS, EDITIONS, getHandStats, buildDeck, shuffle, evaluateHand, makeRandomCard, nextCardId } = window.Cards;
  const { JOKER_POOL, JOKER_FX } = window.Jokers;
  const { PLANET_POOL } = window.Planets;
  const { TAROT_POOL } = window.Tarots || { TAROT_POOL: [] };
  const { SPECTRAL_POOL } = window.Spectrals || { SPECTRAL_POOL: [] };

  // ---------- 规则常量 ----------
  const CONFIG = {
    ANTE_BASE: [300, 800, 2000, 5000, 11000, 20000, 35000, 50000],
    BLINDS: [
      { key: "small", name: "小盲注", mult: 1, reward: 3, desc: "普通盲注" },
      { key: "big", name: "大盲注", mult: 1.5, reward: 4, desc: "普通盲注" },
      { key: "boss", name: "Boss盲注", mult: 2, reward: 5, desc: "高额目标，全力以赴！" },
    ],
    // Boss 盲注的随机 debuff 效果
    BOSS_EFFECTS: [
      { id: "the_wall", name: "高墙", icon: "🧱", desc: "目标分数翻倍", targetMult: 2 },
      { id: "the_hook", name: "钩子", icon: "🪝", desc: "每次出牌后随机弃 2 张手牌", discardAfterPlay: 2 },
      { id: "club_debuff", name: "梅花诅咒", icon: "♣", desc: "梅花牌不计分", debuffSuit: "C" },
      { id: "heart_debuff", name: "红桃诅咒", icon: "♥", desc: "红桃牌不计分", debuffSuit: "H" },
      { id: "spade_debuff", name: "黑桃诅咒", icon: "♠", desc: "黑桃牌不计分", debuffSuit: "S" },
      { id: "diamond_debuff", name: "方块诅咒", icon: "♦", desc: "方块牌不计分", debuffSuit: "D" },
      { id: "the_arm", name: "巨臂", icon: "💪", desc: "本场所有牌型降 1 级计分", handLevelPenalty: 1 },
      { id: "the_ox", name: "蛮牛", icon: "🐂", desc: "出牌次数 -1", handsPenalty: 1 },
      { id: "the_fish", name: "鱼", icon: "🐟", desc: "弃牌次数 -1", discardsPenalty: 1 },
      { id: "the_face", name: "人面", icon: "🃟", desc: "人头牌(J/Q/K)不计分", debuffFace: true },
      { id: "the_window", name: "窗", icon: "🪟", desc: "首张计分牌不计分", debuffFirst: true },
      { id: "the_house", name: "宅", icon: "🏠", desc: "起手 3 张牌正面朝下（盖牌）", faceDown: 3 },
      { id: "the_pillar", name: "石柱", icon: "🏛️", desc: "手牌上限 -2", handSizePenalty: 2 },
      { id: "the_mouth", name: "巨口", icon: "👄", desc: "本场只能打出 1 种牌型", oneHandType: true },
      { id: "the_needle", name: "针", icon: "📍", desc: "只有 1 次出牌机会（但弃牌+2）", onlyOneHand: true },
    ],
    HAND_SIZE: 8,
    MAX_HANDS: 4,
    MAX_DISCARDS: 3,
    MAX_JOKERS: 5,
    MAX_CONSUMABLES: 2, // 消耗牌（行星/塔罗）持有上限
    TOTAL_ANTE: 8,
    REROLL_COST: 5,
  };

  const isFace = (c) => c.rank >= 11 && c.rank <= 13;
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---------- 极简事件发射器 ----------
  class Emitter {
    constructor() { this._handlers = {}; }
    on(event, fn) {
      (this._handlers[event] = this._handlers[event] || []).push(fn);
      return this;
    }
    emit(event, payload) {
      (this._handlers[event] || []).forEach((fn) => fn(payload));
    }
  }

  // ============================================================
  // GameCore
  // ============================================================
  class GameCore extends Emitter {
    constructor() {
      super();
      this.CONFIG = CONFIG;
    }

    // 覆盖 emit：每次 change 自动存档（gameWin/gameLose 时清档）
    emit(event, payload) {
      super.emit(event, payload);
      if (event === "change") this.save();
      if (event === "gameWin" || event === "gameLose") this.clearSave();
    }

    // ---------- 操作日志（仅广播，不存状态） ----------
    _log(text, type = "info") {
      this.emit("log", { text, type });
    }

    // ============================================================
    // 存档（localStorage）
    // ============================================================
    save() {
      try {
        const s = this.state;
        if (!s) return;
        const data = {
          v: 2, // 存档版本
          deck: s.deck,
          hand: s.hand,
          // 小丑牌：存 id + 可变属性（edition）
          jokers: s.jokers.map((j) => ({ id: j.id, edition: j.edition || "none" })),
          // 消耗牌：存 id + kind
          consumables: s.consumables.map((c) => ({ id: c.id, kind: c.kind })),
          handLevels: s.handLevels,
          money: s.money,
          ante: s.ante,
          blindIndex: s.blindIndex,
          round: s.round,
          handsLeft: s.handsLeft,
          discardsLeft: s.discardsLeft,
          roundScore: s.roundScore,
          targetScore: s.targetScore,
          handTypePlays: s.handTypePlays,
          rideCounter: s.rideCounter,
          bossEffect: s.bossEffect,
          handSize: s.handSize,
          lockedHandType: s.lockedHandType,
          shopItems: this._serializeShop(s.shopItems, "joker"),
          shopPlanets: this._serializeShop(s.shopPlanets, "planet"),
          shopTarots: this._serializeShop(s.shopTarots, "tarot"),
          shopSpectrals: this._serializeShop(s.shopSpectrals, "spectral"),
          phase: this._phase || "play",
        };
        localStorage.setItem("funnybuddy_save", JSON.stringify(data));
      } catch (e) { /* 存储失败静默 */ }
    }
    _serializeShop(arr, type) {
      if (!arr) return [];
      return arr.map((it) => {
        if (type === "joker") return { id: it.joker.id, edition: it.edition, sold: it.sold };
        if (type === "planet") return { id: it.planet.id, sold: it.sold };
        if (type === "tarot") return { id: it.tarot.id, sold: it.sold };
        if (type === "spectral") return { id: it.spectral.id, sold: it.sold };
      });
    }
    hasSave() {
      try { return !!localStorage.getItem("funnybuddy_save"); } catch (e) { return false; }
    }
    clearSave() {
      try { localStorage.removeItem("funnybuddy_save"); } catch (e) { /* ignore */ }
    }
    // 读档：成功返回 true
    load() {
      try {
        const raw = localStorage.getItem("funnybuddy_save");
        if (!raw) return false;
        const d = JSON.parse(raw);
        if (!d || !d.deck) return false;

        const findJoker = (id) => JOKER_POOL.find((j) => j.id === id);
        const findPlanet = (id) => PLANET_POOL.find((p) => p.id === id);
        const findTarot = (id) => TAROT_POOL.find((t) => t.id === id);
        const findSpectral = (id) => SPECTRAL_POOL.find((sp) => sp.id === id);

        this.state = {
          deck: d.deck || [],
          hand: d.hand || [],
          selected: new Set(),
          jokers: (d.jokers || []).map((js) => {
            const base = findJoker(js.id);
            if (!base) return null;
            const inst = Object.assign({}, base);
            inst.edition = js.edition || "none";
            return inst;
          }).filter(Boolean),
          consumables: (d.consumables || []).map((cs) => {
            if (cs.kind === "planet") return findPlanet(cs.id);
            if (cs.kind === "tarot") return findTarot(cs.id);
            if (cs.kind === "spectral") return findSpectral(cs.id);
            return null;
          }).filter(Boolean),
          handLevels: d.handLevels || {},
          money: d.money ?? 4,
          ante: d.ante ?? 1,
          blindIndex: d.blindIndex ?? 0,
          round: d.round ?? 1,
          handsLeft: d.handsLeft ?? CONFIG.MAX_HANDS,
          discardsLeft: d.discardsLeft ?? CONFIG.MAX_DISCARDS,
          roundScore: d.roundScore ?? 0,
          targetScore: d.targetScore ?? 0,
          handTypePlays: d.handTypePlays || {},
          rideCounter: d.rideCounter || 0,
          bossEffect: d.bossEffect || null,
          handSize: d.handSize || CONFIG.HAND_SIZE,
          lockedHandType: d.lockedHandType || null,
          shopItems: (d.shopItems || []).map((it) => ({ joker: findJoker(it.id), edition: it.edition || "none", sold: it.sold })).filter((x) => x.joker),
          shopPlanets: (d.shopPlanets || []).map((it) => ({ planet: findPlanet(it.id), sold: it.sold })).filter((x) => x.planet),
          shopTarots: (d.shopTarots || []).map((it) => ({ tarot: findTarot(it.id), sold: it.sold })).filter((x) => x.tarot),
          shopSpectrals: (d.shopSpectrals || []).map((it) => ({ spectral: findSpectral(it.id), sold: it.sold })).filter((x) => x.spectral),
        };
        this._phase = d.phase || "play";
        this._log("📂 已读取上次存档，继续游戏", "good");
        return true;
      } catch (e) {
        return false;
      }
    }
    // 从存档恢复后，根据 phase 把界面带到正确状态
    resume() {
      if (this._phase === "blindSelect") {
        this.startBlindSelect();
      } else if (this._phase === "shop") {
        this.emit("shopOpen");
        this.emit("change");
      } else {
        // play 阶段：直接回到牌桌
        this.emit("change");
      }
    }

    // ---------- 生命周期 ----------
    newGame() {
      this.state = {
        deck: [],
        hand: [],
        selected: new Set(),
        jokers: [],
        consumables: [],          // 持有的消耗牌（行星/塔罗）
        handLevels: {},           // { 牌型key: 等级 }，缺省视为 1 级
        money: 4,
        ante: 1,
        blindIndex: 0,
        round: 1,
        handsLeft: CONFIG.MAX_HANDS,
        discardsLeft: CONFIG.MAX_DISCARDS,
        roundScore: 0,
        targetScore: 0,
        handTypePlays: {},
        rideCounter: 0,
        shopItems: [],
        shopPlanets: [],          // 商店出售的行星牌
        shopTarots: [],           // 商店出售的塔罗牌
        shopSpectrals: [],        // 商店出售的幻灵牌
        bossEffect: null,         // 当前 Boss debuff
      };
      this._phase = "blindSelect";
      this.clearSave();
      this._log("🎴 新游戏开始，祝你好运！", "good");
      this.startBlindSelect();
    }

    // ---------- 只读查询（供表现层渲染） ----------
    getState() {
      const s = this.state;
      const b = this.currentBlind();
      return {
        hand: s.hand,
        jokers: s.jokers,
        consumables: s.consumables,
        maxConsumables: CONFIG.MAX_CONSUMABLES,
        handLevels: s.handLevels,
        selected: s.selected,
        deckCount: s.deck.length,
        money: s.money,
        ante: s.ante,
        totalAnte: CONFIG.TOTAL_ANTE,
        round: s.round,
        handsLeft: s.handsLeft,
        discardsLeft: s.discardsLeft,
        maxJokers: CONFIG.MAX_JOKERS,
        roundScore: s.roundScore,
        targetScore: s.targetScore,
        blindName: b.name,
        blindReward: b.reward,
        blindKey: b.key,
        shopItems: s.shopItems,
        shopPlanets: s.shopPlanets,
        shopTarots: s.shopTarots,
        shopSpectrals: s.shopSpectrals,
        bossEffect: this.activeBossEffect(),
        deck: s.deck,
      };
    }

    // 当前所选牌组成的牌型预览（不修改状态）—— 含等级
    getHandPreview() {
      const sel = this.getSelectedCards();
      if (!sel.length) return null;
      const res = evaluateHand(sel);
      const st = getHandStats(res.typeKey, this.state.handLevels);
      return { name: st.name, baseChips: st.chips, baseMult: st.mult, level: st.level };
    }

    currentBlind() { return CONFIG.BLINDS[this.state.blindIndex]; }
    computeTarget() {
      const base = CONFIG.ANTE_BASE[this.state.ante - 1];
      let target = Math.round(base * this.currentBlind().mult);
      const boss = this.activeBossEffect();
      if (boss && boss.targetMult) target = Math.round(target * boss.targetMult);
      return target;
    }

    // ---------- 盲注选择 ----------
    startBlindSelect() {
      const s = this.state;
      const b = this.currentBlind();
      // Boss 盲注：随机选一个 debuff
      if (b.key === "boss") {
        const pool = CONFIG.BOSS_EFFECTS;
        s.bossEffect = pool[Math.floor(Math.random() * pool.length)];
      } else {
        s.bossEffect = null;
      }
      s.targetScore = this.computeTarget();
      this._phase = "blindSelect";
      const boss = this.activeBossEffect();
      this.emit("blindSelect", {
        ante: s.ante,
        totalAnte: CONFIG.TOTAL_ANTE,
        blindName: b.name,
        blindKey: b.key,
        blindDesc: boss ? `${boss.icon} ${boss.name}：${boss.desc}` : b.desc,
        reward: b.reward,
        target: s.targetScore,
        boss: boss ? { name: boss.name, icon: boss.icon, desc: boss.desc } : null,
      });
      this.emit("change");
    }

    // ---------- 回合开始 ----------
    startRound() {
      const s = this.state;
      const boss = this.activeBossEffect();
      s.deck = shuffle(buildDeck());
      s.hand = [];
      s.selected.clear();
      s.handsLeft = CONFIG.MAX_HANDS - ((boss && boss.handsPenalty) || 0);
      s.discardsLeft = CONFIG.MAX_DISCARDS - ((boss && boss.discardsPenalty) || 0);
      if (boss && boss.onlyOneHand) { s.handsLeft = 1; s.discardsLeft = CONFIG.MAX_DISCARDS + 2; }
      s.handSize = CONFIG.HAND_SIZE - ((boss && boss.handSizePenalty) || 0);
      s.lockedHandType = null; // 巨口：锁定的牌型
      s.roundScore = 0;
      s.handTypePlays = {};
      s.rideCounter = 0;
      s.targetScore = this.computeTarget();
      this.drawToFull();
      // 宅：起手 N 张盖牌
      if (boss && boss.faceDown) {
        const n = Math.min(boss.faceDown, s.hand.length);
        for (let i = 0; i < n; i++) s.hand[i].faceDown = true;
      }
      this.sortByRank();
      this._phase = "play";
      this._log(`▶ 进入 ${this.currentBlind().name}，目标分数 ${s.targetScore.toLocaleString()}`, "blind");
      if (boss) this._log(`${boss.icon} Boss 技能【${boss.name}】：${boss.desc}`, "bad");
      this.emit("roundStart");
      this.emit("change");
    }

    drawToFull() {
      const s = this.state;
      const cap = s.handSize || CONFIG.HAND_SIZE;
      while (s.hand.length < cap && s.deck.length) {
        s.hand.push(s.deck.pop());
      }
    }

    // ---------- 排序 ----------
    sortByRank() {
      this.state.hand.sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit));
      this.emit("change");
    }
    sortBySuit() {
      const order = { S: 0, H: 1, D: 2, C: 3 };
      this.state.hand.sort((a, b) => order[a.suit] - order[b.suit] || b.rank - a.rank);
      this.emit("change");
    }

    // ---------- 选牌 ----------
    toggleSelect(cardId) {
      const sel = this.state.selected;
      if (sel.has(cardId)) {
        sel.delete(cardId);
      } else {
        if (sel.size >= 5) return;
        sel.add(cardId);
      }
      this.emit("change");
    }
    getSelectedCards() {
      return this.state.hand.filter((c) => this.state.selected.has(c.id));
    }
    canPlay() { return this.state.selected.size > 0 && this.state.handsLeft > 0; }
    canDiscard() { return this.state.selected.size > 0 && this.state.discardsLeft > 0; }

    // ---------- 出牌计分（纯计算，产出可供动画播放的步骤序列） ----------
    // 该方法会更新除 roundScore 外的逻辑状态；roundScore 在 finishScoring 中应用，
    // 以便表现层有时间播放逐步累加的动画。
    playHand() {
      const s = this.state;
      const sel = this.getSelectedCards();
      s.handsLeft--;

      const played = sel.slice();
      s.hand = s.hand.filter((c) => !s.selected.has(c.id));
      s.selected.clear();

      const res = evaluateHand(played);
      const boss = this.activeBossEffect(); // Boss debuff
      // 巨臂：牌型降 1 级计分（最低 1 级）
      let st = getHandStats(res.typeKey, s.handLevels);
      if (boss && boss.handLevelPenalty) {
        const lowered = {};
        lowered[res.typeKey] = Math.max(1, (s.handLevels[res.typeKey] || 1) - boss.handLevelPenalty);
        st = getHandStats(res.typeKey, lowered);
      }

      // Boss debuff：过滤不计分的牌
      let scoringCards = res.scoringCards.slice();
      if (boss && boss.debuffSuit) {
        scoringCards = scoringCards.filter((c) => c.suit !== boss.debuffSuit);
      }
      if (boss && boss.debuffFace) {
        scoringCards = scoringCards.filter((c) => !isFace(c));
      }
      if (boss && boss.debuffFirst && scoringCards.length) {
        scoringCards = scoringCards.slice(1); // 去掉首张
      }
      const scoringIds = new Set(scoringCards.map((c) => c.id));

      // 巨口：锁定首个打出的牌型，之后只能打同牌型
      if (boss && boss.oneHandType) {
        if (!s.lockedHandType) {
          s.lockedHandType = res.typeKey;
        } else if (s.lockedHandType !== res.typeKey) {
          // 违反锁定：本次出牌作废（不计分，返还出牌次数）
          s.handsLeft++;
          // 把牌放回手牌
          s.hand = s.hand.concat(played);
          this.sortByRank();
          return { invalid: true, reason: "oneHandType", lockedName: HAND_TYPES[s.lockedHandType].name };
        }
      }

      // 牌型打出次数（含本次，供 supernova）
      s.handTypePlays[res.typeKey] = (s.handTypePlays[res.typeKey] || 0) + 1;
      // 公车惊魂连击（含本次）
      const hadFace = played.some(isFace);
      s.rideCounter = hadFace ? 0 : s.rideCounter + 1;

      // 收集计分步骤
      const steps = [];
      const moneyEvents = []; // 计分过程中产生的金钱（幸运牌/金封）
      let chips = st.chips;
      let mult = st.mult;
      let xmult = 1;

      // 1) 参与计分的牌逐张结算（含增强/版本/封）
      // 红封：本张牌重复触发一次
      for (const c of played) {
        if (!scoringIds.has(c.id)) continue;
        const triggerTimes = c.seal === "red" ? 2 : 1;
        for (let t = 0; t < triggerTimes; t++) {
          const detail = this._scoreCard(c, moneyEvents);
          chips += detail.chips;
          mult += detail.mult;
          xmult *= detail.xmult;
          steps.push({
            kind: "card",
            cardId: c.id,
            chips: detail.chips,
            dMult: detail.mult || null,
            xmult: detail.xmult !== 1 ? round2(xmult) : null,
            runChips: chips,
            runMult: mult,
            repeat: t > 0,
            tags: detail.tags,
          });
        }
        // 金封：计分后 +$3
        if (c.seal === "gold") moneyEvents.push({ cardId: c.id, amount: 3, reason: "金封" });
      }

      // 2) 小丑牌逐张结算
      const ctx = {
        chips, mult, xmult,
        scoringCards,
        playedCards: played,
        handTypeKey: res.typeKey,
        game: s,
      };
      s.jokers.forEach((j, idx) => {
        const before = { chips: ctx.chips, mult: ctx.mult, xmult: ctx.xmult };
        const triggered = j.effect(ctx);
        // 小丑牌自身版本加成（foil/holo/poly）
        const ed = EDITIONS[j.edition || "none"];
        let edApplied = false;
        if (ed && ed.key !== "none") {
          if (ed.chips) ctx.chips += ed.chips;
          if (ed.mult) ctx.mult += ed.mult;
          if (ed.xmult) ctx.xmult *= ed.xmult;
          edApplied = !!(ed.chips || ed.mult || ed.xmult);
        }
        if (triggered || edApplied) {
          // 选择触发特效（逻辑/表现分离的数据契约）：
          // 优先采用小丑牌自己声明的 fx；未声明时按数值变化兜底推断。
          // 任何带 xmult 变化（含 polychrome 版本）一律升级为 xmult 高光特效。
          let fxKey = j.fx;
          if (ctx.xmult !== before.xmult) fxKey = "xmult";
          else if (!fxKey) fxKey = (ctx.mult !== before.mult) ? "mult" : "chips";
          steps.push({
            kind: "joker",
            jokerIndex: idx,
            fx: JOKER_FX[fxKey] || JOKER_FX.chips,
            dChips: ctx.chips - before.chips,
            dMult: ctx.mult - before.mult,
            xmult: ctx.xmult !== before.xmult ? round2(ctx.xmult) : null,
            runChips: ctx.chips,
            runMult: ctx.mult,
          });
        }
      });

      chips = ctx.chips; mult = ctx.mult; xmult = ctx.xmult;

      const finalChips = Math.round(chips);
      const finalMult = mult * xmult;
      const gained = Math.round(finalChips * finalMult);
      const projected = s.roundScore + gained;

      // 记录本次计分待结算的副作用（动画后在 finishScoring 处理）
      this._pendingSideEffects = {
        moneyEvents,
        playedCards: played,
      };

      let outcome = "continue";
      if (projected >= s.targetScore) outcome = "win";
      else if (s.handsLeft <= 0) outcome = "lose";

      return {
        handType: { key: res.typeKey, name: st.name, level: st.level },
        played,
        scoringIds,
        steps,
        moneyEvents,
        baseChips: st.chips,
        baseMult: st.mult,
        finalChips,
        finalMult,
        gained,
        newRoundScore: projected,
        outcome,
      };
    }

    // 单张牌计分：返回 { chips, mult, xmult, tags[] }
    _scoreCard(c, moneyEvents) {
      let chips = 0, mult = 0, xmult = 1;
      const tags = [];
      // 石头牌无点数，但增强里自带 chips；其它牌用牌面 chips
      if (c.enhancement !== "stone") {
        chips += c.chips;
      }
      // 增强
      const enh = ENHANCEMENTS[c.enhancement || "none"];
      if (enh) {
        if (enh.chips) { chips += enh.chips; tags.push("enh"); }
        if (enh.mult) { mult += enh.mult; tags.push("enh"); }
        if (enh.xmult) { xmult *= enh.xmult; tags.push("enh"); }
        if (c.enhancement === "lucky") {
          if (Math.random() < 0.2) { mult += 20; tags.push("lucky"); }
          if (Math.random() < 1 / 15) { moneyEvents.push({ cardId: c.id, amount: 20, reason: "幸运" }); tags.push("luckymoney"); }
        }
      }
      // 版本
      const ed = EDITIONS[c.edition || "none"];
      if (ed && ed.key !== "none") {
        if (ed.chips) { chips += ed.chips; tags.push("edition"); }
        if (ed.mult) { mult += ed.mult; tags.push("edition"); }
        if (ed.xmult) { xmult *= ed.xmult; tags.push("edition"); }
      }
      return { chips, mult, xmult, tags };
    }

    // 动画播放完成后调用：落实分数并推进流程
    finishScoring(result) {
      const s = this.state;
      s.roundScore = result.newRoundScore;
      this._log(
        `🃏 打出【${result.handType.name}】 ${result.finalChips}×${Math.round(result.finalMult * 100) / 100} = +${result.gained.toLocaleString()} 分`,
        "play"
      );

      // 计分副作用：金钱事件（幸运牌/金封）
      if (result.moneyEvents && result.moneyEvents.length) {
        let total = 0;
        for (const ev of result.moneyEvents) total += ev.amount;
        if (total > 0) {
          s.money += total;
          this._log(`💵 卡牌效果获得 +$${total}`, "buy");
        }
      }
      // 玻璃牌：计分后按概率碎裂（从牌组移除——这里只在打出的牌里，已离开手牌，
      // 仅作日志提示，真实 Balatro 是从牌库永久移除，这里简单处理）
      if (result.played) {
        for (const c of result.played) {
          if (c.enhancement === "glass" && Math.random() < 0.25) {
            this._removeFromDeck(c.id);
            this._log(`💥 玻璃牌【${c.label}${c.symbol}】碎裂`, "bad");
          }
        }
      }

      if (result.outcome === "win") {
        this.winRound();
        return;
      }
      if (result.outcome === "lose") {
        this._log(`💀 出牌用尽，未达目标分数，挑战失败`, "bad");
        this.emit("change");
        this.emit("gameLose", {
          ante: this.state.ante,
          blindName: this.currentBlind().name,
          target: this.state.targetScore,
          score: this.state.roundScore,
        });
        return;
      }
      // Boss 钩子：出牌后随机弃掉 N 张手牌
      const boss = this.activeBossEffect();
      if (boss && boss.discardAfterPlay && s.hand.length) {
        const n = Math.min(boss.discardAfterPlay, s.hand.length);
        for (let i = 0; i < n; i++) {
          const idx = Math.floor(Math.random() * s.hand.length);
          const removed = s.hand.splice(idx, 1)[0];
          this._log(`🪝 钩子弃掉【${removed.label}${removed.symbol}】`, "discard");
        }
      }
      this.drawToFull();
      this.sortByRank(); // 内部已 emit change
    }

    // 从牌库/手牌移除某张牌（玻璃碎裂用）
    _removeFromDeck(cardId) {
      const s = this.state;
      s.deck = s.deck.filter((c) => c.id !== cardId);
      s.hand = s.hand.filter((c) => c.id !== cardId);
    }

    // 当前 Boss 盲注的 debuff 效果（仅 boss 盲注且已配置时返回）
    activeBossEffect() {
      const b = this.currentBlind();
      if (b.key !== "boss") return null;
      return this.state.bossEffect || null;
    }

    // ---------- 弃牌 ----------
    discardHand() {
      const s = this.state;
      if (s.discardsLeft <= 0 || s.selected.size === 0) return;
      const n = s.selected.size;
      s.discardsLeft--;
      s.hand = s.hand.filter((c) => !s.selected.has(c.id));
      s.selected.clear();
      this.drawToFull();
      this.sortByRank();
      this._log(`🗑 弃掉 ${n} 张牌（剩余弃牌 ${s.discardsLeft}）`, "discard");
    }

    // ---------- 过关结算 ----------
    winRound() {
      const s = this.state;
      const b = this.currentBlind();
      const reward = b.reward;
      const handBonus = s.handsLeft;
      const interest = Math.min(5, Math.floor(s.money / 5));
      // 小丑牌被动金钱（金券等）
      let jokerMoney = 0;
      for (const j of s.jokers) if (j.passiveMoney) jokerMoney += j.passiveMoney;
      // 黄金牌：留在手牌的黄金牌每张 +$3（其它增强的 endMoney 通用）
      let goldMoney = 0;
      for (const c of s.hand) {
        const enh = ENHANCEMENTS[c.enhancement || "none"];
        if (enh && enh.endMoney) goldMoney += enh.endMoney;
      }
      const total = reward + handBonus + interest + jokerMoney + goldMoney;
      s.money += total;
      let extra = "";
      if (jokerMoney) extra += ` + 小丑 $${jokerMoney}`;
      if (goldMoney) extra += ` + 黄金牌 $${goldMoney}`;
      this._log(`✅ 过关！奖励 $${reward} + 剩牌 $${handBonus} + 利息 $${interest}${extra} = +$${total}`, "good");
      this.emit("change");
      this.emit("roundWin", { reward, handBonus, interest, jokerMoney, goldMoney, total });
      this.openShop(true);
    }

    // ---------- 商店 ----------
    // reroll=true 时强制刷新（用于过关后第一次开店）；
    // 默认 false：如果商店里还有未售出的物品就保留，避免"开关商店当作免费刷新"。
    openShop(reroll = false) {
      const s = this.state;
      const hasItems = (s.shopItems && s.shopItems.some((it) => !it.sold)) ||
                       (s.shopPlanets && s.shopPlanets.some((it) => !it.sold)) ||
                       (s.shopTarots && s.shopTarots.some((it) => !it.sold)) ||
                       (s.shopSpectrals && s.shopSpectrals.some((it) => !it.sold));
      if (reroll || !hasItems) {
        s.shopItems = this.rollShop();
        s.shopPlanets = this.rollPlanets();
        s.shopTarots = this.rollTarots();
        s.shopSpectrals = this.rollSpectrals();
      }
      this._phase = "shop";
      this.emit("shopOpen");
      this.emit("change");
    }
    rollShop() {
      const ownedIds = new Set(this.state.jokers.map((j) => j.id));
      const pool = JOKER_POOL.filter((j) => !ownedIds.has(j.id));
      shuffle(pool);
      const n = Math.min(2, pool.length) + (Math.random() < 0.5 ? 1 : 0);
      return pool.slice(0, Math.min(n, pool.length)).map((j) => ({
        joker: j,
        edition: this._rollJokerEdition(),
        sold: false,
      }));
    }
    // 小丑牌版本掉落：约 15% 概率附带版本
    _rollJokerEdition() {
      const r = Math.random();
      if (r < 0.05) return "polychrome";   // 5%
      if (r < 0.10) return "holographic";  // 5%
      if (r < 0.15) return "foil";         // 5%
      return "none";
    }
    // 滚动出售的行星牌（1~2 张）
    rollPlanets() {
      const pool = PLANET_POOL.slice();
      shuffle(pool);
      const n = 1 + (Math.random() < 0.5 ? 1 : 0);
      return pool.slice(0, n).map((p) => ({ planet: p, sold: false }));
    }
    // 滚动出售的塔罗牌（1~2 张）
    rollTarots() {
      const pool = TAROT_POOL.slice();
      shuffle(pool);
      const n = 1 + (Math.random() < 0.5 ? 1 : 0);
      return pool.slice(0, n).map((t) => ({ tarot: t, sold: false }));
    }
    // 滚动出售的幻灵牌（约 45% 概率出 1 张，较稀有）
    rollSpectrals() {
      if (!SPECTRAL_POOL.length || Math.random() > 0.45) return [];
      const pool = SPECTRAL_POOL.slice();
      shuffle(pool);
      return pool.slice(0, 1).map((sp) => ({ spectral: sp, sold: false }));
    }
    buyJoker(idx) {
      const s = this.state;
      const item = s.shopItems[idx];
      if (!item || item.sold) return { ok: false };
      if (s.money < item.joker.price) return { ok: false, reason: "money" };
      if (s.jokers.length >= CONFIG.MAX_JOKERS) return { ok: false, reason: "full" };
      s.money -= item.joker.price;
      // 拷贝一份小丑牌实例（避免污染图鉴），并按概率附加版本
      const inst = Object.assign({}, item.joker);
      inst.edition = item.edition || "none";
      s.jokers.push(inst);
      item.sold = true;
      const edName = inst.edition !== "none" ? `（${EDITIONS[inst.edition].name}）` : "";
      this._log(`🛒 购买小丑牌【${item.joker.name}】${edName} -$${item.joker.price}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    // 购买行星牌：放入消耗牌槽位（不会自动使用，需玩家在局内/商店点击使用）
    buyPlanet(idx) {
      const s = this.state;
      const item = s.shopPlanets[idx];
      if (!item || item.sold) return { ok: false };
      if (s.money < item.planet.price) return { ok: false, reason: "money" };
      if (s.consumables.length >= CONFIG.MAX_CONSUMABLES) return { ok: false, reason: "full" };
      s.money -= item.planet.price;
      s.consumables.push(item.planet);
      item.sold = true;
      this._log(`🛒 购买行星牌【${item.planet.name}】 -$${item.planet.price}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    // 购买塔罗牌：放入消耗牌槽位
    buyTarot(idx) {
      const s = this.state;
      const item = s.shopTarots[idx];
      if (!item || item.sold) return { ok: false };
      if (s.money < item.tarot.price) return { ok: false, reason: "money" };
      if (s.consumables.length >= CONFIG.MAX_CONSUMABLES) return { ok: false, reason: "full" };
      s.money -= item.tarot.price;
      s.consumables.push(item.tarot);
      item.sold = true;
      this._log(`🛒 购买塔罗牌【${item.tarot.name}】 -$${item.tarot.price}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    // 购买幻灵牌：放入消耗牌槽位
    buySpectral(idx) {
      const s = this.state;
      const item = s.shopSpectrals[idx];
      if (!item || item.sold) return { ok: false };
      if (s.money < item.spectral.price) return { ok: false, reason: "money" };
      if (s.consumables.length >= CONFIG.MAX_CONSUMABLES) return { ok: false, reason: "full" };
      s.money -= item.spectral.price;
      s.consumables.push(item.spectral);
      item.sold = true;
      this._log(`🛒 购买幻灵牌【${item.spectral.name}】 -$${item.spectral.price}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    reroll() {
      const s = this.state;
      if (s.money < CONFIG.REROLL_COST) return { ok: false };
      s.money -= CONFIG.REROLL_COST;
      s.shopItems = this.rollShop();
      s.shopPlanets = this.rollPlanets();
      s.shopTarots = this.rollTarots();
      s.shopSpectrals = this.rollSpectrals();
      this._log(`🔄 刷新商店 -$${CONFIG.REROLL_COST}`, "info");
      this.emit("change");
      return { ok: true };
    }

    // ---------- 消耗牌使用 ----------
    // 行星牌 → 升级牌型；塔罗牌 → 改造选中的手牌（selectedCardIds）。
    useConsumable(idx, selectedCardIds) {
      const s = this.state;
      const c = s.consumables[idx];
      if (!c) return { ok: false };

      if (c.kind === "planet") {
        this.levelUpHand(c.target);
        s.consumables.splice(idx, 1);
        this.emit("consumableUsed", { kind: "planet", target: c.target });
        this.emit("change");
        return { ok: true, kind: "planet", target: c.target };
      }

      if (c.kind === "tarot" || c.kind === "spectral") {
        const [min, max] = c.needCards || [0, 0];
        const ids = selectedCardIds || [];
        // 需要选牌但数量不符 → 要求外层进入选牌模式
        if (max > 0) {
          if (ids.length < min || ids.length > max) {
            return { ok: false, reason: "needSelect", min, max, name: c.name, desc: c.desc };
          }
        }
        const chosen = s.hand.filter((card) => ids.includes(card.id));
        // 给 apply 提供造牌/取 id 工具
        s._makeRandomCard = (rank) => makeRandomCard(rank);
        s._nextCardId = () => nextCardId();
        const note = c.apply(chosen, s) || "";
        s.consumables.splice(idx, 1);
        const label = c.kind === "tarot" ? "塔罗牌" : "幻灵牌";
        const icon = c.kind === "tarot" ? "🔮" : "👻";
        this.emit("consumableUsed", { kind: c.kind, name: c.name, note, cardIds: ids });
        this._log(`${icon} 使用${label}【${c.name}】 ${note}`, "good");
        this.emit("change");
        return { ok: true, kind: c.kind, name: c.name, note };
      }
      return { ok: false };
    }
    // 卖出消耗牌（半价）
    sellConsumable(idx) {
      const s = this.state;
      const c = s.consumables[idx];
      if (!c) return 0;
      const value = Math.max(1, Math.floor((c.price || 2) / 2));
      s.consumables.splice(idx, 1);
      s.money += value;
      this._log(`💰 卖出【${c.name}】 +$${value}`, "buy");
      this.emit("change");
      return value;
    }
    // 升级牌型等级
    levelUpHand(typeKey) {
      const s = this.state;
      s.handLevels[typeKey] = (s.handLevels[typeKey] || 1) + 1;
      const st = getHandStats(typeKey, s.handLevels);
      this._log(`🪐 牌型【${HAND_TYPES[typeKey].name}】升至 Lv.${st.level}（${st.chips}×${st.mult}）`, "good");
      return st.level;
    }
    sellJoker(idx) {
      const s = this.state;
      const j = s.jokers[idx];
      if (!j) return 0;
      const value = Math.max(1, Math.floor(j.price / 2));
      s.jokers.splice(idx, 1);
      s.money += value;
      this._log(`💰 卖出小丑牌【${j.name}】 +$${value}`, "buy");
      this.emit("change");
      return value;
    }

    // 调整小丑牌顺序（拖拽重排用；位置影响触发顺序）
    reorderJokers(fromIdx, toIdx) {
      const arr = this.state.jokers;
      if (fromIdx === toIdx) return false;
      if (fromIdx < 0 || fromIdx >= arr.length) return false;
      if (toIdx < 0 || toIdx > arr.length) return false;
      const [moved] = arr.splice(fromIdx, 1);
      // 删除后插入位置可能偏移
      const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
      arr.splice(insertAt, 0, moved);
      this._log(`↔ 调整小丑牌【${moved.name}】位置`, "info");
      this.emit("change");
      return true;
    }

    // ---------- 进入下一回合 ----------
    nextRound() {
      const s = this.state;
      s.blindIndex++;
      if (s.blindIndex > 2) {
        s.blindIndex = 0;
        s.ante++;
        if (s.ante > CONFIG.TOTAL_ANTE) {
          this._log("🏆 通关胜利！你是真正的小丑牌大师！", "good");
          this.emit("gameWin", { money: s.money });
          return;
        }
      }
      s.round++;
      this.startBlindSelect();
    }
  }

  window.GameCore = GameCore;
})();
