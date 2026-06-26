/* ============================================================
 * app.js —— 控制层（入口）
 * 负责实例化逻辑层(GameCore)与表现层(GameView)，
 * 把用户操作（handlers）连接到逻辑层，
 * 把逻辑层事件连接到表现层渲染，并协调计分动画的异步流程。
 * 自身不包含游戏规则，也不直接操作 DOM。
 * ============================================================ */
(function () {
  const core = new window.GameCore();

  // 动画进行中标志，防止重复操作
  let busy = false;

  // ---------- 注入给表现层的只读查询 ----------
  const query = {
    getState: () => core.getState(),
    getHandPreview: () => core.getHandPreview(),
  };

  // ---------- 注入给表现层的用户操作回调 ----------
  const handlers = {
    onCardClick: (id) => {
      if (busy) return;
      core.toggleSelect(id);
    },
    onPlay: async () => {
      if (busy || !core.canPlay()) return;
      busy = true;
      view.lockActions();
      const result = core.playHand();
      // Boss 巨口：牌型不符被拒
      if (result && result.invalid) {
        busy = false;
        view.updateActionButtons();
        view.toastCenter("👄 只能打出【" + result.lockedName + "】");
        view.screenShake();
        return;
      }
      await view.animateScore(result);
      core.finishScoring(result);
      busy = false;
      view.updateActionButtons();
    },
    onDiscard: () => {
      if (busy || !core.canDiscard()) return;
      core.discardHand();
    },
    onSortRank: () => { if (!busy) core.sortByRank(); },
    onSortSuit: () => { if (!busy) core.sortBySuit(); },
    // 从牌桌区点击/长按触发：需要二次确认（已由 view 内部 confirm 处理）
    // 从商店"卖出"按钮触发：商店按钮已自己 confirm
    onSellJoker: (idx) => {
      if (busy) return;
      const s = core.getState();
      const j = s.jokers[idx];
      if (!j) return;
      core.sellJoker(idx);
      if (!isShopHidden()) view.renderShop();
    },
    onBuyJoker: (idx) => {
      const res = core.buyJoker(idx);
      if (res && res.ok) {
        if (window.SFX) window.SFX.buy();
      } else if (!res.ok && res.reason === "full") {
        alert("小丑牌已满（上限 " + core.CONFIG.MAX_JOKERS + " 张），请先卖出。");
      }
      view.renderShop();
    },
    onReorderJoker: (from, to) => {
      core.reorderJokers(from, to);
      if (!isShopHidden()) view.renderShop();
    },
    onUseConsumable: (idx) => {
      if (busy) return;
      // 先尝试直接使用（无需选牌的：行星牌、隐士等）
      const res = core.useConsumable(idx, []);
      if (res && res.ok) {
        if (window.SFX) window.SFX.buy();
        if (!isShopHidden()) view.renderShop();
        return;
      }
      // 需要选牌 → 进入塔罗选牌模式
      if (res && res.reason === "needSelect") {
        if (!isShopHidden()) {
          alert("请先关闭商店，回到牌桌选择要改造的手牌后再使用。");
          return;
        }
        tarotSelect = { idx, min: res.min, max: res.max, name: res.name, chosen: new Set() };
        view.enterTarotMode(tarotSelect);
      }
    },
    onTarotConfirm: () => {
      if (!tarotSelect) return;
      const ids = Array.from(tarotSelect.chosen);
      const res = core.useConsumable(tarotSelect.idx, ids);
      if (res && res.ok) {
        if (window.SFX) window.SFX.buy();
        view.exitTarotMode();
        tarotSelect = null;
      } else if (res && res.reason === "needSelect") {
        view.flashTarotHint(`需选择 ${res.min}~${res.max} 张牌`);
      }
    },
    onTarotCancel: () => {
      view.exitTarotMode();
      tarotSelect = null;
    },
    onTarotCardClick: (id) => {
      if (!tarotSelect) return;
      const set = tarotSelect.chosen;
      if (set.has(id)) set.delete(id);
      else {
        if (set.size >= tarotSelect.max) return;
        set.add(id);
      }
      view.updateTarotSelection(tarotSelect);
    },
    onSellConsumable: (idx) => {
      if (busy) return;
      const s = core.getState();
      const c = s.consumables[idx];
      if (!c) return;
      core.sellConsumable(idx);
      if (window.SFX) window.SFX.coin();
      if (!isShopHidden()) view.renderShop();
    },
    onBuyPlanet: (idx) => {
      const res = core.buyPlanet(idx);
      if (res && res.ok) {
        if (window.SFX) window.SFX.buy();
      } else if (!res.ok && res.reason === "full") {
        alert("消耗牌已满（上限 " + core.CONFIG.MAX_CONSUMABLES + " 张），请先使用或卖出。");
      }
      view.renderShop();
    },
    onBuyTarot: (idx) => {
      const res = core.buyTarot(idx);
      if (res && res.ok) {
        if (window.SFX) window.SFX.buy();
      } else if (!res.ok && res.reason === "full") {
        alert("消耗牌已满（上限 " + core.CONFIG.MAX_CONSUMABLES + " 张），请先使用或卖出。");
      }
      view.renderShop();
    },
    onBuySpectral: (idx) => {
      const res = core.buySpectral(idx);
      if (res && res.ok) {
        if (window.SFX) window.SFX.buy();
      } else if (!res.ok && res.reason === "full") {
        alert("消耗牌已满（上限 " + core.CONFIG.MAX_CONSUMABLES + " 张），请先使用或卖出。");
      }
      view.renderShop();
    },
    onReroll: () => { core.reroll(); view.renderShop(); },
    onNextRound: () => {
      view.hideShop();
      if (shopOpenedFrom === "blindSelect") {
        // 从盲注选择阶段进的商店：关闭后回到盲注选择
        shopOpenedFrom = null;
        core.startBlindSelect();
      } else {
        // 默认：回合胜利后进的商店，关闭即推进到下一盲注
        shopOpenedFrom = null;
        core.nextRound();
      }
    },
    onOpenShop: () => {
      // 在盲注选择阶段也允许开商店
      shopOpenedFrom = "blindSelect";
      view.hideBlindSelect();
      core.openShop();
    },
    onRestart: () => { view.hideEnd(); core.newGame(); },
  };

  // 记录商店打开的来源："roundWin" | "blindSelect"
  let shopOpenedFrom = null;
  // 塔罗选牌模式状态：{ idx, min, max, name, chosen:Set }
  let tarotSelect = null;

  const view = new window.GameView(query, handlers);

  const isShopHidden = () =>
    document.getElementById("shopOverlay").classList.contains("hidden");

  // ============================================================
  // 逻辑层事件 -> 表现层渲染
  // ============================================================
  // 下一次 change 渲染时是否播放发牌动画
  let pendingDeal = false;

  core.on("change", () => {
    view.renderAll();
    if (pendingDeal) {
      view.renderHand(true);
      pendingDeal = false;
    }
  });

  // 操作日志
  core.on("log", (entry) => view.addLog(entry));

  // 回合开始：标记下一帧播放发牌动画
  core.on("roundStart", () => { pendingDeal = true; });

  core.on("blindSelect", (data) => {
    view.showBlindSelect(data, () => {
      view.hideBlindSelect();
      core.startRound();
    });
  });

  core.on("roundWin", (breakdown) => {
    view.floaterMoney("+$" + breakdown.total);
    view.flash("gold");
  });

  core.on("shopOpen", () => {
    if (!shopOpenedFrom) shopOpenedFrom = "roundWin";
    view.showShop();
  });

  // 使用消耗牌特效
  core.on("consumableUsed", (data) => {
    view.flash("gold");
    if (!data) return;
    if (data.kind === "planet" && window.Cards) {
      const name = (window.Cards.HAND_TYPES[data.target] || {}).name || "";
      view.toastCenter("🪐 " + name + " 升级！");
    } else if (data.kind === "tarot") {
      view.toastCenter("🔮 " + data.name + (data.note ? " · " + data.note : ""));
      if (data.cardIds && data.cardIds.length) {
        setTimeout(() => view.highlightCards(data.cardIds), 50);
      }
    } else if (data.kind === "spectral") {
      view.toastCenter("👻 " + data.name + (data.note ? " · " + data.note : ""));
      view.screenShake();
      // 幻灵牌可能增删手牌，重渲染
      setTimeout(() => view.renderHand(), 50);
    }
  });

  core.on("gameWin", (data) => { view.flash("gold"); view.showWin(data); });
  core.on("gameLose", (data) => { view.flash("red"); view.screenShake(); view.showLose(data); });

  // ---------- 启动 ----------
  if (core.hasSave() && core.load()) {
    core.resume();
  } else {
    core.newGame();
  }
})();
