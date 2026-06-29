/* ============================================================
 * view.js —— 骰子地下城·表现层（GameView）
 *
 * 只负责 DOM 渲染、动画与弹层展示，不包含任何游戏规则。
 * 通过构造时注入的 query（只读查询）与 handlers（动作回调）
 * 与外界交互，完全不感知 GameCore 的内部实现。
 * ============================================================ */
(function () {
  "use strict";

  const DiceData = window.DiceData;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sfx = (name, ...a) => { try { if (window.SFX && window.SFX[name]) window.SFX[name](...a); } catch (e) { /* 忽略 */ } };

  // 骰子点数 → 点阵布局（用 CSS grid 摆放圆点）
  const PIP_LAYOUT = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };

  class GameView {
    constructor(query, handlers) {
      this.query = query;
      this.handlers = handlers;
      this.selectedDie = null;       // 当前选中的骰子 id
      this.replaceMode = null;       // 奖励替换模式：{ equipId }
      this._cacheDom();
      this._bindStatic();
      this._initBg();
    }

    _cacheDom() {
      const $ = (id) => document.getElementById(id);
      this.el = {
        menu: $("menuOverlay"), menuContinue: $("menuContinue"), menuNew: $("menuNewGame"),
        menuHelp: $("menuHelp"), menuSound: $("menuSound"),
        help: $("helpOverlay"), helpClose: $("helpClose"),

        screenMap: $("screenMap"), screenBattle: $("screenBattle"),
        mapTrack: $("mapTrack"), mapRowInfo: $("mapRowInfo"),

        // 玩家状态条（地图与战斗共用）
        pName: $("pName"), pHpFill: $("pHpFill"), pHpText: $("pHpText"),
        pBlock: $("pBlock"), pStatus: $("pStatus"),
        pGold: $("pGold"), pLevel: $("pLevel"), pXp: $("pXp"),
        pLimitFill: $("pLimitFill"), pLimitText: $("pLimitText"),

        // 战斗：敌人
        eName: $("eName"), eIcon: $("eIcon"), eHpFill: $("eHpFill"), eHpText: $("eHpText"),
        eBlock: $("eBlock"), eStatus: $("eStatus"), eEquip: $("eEquip"), eDice: $("eDice"),
        // 战斗：玩家
        pEquip: $("pEquip"), pDice: $("pDice"),
        turnInfo: $("turnInfo"),
        limitBtn: $("limitBtn"), endTurnBtn: $("endTurnBtn"),

        reward: $("rewardOverlay"), rewardOpts: $("rewardOptions"), rewardTitle: $("rewardTitle"),
        rewardSkip: $("rewardSkip"), rewardHint: $("rewardHint"),

        shop: $("shopOverlay"), shopGold: $("shopGold"), shopItems: $("shopItems"),
        shopOwned: $("shopOwned"), shopHealBtn: $("shopHealBtn"),
        shopRerollBtn: $("shopRerollBtn"), shopLeaveBtn: $("shopLeaveBtn"),

        end: $("endOverlay"), endTitle: $("endTitle"), endMsg: $("endMsg"),
        endRestart: $("endRestart"), endMenu: $("endMenu"),

        tip: $("tooltip"), toast: $("toast"), floaters: $("floaters"),
        flash: $("flash"), bgfx: $("bgfx"),
        log: $("logList"), logToggle: $("logToggle"), logPanel: $("logPanel"), logClear: $("logClear"),
      };
    }

    _bindStatic() {
      const h = this.handlers;
      const on = (node, fn) => { if (node) node.onclick = () => { sfx("click"); fn(); }; };

      on(this.el.menuNew, () => h.onNewGame());
      on(this.el.menuContinue, () => h.onContinue());
      if (this.el.menuHelp) this.el.menuHelp.onclick = () => { this.el.help.classList.remove("hidden"); sfx("click"); };
      if (this.el.helpClose) this.el.helpClose.onclick = () => { this.el.help.classList.add("hidden"); sfx("click"); };
      this._soundOn = this._loadSoundPref();
      if (window.SFX) window.SFX.setEnabled(this._soundOn);
      this._updateSoundLabel();
      if (this.el.menuSound) this.el.menuSound.onclick = () => this._toggleSound();

      on(this.el.endTurnBtn, () => h.onEndTurn());
      on(this.el.limitBtn, () => h.onLimitBreak());

      on(this.el.rewardSkip, () => h.onSkipReward());
      on(this.el.shopHealBtn, () => h.onBuyHeal());
      on(this.el.shopRerollBtn, () => h.onReroll());
      on(this.el.shopLeaveBtn, () => h.onLeaveShop());

      on(this.el.endRestart, () => h.onRestart());
      on(this.el.endMenu, () => h.onBackToMenu());

      if (this.el.logToggle) this.el.logToggle.onclick = () => this.el.logPanel.classList.toggle("open");
      if (this.el.logClear) this.el.logClear.onclick = () => { this.el.log.innerHTML = ""; };
      if (window.innerWidth > 1100 && this.el.logPanel) this.el.logPanel.classList.add("open");

      // 点击空白处隐藏 tooltip
      document.addEventListener("click", (e) => {
        if (this.el.tip && !e.target.closest("[data-tip]")) this.el.tip.classList.add("hidden");
      });
    }

    // ---------- 音效偏好 ----------
    _loadSoundPref() { try { return localStorage.getItem("funnybuddy_dicey_sound") !== "off"; } catch (e) { return true; } }
    _saveSoundPref(v) { try { localStorage.setItem("funnybuddy_dicey_sound", v ? "on" : "off"); } catch (e) { /* ignore */ } }
    _updateSoundLabel() { if (this.el.menuSound) this.el.menuSound.textContent = this._soundOn ? "🔊 音效：开" : "🔇 音效：关"; }
    _toggleSound() {
      this._soundOn = !this._soundOn;
      if (window.SFX) window.SFX.setEnabled(this._soundOn);
      this._saveSoundPref(this._soundOn);
      this._updateSoundLabel();
      if (this._soundOn) sfx("click");
    }

    // ============================================================
    // 顶层调度：按 phase 渲染对应界面
    // ============================================================
    renderAll() {
      const s = this.query.getState();
      this.state = s;
      if (s.player) this._renderPlayerBar(s.player);

      const showMap = s.phase === "map";
      const showBattle = s.phase === "battle";
      this.el.screenMap.classList.toggle("hidden", !showMap);
      this.el.screenBattle.classList.toggle("hidden", !showBattle);

      if (showMap) this._renderMap(s);
      if (showBattle) this._renderBattle(s);

      // 弹层
      this.el.reward.classList.toggle("hidden", s.phase !== "reward");
      this.el.shop.classList.toggle("hidden", s.phase !== "shop");
      if (s.phase === "reward") this._renderReward(s);
      if (s.phase === "shop") this._renderShop(s);
    }

    // ---------- 玩家状态条 ----------
    _renderPlayerBar(p) {
      const set = (n, v) => { if (n) n.textContent = v; };
      set(this.el.pName, `${p.icon} ${p.name}`);
      this._setBar(this.el.pHpFill, p.hp, p.maxHp);
      set(this.el.pHpText, `${Math.max(0, p.hp)}/${p.maxHp}`);
      this._renderBlock(this.el.pBlock, p.block);
      this._renderStatusIcons(this.el.pStatus, p.status);
      set(this.el.pGold, `$${p.gold}`);
      set(this.el.pLevel, `Lv.${p.level}`);
      set(this.el.pXp, p.nextNeed != null ? `${p.xp}/${p.nextNeed} XP` : `${p.xp} XP`);
      const lim = p.limit;
      this._setBar(this.el.pLimitFill, lim.charge, lim.chargeMax);
      set(this.el.pLimitText, `${lim.charge}/${lim.chargeMax}`);
    }

    _setBar(node, val, max) {
      if (!node) return;
      const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
      node.style.width = pct + "%";
    }
    _renderBlock(node, block) {
      if (!node) return;
      if (block > 0) { node.textContent = `🛡 ${block}`; node.classList.remove("hidden"); }
      else node.classList.add("hidden");
    }
    _renderStatusIcons(node, status) {
      if (!node) return;
      node.innerHTML = "";
      Object.keys(status || {}).forEach((k) => {
        const v = status[k];
        if (!v || k === "shield") return;
        const def = DiceData.STATUSES[k];
        if (!def) return;
        const chip = document.createElement("span");
        chip.className = "status-chip";
        chip.style.setProperty("--c", def.color);
        chip.textContent = `${def.icon}${v}`;
        chip.setAttribute("data-tip", `${def.name}：${def.desc}（当前 ${v} 层）`);
        this._bindTip(chip);
        node.appendChild(chip);
      });
    }

    // ============================================================
    // 地图
    // ============================================================
    _renderMap(s) {
      const m = s.map;
      if (!m) return;
      this.el.mapRowInfo.textContent = `第 ${m.rowIndex + 1} / ${m.totalRows} 层`;
      const track = this.el.mapTrack;
      track.innerHTML = "";
      m.currentRow.forEach((node, i) => {
        const card = document.createElement("button");
        card.className = `map-node node-${node.type}`;
        card.style.animationDelay = i * 0.08 + "s";
        const enemy = node.enemy ? `<div class="node-enemy">${node.enemy.icon} ${node.enemy.name}<br><span class="node-hp">HP ${node.enemy.hp}</span></div>` : "";
        card.innerHTML = `
          <div class="node-icon">${node.meta.icon}</div>
          <div class="node-label">${node.meta.label}</div>
          ${enemy}
        `;
        card.onclick = () => { sfx("click"); this.handlers.onChooseNode(node.id); };
        track.appendChild(card);
      });
    }

    // ============================================================
    // 战斗
    // ============================================================
    _renderBattle(s) {
      const b = s.battle;
      if (!b) return;
      const e = b.enemy;
      // 敌人面板
      this.el.eName.textContent = e.name;
      this.el.eIcon.textContent = e.icon;
      this._setBar(this.el.eHpFill, e.hp, e.maxHp);
      this.el.eHpText.textContent = `${Math.max(0, e.hp)}/${e.maxHp}`;
      this._renderBlock(this.el.eBlock, e.block);
      this._renderStatusIcons(this.el.eStatus, e.status);
      this._renderEquipList(this.el.eEquip, e.equipment, false);
      this._renderDice(this.el.eDice, e.dice, false);

      // 玩家面板
      this._renderEquipList(this.el.pEquip, s.player.equipment, true);
      this._renderDice(this.el.pDice, s.player.dice, true);

      // 回合提示与按钮
      const myTurn = b.turn === "player" && !b.over;
      this.el.turnInfo.textContent = b.over ? "结算中…" : (myTurn ? "你的回合" : `${e.name} 的回合`);
      this.el.turnInfo.classList.toggle("enemy-turn", !myTurn);
      this.el.endTurnBtn.disabled = !myTurn;
      const lim = s.player.limit;
      this.el.limitBtn.disabled = !myTurn || lim.charge < lim.chargeMax;
      this.el.limitBtn.classList.toggle("ready", lim.charge >= lim.chargeMax);
    }

    // 渲染装备列表（玩家的可点击作为分配目标）
    _renderEquipList(node, equipment, interactive) {
      if (!node) return;
      node.innerHTML = "";
      equipment.forEach((eq) => {
        const card = document.createElement("div");
        card.className = "equip" + (eq.size >= 2 ? " equip-wide" : "");
        if (eq.usesLeft <= 0) card.classList.add("equip-spent");
        // 当前选中骰子能否放入：高亮可用槽
        if (interactive && this.selectedDie != null) {
          const die = this._findPlayerDie(this.selectedDie);
          if (die && eq.usesLeft > 0 && DiceData.checkCondition(eq.condition, die.value)) {
            card.classList.add("equip-valid");
          }
        }
        const cond = DiceData.describeCondition(eq.condition);
        const uses = eq.usesPerTurn > 1 ? `<span class="equip-uses">×${eq.usesLeft}</span>` : "";
        card.innerHTML = `
          <div class="equip-cond" title="骰子条件">${cond}</div>
          <div class="equip-icon">${eq.icon || "▫"}</div>
          <div class="equip-name">${eq.name}${uses}</div>
        `;
        card.setAttribute("data-tip", `【${eq.name}】\n${eq.desc}\n每回合 ${eq.usesPerTurn} 次`);
        this._bindTip(card);
        if (interactive) {
          card.onclick = () => this.handlers.onEquipClick(eq.instId);
        }
        node.appendChild(card);
      });
    }

    // 渲染骰子（玩家的可点击选择）
    _renderDice(node, dice, interactive) {
      if (!node) return;
      node.innerHTML = "";
      dice.forEach((d) => {
        const die = document.createElement("div");
        die.className = "die die-" + d.value;
        if (d.used) die.classList.add("die-used");
        if (interactive && this.selectedDie === d.id && !d.used) die.classList.add("die-sel");
        // 点阵
        const pips = PIP_LAYOUT[d.value] || [];
        let inner = "";
        for (let i = 0; i < 9; i++) inner += `<span class="pip${pips.includes(i) ? " on" : ""}"></span>`;
        die.innerHTML = inner;
        if (interactive && !d.used) die.onclick = () => this.handlers.onDieClick(d.id);
        node.appendChild(die);
      });
      if (!dice.length) node.innerHTML = '<span class="dice-empty">—</span>';
    }

    _findPlayerDie(id) {
      const p = this.state && this.state.player;
      if (!p) return null;
      return (p.dice || []).find((d) => d.id === id) || null;
    }

    // 选中/取消选中骰子（控制层只管逻辑，选中态是纯表现，放在 view）
    setSelectedDie(id) {
      this.selectedDie = (this.selectedDie === id) ? null : id;
      if (this.state && this.state.phase === "battle") this._renderBattle(this.state);
    }
    clearSelectedDie() {
      this.selectedDie = null;
      if (this.state && this.state.phase === "battle") this._renderBattle(this.state);
    }

    // ============================================================
    // 奖励：三选一装备
    // ============================================================
    _renderReward(s) {
      const r = s.reward;
      if (!r) return;
      this.el.rewardTitle.textContent = r.source === "treasure" ? "🎁 宝箱奖励 · 三选一" : "✨ 战利品 · 三选一";
      const p = s.player;
      const full = p.usedCapacity >= p.capacity;
      this.el.rewardHint.textContent = `装备栏 ${p.usedCapacity}/${p.capacity}` + (this.replaceMode ? " · 点击下方一件装备进行替换" : (full ? " · 已满，选取后需替换" : ""));
      this.el.rewardOpts.innerHTML = "";
      r.options.forEach((eq) => {
        const card = document.createElement("div");
        card.className = "reward-card rarity-" + (eq.tags && eq.tags[0] || "common");
        card.innerHTML = `
          <div class="reward-icon">${eq.icon || "▫"}</div>
          <div class="reward-name">${eq.name}</div>
          <div class="reward-cond">${DiceData.describeCondition(eq.condition)} · ${eq.size}格</div>
          <div class="reward-desc">${eq.desc}</div>
        `;
        card.onclick = () => { sfx("click"); this.handlers.onPickReward(eq.id, eq.size); };
        this.el.rewardOpts.appendChild(card);
      });
      this._renderReplacePicker(s);
    }

    // 容量不足时，渲染「选择要替换掉的装备」选择器
    _renderReplacePicker(s) {
      const wrap = this.el.rewardOpts;
      if (!this.replaceMode) return;
      const p = s.player;
      const picker = document.createElement("div");
      picker.className = "replace-picker";
      picker.innerHTML = `<div class="replace-title">用【${this.replaceMode.name}】替换掉：</div>`;
      const row = document.createElement("div");
      row.className = "replace-row";
      p.equipment.forEach((eq) => {
        const b = document.createElement("button");
        b.className = "equip equip-mini";
        b.innerHTML = `<div class="equip-icon">${eq.icon || "▫"}</div><div class="equip-name">${eq.name}</div>`;
        b.onclick = () => { sfx("click"); this.handlers.onReplaceReward(this.replaceMode.id, eq.instId); };
        row.appendChild(b);
      });
      picker.appendChild(row);
      const cancel = document.createElement("button");
      cancel.className = "btn btn-sub";
      cancel.textContent = "取消替换";
      cancel.onclick = () => { this.replaceMode = null; this._renderReward(this.query.getState()); };
      picker.appendChild(cancel);
      wrap.appendChild(picker);
    }

    enterReplaceMode(equipId, name) {
      this.replaceMode = { id: equipId, name };
      this._renderReward(this.query.getState());
    }
    exitReplaceMode() { this.replaceMode = null; }

    // ============================================================
    // 商店
    // ============================================================
    _renderShop(s) {
      const shop = s.shop;
      const p = s.player;
      if (!shop) return;
      this.el.shopGold.textContent = `$${p.gold}`;
      this.el.shopRerollBtn.textContent = `🔄 刷新 ($${shop.rerollCost})`;
      this.el.shopHealBtn.textContent = `💚 治疗 +${shop.healAmount} ($${shop.healCost})`;
      this.el.shopHealBtn.disabled = p.hp >= p.maxHp || p.gold < shop.healCost;

      // 待售装备
      this.el.shopItems.innerHTML = "";
      shop.items.forEach((it) => {
        const eq = it.equip;
        const card = document.createElement("div");
        card.className = "shop-card" + (it.sold ? " sold" : "");
        const can = !it.sold && p.gold >= it.price && (p.usedCapacity + eq.size) <= p.capacity;
        card.innerHTML = `
          <div class="reward-icon">${eq.icon || "▫"}</div>
          <div class="reward-name">${eq.name}</div>
          <div class="reward-cond">${DiceData.describeCondition(eq.condition)} · ${eq.size}格</div>
          <div class="reward-desc">${eq.desc}</div>
          <button class="btn btn-buy" ${can ? "" : "disabled"}>${it.sold ? "已售出" : "$" + it.price}</button>
        `;
        const btn = card.querySelector("button");
        if (btn && can) btn.onclick = () => this.handlers.onBuyEquip(it.id);
        this.el.shopItems.appendChild(card);
      });

      // 我的装备（可升级 / 可卖出）
      this.el.shopOwned.innerHTML = "";
      p.equipment.forEach((eq) => {
        const card = document.createElement("div");
        card.className = "owned-card";
        const upBtn = eq.upgradeId
          ? `<button class="btn btn-up" ${p.gold >= shop.upgradeCost ? "" : "disabled"}>⚒️升级 $${shop.upgradeCost}</button>`
          : `<span class="no-up">不可升级</span>`;
        card.innerHTML = `
          <div class="owned-head"><span class="equip-icon">${eq.icon || "▫"}</span><span>${eq.name}</span><span class="owned-size">${eq.size}格</span></div>
          <div class="reward-desc">${eq.desc}</div>
          <div class="owned-actions">${upBtn}<button class="btn btn-sell">💰卖出</button></div>
        `;
        const btns = card.querySelectorAll("button");
        if (eq.upgradeId && btns[0] && p.gold >= shop.upgradeCost) btns[0].onclick = () => this.handlers.onUpgrade(eq.instId);
        const sellBtn = card.querySelector(".btn-sell");
        if (sellBtn) sellBtn.onclick = () => this.handlers.onSellEquip(eq.instId);
        this.el.shopOwned.appendChild(card);
      });
      this.el.shopRerollBtn.disabled = p.gold < shop.rerollCost;
    }

    // ============================================================
    // 弹层与反馈
    // ============================================================
    showMenu(opts) {
      this.el.menu.classList.remove("hidden");
      this.el.end.classList.add("hidden");
      const has = opts && opts.hasSave;
      this.el.menuContinue.classList.toggle("hidden", !has);
    }
    hideMenu() { this.el.menu.classList.add("hidden"); }

    showEnd(win, data) {
      this.el.end.classList.remove("hidden");
      this.el.endTitle.textContent = win ? "🏆 通关胜利！" : "💀 挑战失败";
      this.el.endMsg.textContent = win
        ? `你击败了地牢领主！最终等级 Lv.${data.level}，剩余金币 $${data.gold}。`
        : `你倒在了第 ${data.level} 级的征途上，再接再厉！`;
      this.flash(win ? "gold" : "red");
      sfx(win ? "win" : "lose");
    }
    hideEnd() { this.el.end.classList.add("hidden"); }

    // 伤害/治疗飘字（绑定到某个面板上方）
    floater(targetSide, text, kind) {
      const host = targetSide === "enemy" ? this.el.eIcon : this.el.pName;
      if (!host || !this.el.floaters) return;
      const rect = host.getBoundingClientRect();
      const f = document.createElement("div");
      f.className = "floater floater-" + kind;
      f.textContent = text;
      f.style.left = (rect.left + rect.width / 2) + "px";
      f.style.top = (rect.top) + "px";
      this.el.floaters.appendChild(f);
      setTimeout(() => f.remove(), 1100);
    }

    // 受击抖动
    shake(side) {
      const node = side === "enemy" ? this.el.eIcon && this.el.eIcon.closest(".enemy-panel") : this.el.screenBattle && this.el.screenBattle.querySelector(".player-combat");
      const target = side === "enemy" ? (this.el.eIcon && this.el.eIcon.closest(".enemy-panel")) : null;
      const n = target || node;
      if (!n) return;
      n.classList.remove("shake");
      void n.offsetWidth;
      n.classList.add("shake");
    }

    toast(text) {
      if (!this.el.toast) return;
      this.el.toast.textContent = text;
      this.el.toast.classList.add("show");
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.el.toast.classList.remove("show"), 1400);
    }

    flash(color) {
      const f = this.el.flash;
      if (!f) return;
      f.style.background = color === "gold" ? "#ffd86655" : color === "red" ? "#ef5a5a55" : "#58adf055";
      f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
      setTimeout(() => f.classList.remove("on"), 360);
    }

    addLog(entry) {
      if (!this.el.log) return;
      const div = document.createElement("div");
      div.className = "log-item log-" + (entry.type || "info");
      div.textContent = entry.text;
      this.el.log.appendChild(div);
      this.el.log.scrollTop = this.el.log.scrollHeight;
      while (this.el.log.childElementCount > 80) this.el.log.removeChild(this.el.log.firstChild);
    }

    // ---------- tooltip ----------
    _bindTip(node) {
      node.addEventListener("pointerenter", () => this._showTip(node));
      node.addEventListener("pointerleave", () => this.el.tip && this.el.tip.classList.add("hidden"));
      node.addEventListener("click", (e) => { e.stopPropagation(); this._showTip(node); });
    }
    _showTip(node) {
      const tip = this.el.tip;
      if (!tip) return;
      const text = node.getAttribute("data-tip");
      if (!text) return;
      tip.textContent = text;
      tip.classList.remove("hidden");
      const r = node.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }

    // ---------- 背景漂浮骰点 ----------
    _initBg() {
      const host = this.el.bgfx;
      if (!host) return;
      const N = 14;
      for (let i = 0; i < N; i++) {
        const s = document.createElement("div");
        s.className = "spark";
        s.style.left = Math.random() * 100 + "%";
        s.style.animationDelay = (Math.random() * 12) + "s";
        s.style.animationDuration = (10 + Math.random() * 12) + "s";
        s.style.opacity = 0.1 + Math.random() * 0.25;
        const sz = 4 + Math.random() * 8;
        s.style.width = s.style.height = sz + "px";
        host.appendChild(s);
      }
    }
  }

  window.GameView = GameView;
})();
