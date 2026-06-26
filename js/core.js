/* ============================================================
 * core.js —— 逻辑层（GameCore）
 * 纯游戏状态与规则，不依赖任何 DOM。
 * 通过事件（emit/on）向外界（表现层）广播状态变化，
 * 通过方法接收外界（控制层）的操作指令。
 * ============================================================ */
(function () {
  const { HAND_TYPES, buildDeck, shuffle, evaluateHand } = window.Cards;
  const { JOKER_POOL } = window.Jokers;

  // ---------- 规则常量 ----------
  const CONFIG = {
    ANTE_BASE: [300, 800, 2000, 5000, 11000, 20000, 35000, 50000],
    BLINDS: [
      { key: "small", name: "小盲注", mult: 1, reward: 3, desc: "普通盲注" },
      { key: "big", name: "大盲注", mult: 1.5, reward: 4, desc: "普通盲注" },
      { key: "boss", name: "Boss盲注", mult: 2, reward: 5, desc: "高额目标，全力以赴！" },
    ],
    HAND_SIZE: 8,
    MAX_HANDS: 4,
    MAX_DISCARDS: 3,
    MAX_JOKERS: 5,
    TOTAL_ANTE: 8,
    REROLL_COST: 5,
  };

  const isFace = (c) => c.rank >= 11 && c.rank <= 13;

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

    // ---------- 操作日志（仅广播，不存状态） ----------
    _log(text, type = "info") {
      this.emit("log", { text, type });
    }

    // ---------- 生命周期 ----------
    newGame() {
      this.state = {
        deck: [],
        hand: [],
        selected: new Set(),
        jokers: [],
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
      };
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
      };
    }

    // 当前所选牌组成的牌型预览（不修改状态）
    getHandPreview() {
      const sel = this.getSelectedCards();
      if (!sel.length) return null;
      const res = evaluateHand(sel);
      const ht = HAND_TYPES[res.typeKey];
      return { name: ht.name, baseChips: ht.chips, baseMult: ht.mult };
    }

    currentBlind() { return CONFIG.BLINDS[this.state.blindIndex]; }
    computeTarget() {
      const base = CONFIG.ANTE_BASE[this.state.ante - 1];
      return Math.round(base * this.currentBlind().mult);
    }

    // ---------- 盲注选择 ----------
    startBlindSelect() {
      this.state.targetScore = this.computeTarget();
      const b = this.currentBlind();
      this.emit("blindSelect", {
        ante: this.state.ante,
        totalAnte: CONFIG.TOTAL_ANTE,
        blindName: b.name,
        blindKey: b.key,
        blindDesc: b.desc,
        reward: b.reward,
        target: this.state.targetScore,
      });
      this.emit("change");
    }

    // ---------- 回合开始 ----------
    startRound() {
      const s = this.state;
      s.deck = shuffle(buildDeck());
      s.hand = [];
      s.selected.clear();
      s.handsLeft = CONFIG.MAX_HANDS;
      s.discardsLeft = CONFIG.MAX_DISCARDS;
      s.roundScore = 0;
      s.handTypePlays = {};
      s.rideCounter = 0;
      s.targetScore = this.computeTarget();
      this.drawToFull();
      this.sortByRank();
      this._log(`▶ 进入 ${this.currentBlind().name}，目标分数 ${s.targetScore.toLocaleString()}`, "blind");
      this.emit("roundStart");
      this.emit("change");
    }

    drawToFull() {
      const s = this.state;
      while (s.hand.length < CONFIG.HAND_SIZE && s.deck.length) {
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
      const ht = HAND_TYPES[res.typeKey];
      const scoringIds = new Set(res.scoringCards.map((c) => c.id));

      // 牌型打出次数（含本次，供 supernova）
      s.handTypePlays[res.typeKey] = (s.handTypePlays[res.typeKey] || 0) + 1;
      // 公车惊魂连击（含本次）
      const hadFace = played.some(isFace);
      s.rideCounter = hadFace ? 0 : s.rideCounter + 1;

      // 收集计分步骤
      const steps = [];
      let chips = ht.chips;
      let mult = ht.mult;

      // 1) 参与计分的牌逐张加筹码
      for (const c of played) {
        if (!scoringIds.has(c.id)) continue;
        chips += c.chips;
        steps.push({ kind: "card", cardId: c.id, chips: c.chips, runChips: chips, runMult: mult });
      }

      // 2) 小丑牌逐张结算
      const ctx = {
        chips, mult, xmult: 1,
        scoringCards: res.scoringCards,
        playedCards: played,
        handTypeKey: res.typeKey,
        game: s,
      };
      s.jokers.forEach((j, idx) => {
        const before = { chips: ctx.chips, mult: ctx.mult, xmult: ctx.xmult };
        const triggered = j.effect(ctx);
        if (triggered) {
          steps.push({
            kind: "joker",
            jokerIndex: idx,
            dChips: ctx.chips - before.chips,
            dMult: ctx.mult - before.mult,
            xmult: ctx.xmult !== before.xmult ? ctx.xmult : null,
            runChips: ctx.chips,
            runMult: ctx.mult,
          });
        }
      });

      const finalChips = Math.round(ctx.chips);
      const finalMult = ctx.mult * ctx.xmult;
      const gained = Math.round(finalChips * finalMult);
      const projected = s.roundScore + gained;

      let outcome = "continue";
      if (projected >= s.targetScore) outcome = "win";
      else if (s.handsLeft <= 0) outcome = "lose";

      return {
        handType: { key: res.typeKey, name: ht.name },
        played,
        scoringIds,
        steps,
        baseChips: ht.chips,
        baseMult: ht.mult,
        finalChips,
        finalMult,
        gained,
        newRoundScore: projected,
        outcome,
      };
    }

    // 动画播放完成后调用：落实分数并推进流程
    finishScoring(result) {
      this.state.roundScore = result.newRoundScore;
      this._log(
        `🃏 打出【${result.handType.name}】 ${result.finalChips}×${Math.round(result.finalMult * 100) / 100} = +${result.gained.toLocaleString()} 分`,
        "play"
      );
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
      this.drawToFull();
      this.sortByRank(); // 内部已 emit change
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
      const total = reward + handBonus + interest;
      s.money += total;
      this._log(`✅ 过关！奖励 $${reward} + 剩牌 $${handBonus} + 利息 $${interest} = +$${total}`, "good");
      this.emit("change");
      this.emit("roundWin", { reward, handBonus, interest, total });
      this.openShop();
    }

    // ---------- 商店 ----------
    openShop() {
      this.state.shopItems = this.rollShop();
      this.emit("shopOpen");
      this.emit("change");
    }
    rollShop() {
      const ownedIds = new Set(this.state.jokers.map((j) => j.id));
      const pool = JOKER_POOL.filter((j) => !ownedIds.has(j.id));
      shuffle(pool);
      const n = Math.min(2, pool.length) + (Math.random() < 0.5 ? 1 : 0);
      return pool.slice(0, Math.min(n, pool.length)).map((j) => ({ joker: j, sold: false }));
    }
    buyJoker(idx) {
      const s = this.state;
      const item = s.shopItems[idx];
      if (!item || item.sold) return { ok: false };
      if (s.money < item.joker.price) return { ok: false, reason: "money" };
      if (s.jokers.length >= CONFIG.MAX_JOKERS) return { ok: false, reason: "full" };
      s.money -= item.joker.price;
      s.jokers.push(item.joker);
      item.sold = true;
      this._log(`🛒 购买小丑牌【${item.joker.name}】 -$${item.joker.price}`, "buy");
      this.emit("change");
      return { ok: true };
    }
    reroll() {
      const s = this.state;
      if (s.money < CONFIG.REROLL_COST) return { ok: false };
      s.money -= CONFIG.REROLL_COST;
      s.shopItems = this.rollShop();
      this._log(`🔄 刷新商店 -$${CONFIG.REROLL_COST}`, "info");
      this.emit("change");
      return { ok: true };
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
