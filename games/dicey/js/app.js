/* ============================================================
 * app.js —— 骰子地下城·控制层（入口）
 *
 * 负责实例化逻辑层(GameCore)与表现层(GameView)，
 * 把用户操作（handlers）连接到逻辑层，
 * 把逻辑层事件连接到表现层渲染与演出。
 * 自身不包含游戏规则，也不直接操作 DOM。
 * ============================================================ */
(function () {
  "use strict";

  const core = new window.GameCore();
  let busy = false;             // 敌人回合演出期间锁定玩家操作

  // ---------- 注入给表现层的只读查询 ----------
  const query = { getState: () => core.getState() };

  // ---------- 注入给表现层的用户操作回调 ----------
  const handlers = {
    // 地图
    onChooseNode: (id) => { if (!busy) core.chooseNode(id); },

    // 战斗：选骰子 / 把选中的骰子放进装备
    onDieClick: (id) => {
      if (busy) return;
      view.setSelectedDie(id);
    },
    onEquipClick: (instId) => {
      if (busy) return;
      const dieId = view.selectedDie;
      if (dieId == null) { view.toast("先点选一个骰子，再点击装备"); return; }
      const r = core.assignDie(dieId, instId);
      if (r.ok) {
        view.clearSelectedDie();
      } else if (r.reason === "condition") {
        view.toast("该骰子点数不满足此装备的条件");
        view.flash("red");
      } else if (r.reason === "used") {
        view.toast("这件装备本回合已用完");
      }
    },
    // 结束回合 → 敌人回合：用 busy 锁住玩家操作并让出一帧，避免点击瞬间卡顿
    onEndTurn: () => {
      if (busy || !view.state || view.state.phase !== "battle") return;
      busy = true;
      view.clearSelectedDie();
      view.el.endTurnBtn.disabled = true;
      setTimeout(() => {
        core.endTurn();
        busy = false;
        view.renderAll();
      }, 60);
    },
    onLimitBreak: () => {
      if (busy) return;
      const r = core.useLimitBreak();
      if (r.ok) { view.flash("gold"); view.toast("💥 重掷所有骰子！"); }
      else if (r.reason === "charge") view.toast("大招能量还没充满");
    },

    // 奖励
    onPickReward: (equipId, size) => {
      const r = core.pickReward(equipId);
      if (r.ok) { if (window.SFX) window.SFX.buy(); view.exitReplaceMode(); return; }
      if (r.reason === "capacity") {
        const opt = core.getState().reward.options.find((o) => o.id === equipId);
        view.enterReplaceMode(equipId, opt ? opt.name : "新装备");
        view.toast("装备栏已满，请选择一件替换");
      }
    },
    onReplaceReward: (equipId, removeInstId) => {
      const r = core.replaceWithReward(equipId, removeInstId);
      if (r.ok) { if (window.SFX) window.SFX.buy(); view.exitReplaceMode(); }
      else if (r.reason === "capacity") view.toast("替换后仍放不下，请选更大的装备替换");
    },
    onSkipReward: () => { view.exitReplaceMode(); core.skipReward(); },

    // 商店
    onBuyEquip: (itemId) => {
      const r = core.buyEquipment(itemId);
      if (r.ok) { if (window.SFX) window.SFX.buy(); }
      else if (r.reason === "money") view.toast("金币不足");
      else if (r.reason === "capacity") view.toast("装备栏已满，先卖出一件吧");
    },
    onBuyHeal: () => { const r = core.buyHeal(); if (r.ok && window.SFX) window.SFX.heal(); else if (r.reason === "money") view.toast("金币不足"); },
    onUpgrade: (instId) => { const r = core.upgradeEquipment(instId); if (r.ok && window.SFX) window.SFX.buy(); else if (r.reason === "money") view.toast("金币不足"); },
    onSellEquip: (instId) => { const r = core.sellEquipment(instId); if (r.ok && window.SFX) window.SFX.coin(); },
    onReroll: () => { const r = core.rerollShop(); if (!r.ok && r.reason === "money") view.toast("金币不足"); },
    onLeaveShop: () => core.leaveShop(),

    // 主菜单 / 结束
    onNewGame: () => {
      if (core.hasSave() && !confirm("已有存档，开始新游戏会覆盖当前进度，确定吗？")) return;
      view.hideMenu(); core.newGame();
    },
    onContinue: () => { if (core.load()) { view.hideMenu(); core.resume(); } else view.showMenu({ hasSave: false }); },
    onRestart: () => { view.hideEnd(); core.newGame(); },
    onBackToMenu: () => { view.hideEnd(); view.showMenu({ hasSave: core.hasSave() }); },
  };

  const view = new window.GameView(query, handlers);

  // ============================================================
  // 逻辑层事件 → 表现层
  // ============================================================
  core.on("change", () => view.renderAll());
  core.on("log", (e) => view.addLog(e));

  core.on("battleStart", () => { view.clearSelectedDie(); });
  core.on("diceRolled", (d) => { if (window.SFX) window.SFX.roll(); });

  // 伤害飘字 + 抖动
  core.on("damage", (d) => {
    if (d.kind === "dot") {
      view.floater(d.side, "-" + d.amount, "dmg");
    } else {
      const absorbed = d.absorbed || 0;
      const real = d.amount - absorbed;
      if (absorbed > 0 && real <= 0) view.floater(d.side, "🛡", "block");
      else view.floater(d.side, "-" + d.amount, "dmg");
      if (window.SFX) window.SFX.hit();
    }
    view.shake(d.side);
  });
  core.on("heal", (d) => { if (d.amount > 0) { view.floater(d.target, "+" + d.amount, "heal"); if (window.SFX) window.SFX.heal(); } });
  core.on("status", (d) => {
    if (d.key === "shield") { if (window.SFX) window.SFX.shield(); }
    else if (window.SFX) window.SFX.status();
  });
  core.on("limitCharge", () => {});
  core.on("levelUp", (d) => { view.toast(`⬆️ 升到 Lv.${d.level}！${d.rewards.join("，")}`); view.flash("gold"); });

  core.on("rewardOpen", () => { view.clearSelectedDie(); });
  core.on("shopOpen", () => {});

  core.on("battleWin", () => { view.flash("gold"); });
  core.on("gameWin", (d) => view.showEnd(true, d));
  core.on("gameLose", (d) => view.showEnd(false, d));

  // ---------- 启动：显示主菜单 ----------
  view.showMenu({ hasSave: core.hasSave() });
})();
