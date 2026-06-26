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
    onSellJoker: (idx) => {
      if (busy) return;
      const s = core.getState();
      const j = s.jokers[idx];
      if (!j) return;
      const value = Math.max(1, Math.floor(j.price / 2));
      if (!confirm(`卖出「${j.name}」获得 $${value}？`)) return;
      core.sellJoker(idx);
      if (!isShopHidden()) view.renderShop();
    },
    onBuyJoker: (idx) => {
      const res = core.buyJoker(idx);
      if (!res.ok && res.reason === "full") {
        alert("小丑牌已满（上限 " + core.CONFIG.MAX_JOKERS + " 张），请先卖出。");
      }
      view.renderShop();
    },
    onReroll: () => { core.reroll(); view.renderShop(); },
    onNextRound: () => { view.hideShop(); core.nextRound(); },
    onRestart: () => { view.hideEnd(); core.newGame(); },
  };

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

  core.on("shopOpen", () => view.showShop());

  core.on("gameWin", (data) => { view.flash("gold"); view.showWin(data); });
  core.on("gameLose", (data) => { view.flash("red"); view.screenShake(); view.showLose(data); });

  // ---------- 启动 ----------
  core.newGame();
})();
