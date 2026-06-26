/* ============================================================
 * view.js —— 表现层（GameView）
 * 只负责 DOM 渲染、动画与弹层展示，不包含任何游戏规则。
 * 通过构造时注入的 query（只读查询）与 handlers（动作回调）
 * 与外界交互，完全不感知 GameCore 的内部实现。
 * ============================================================ */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round2 = (n) => Math.round(n * 100) / 100;

  class GameView {
    /**
     * @param {object} query    { getState(), getHandPreview() }
     * @param {object} handlers 各类用户操作回调
     */
    constructor(query, handlers) {
      this.query = query;
      this.handlers = handlers;
      this._cacheDom();
      this._bindStaticEvents();
    }

    _cacheDom() {
      const $ = (id) => document.getElementById(id);
      this.el = {
        blindName: $("blindName"), targetScore: $("targetScore"), blindReward: $("blindReward"),
        roundScore: $("roundScore"), chipsView: $("chipsView"), multView: $("multView"),
        moneyView: $("moneyView"), handsView: $("handsView"), discardsView: $("discardsView"),
        anteView: $("anteView"), roundView: $("roundView"),
        jokers: $("jokers"), jokerCount: $("jokerCount"),
        handTypeBanner: $("handTypeBanner"), handTypeName: $("handTypeName"), handTypeLevel: $("handTypeLevel"),
        playArea: $("playArea"), hand: $("hand"), deckCount: $("deckCount"),
        playBtn: $("playBtn"), discardBtn: $("discardBtn"),
        sortRankBtn: $("sortRankBtn"), sortSuitBtn: $("sortSuitBtn"),
        shopOverlay: $("shopOverlay"), shopJokers: $("shopJokers"), shopMoney: $("shopMoney"),
        rerollBtn: $("rerollBtn"), nextRoundBtn: $("nextRoundBtn"),
        blindOverlay: $("blindOverlay"), blindSelectTitle: $("blindSelectTitle"), blindCards: $("blindCards"),
        endOverlay: $("endOverlay"), endTitle: $("endTitle"), endMsg: $("endMsg"), restartBtn: $("restartBtn"),
        floaters: $("floaters"),
        bgfx: $("bgfx"), fxLayer: $("fxLayer"), flash: $("flash"),
        game: $("game"),
        logPanel: $("logPanel"), logList: $("logList"), logClear: $("logClear"), logToggle: $("logToggle"),
      };
      this._initBgSparks();
      // 宽屏默认展开日志面板
      if (window.innerWidth > 1100) this.el.logPanel.classList.add("open");
    }

    _bindStaticEvents() {
      const h = this.handlers;
      this.el.playBtn.onclick = () => h.onPlay();
      this.el.discardBtn.onclick = () => h.onDiscard();
      this.el.sortRankBtn.onclick = () => h.onSortRank();
      this.el.sortSuitBtn.onclick = () => h.onSortSuit();
      this.el.rerollBtn.onclick = () => h.onReroll();
      this.el.nextRoundBtn.onclick = () => h.onNextRound();
      this.el.restartBtn.onclick = () => h.onRestart();
      this.el.logToggle.onclick = () => this.el.logPanel.classList.toggle("open");
      this.el.logClear.onclick = () => { this.el.logList.innerHTML = ""; };
    }

    // 背景漂浮光点
    _initBgSparks() {
      const n = 22;
      for (let i = 0; i < n; i++) {
        const s = document.createElement("div");
        s.className = "spark";
        const size = 3 + Math.random() * 6;
        s.style.left = Math.random() * 100 + "%";
        s.style.width = s.style.height = size + "px";
        s.style.animationDuration = 10 + Math.random() * 16 + "s";
        s.style.animationDelay = -Math.random() * 20 + "s";
        this.el.bgfx.appendChild(s);
      }
    }

    // ============================================================
    // 总渲染
    // ============================================================
    renderAll() {
      this.renderTopbar();
      this.renderJokers();
      this.renderHand();
      this.renderHandTypePreview();
      this.updateActionButtons();
    }

    renderTopbar() {
      const s = this.query.getState();
      const e = this.el;
      e.blindName.textContent = s.blindName;
      e.targetScore.textContent = s.targetScore.toLocaleString();
      e.blindReward.textContent = "奖励 $" + s.blindReward;
      e.roundScore.textContent = s.roundScore.toLocaleString();
      e.moneyView.textContent = "$" + s.money;
      e.handsView.textContent = s.handsLeft;
      e.discardsView.textContent = s.discardsLeft;
      e.anteView.textContent = s.ante + "/" + s.totalAnte;
      e.roundView.textContent = s.round;
      e.deckCount.textContent = s.deckCount;
    }

    // ---------- 卡牌节点 ----------
    _cardNode(c, selectable, selectedSet) {
      const node = document.createElement("div");
      node.className = "card " + (c.color === "red" ? "red" : "black");
      node.dataset.cardId = c.id;
      if (selectedSet && selectedSet.has(c.id)) node.classList.add("selected");
      node.innerHTML = `
        <div class="corner tl"><span>${c.label}</span><span>${c.symbol}</span></div>
        <div class="pip-center">${c.symbol}</div>
        <div class="corner br"><span>${c.label}</span><span>${c.symbol}</span></div>
      `;
      if (selectable) node.onclick = () => this.handlers.onCardClick(c.id);
      return node;
    }

    renderHand(animateDeal = false) {
      const s = this.query.getState();
      this.el.hand.innerHTML = "";
      s.hand.forEach((c, i) => {
        const node = this._cardNode(c, true, s.selected);
        if (animateDeal) {
          node.classList.add("dealing");
          node.style.animationDelay = (i * 0.05) + "s";
        }
        this.el.hand.appendChild(node);
      });
      this.el.deckCount.textContent = s.deckCount;
    }

    // ---------- 小丑牌节点 ----------
    _jokerNode(j, idx) {
      const node = document.createElement("div");
      const rarity = j.rarity || "common";
      node.className = `joker rarity-${rarity}`;
      // 用 id 的字符和数算出一个稳定的色相，让每张小丑牌底色微妙不同
      const hue = (() => {
        let h = 0;
        for (const c of (j.id || "j")) h = (h * 31 + c.charCodeAt(0)) % 360;
        return h;
      })();
      node.style.setProperty("--joker-hue", hue);
      node.innerHTML = `
        <div class="joker-holo"></div>
        <div class="joker-shine"></div>
        <div class="joker-face">${j.face}</div>
        <div class="joker-name">${j.name}</div>
        <div class="joker-effect">${j.desc}</div>
        <div class="joker-sell">$${Math.max(1, Math.floor(j.price / 2))}</div>
        <div class="joker-rarity-badge">${
          rarity === "uncommon" ? "稀有" : rarity === "rare" ? "罕见" : rarity === "legendary" ? "传说" : "普通"
        }</div>
        <div class="tip"><b>${j.name}</b><br>${j.desc}</div>
      `;
      if (idx >= 0) {
        // 触屏：单击切换 tooltip 显示，长按（>500ms）出售；
        // 鼠标：单击直接出售（hover 已可显示 tip）。
        const isTouchEnv = window.matchMedia("(hover: none)").matches;
        if (isTouchEnv) {
          let pressTimer = null;
          let longPressed = false;
          const start = (e) => {
            longPressed = false;
            pressTimer = setTimeout(() => {
              longPressed = true;
              if (confirm(`确定卖出「${j.name}」获得 $${Math.max(1, Math.floor(j.price / 2))}？`)) {
                this.handlers.onSellJoker(idx);
              }
            }, 550);
          };
          const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
          node.addEventListener("touchstart", start, { passive: true });
          node.addEventListener("touchend", cancel);
          node.addEventListener("touchmove", cancel);
          node.addEventListener("touchcancel", cancel);
          node.addEventListener("click", (e) => {
            if (longPressed) { e.preventDefault(); return; }
            // 关闭其他已展开的 tip
            document.querySelectorAll(".joker.show-tip").forEach((n) => { if (n !== node) n.classList.remove("show-tip"); });
            node.classList.toggle("show-tip");
          });
        } else {
          node.onclick = () => this.handlers.onSellJoker(idx);
        }
      } else {
        // 商店里小丑牌（idx<0）：触屏单击切换 tip，方便看说明
        const isTouchEnv = window.matchMedia("(hover: none)").matches;
        if (isTouchEnv) {
          node.addEventListener("click", () => {
            document.querySelectorAll(".joker.show-tip").forEach((n) => { if (n !== node) n.classList.remove("show-tip"); });
            node.classList.toggle("show-tip");
          });
        }
      }
      return node;
    }

    renderJokers() {
      const s = this.query.getState();
      this.el.jokers.innerHTML = "";
      s.jokers.forEach((j, idx) => {
        const node = this._jokerNode(j, idx);
        node.classList.add("joker-enter");
        node.style.animationDelay = (idx * 0.06) + "s";
        this.el.jokers.appendChild(node);
      });
      this.el.jokerCount.textContent = s.jokers.length + "/" + s.maxJokers;
    }

    // ---------- 牌型预览 ----------
    renderHandTypePreview() {
      const preview = this.query.getHandPreview();
      const e = this.el;
      if (!preview) {
        e.handTypeBanner.classList.add("hidden");
        e.chipsView.textContent = 0;
        e.multView.textContent = 0;
        return;
      }
      e.handTypeBanner.classList.remove("hidden");
      e.handTypeName.textContent = preview.name;
      e.handTypeLevel.textContent = "";
      e.chipsView.textContent = preview.baseChips;
      e.multView.textContent = preview.baseMult;
    }

    // ---------- 操作按钮可用态 ----------
    updateActionButtons(disabled = false) {
      const s = this.query.getState();
      const n = s.selected.size;
      this.el.playBtn.disabled = disabled || n === 0 || s.handsLeft <= 0;
      this.el.discardBtn.disabled = disabled || n === 0 || s.discardsLeft <= 0;
    }
    lockActions() { this.el.playBtn.disabled = true; this.el.discardBtn.disabled = true; }

    // 数字跳动反馈
    _bump(el) {
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
      setTimeout(() => el.classList.remove("bump"), 260);
    }

    // ============================================================
    // 计分动画（消费 core.playHand 产出的 result）
    // ============================================================
    async animateScore(result) {
      const e = this.el;
      // 出牌后手牌已变化，重渲染
      this.renderHand();
      this.renderTopbar();

      // 桌面铺牌
      e.playArea.innerHTML = "";
      const nodeByCardId = {};
      for (const c of result.played) {
        const node = this._cardNode(c, false, null);
        nodeByCardId[c.id] = node;
        e.playArea.appendChild(node);
      }

      // 牌型横幅与基础分
      e.handTypeBanner.classList.remove("hidden");
      e.handTypeName.textContent = result.handType.name;
      e.handTypeLevel.textContent = "";
      e.chipsView.textContent = result.baseChips;
      e.multView.textContent = result.baseMult;
      await sleep(250);

      const jokerNodes = e.jokers.querySelectorAll(".joker");

      // 逐步播放
      for (const step of result.steps) {
        if (step.kind === "card") {
          const node = nodeByCardId[step.cardId];
          if (node) { node.classList.add("scoring"); this.burst(node, "#4aa3e4", 8); }
          e.chipsView.textContent = step.runChips;
          this._bump(e.chipsView);
          if (node) this._floaterAt(node, "+" + step.chips, "chip");
          await sleep(170);
          if (node) node.classList.remove("scoring");
        } else if (step.kind === "joker") {
          const node = jokerNodes[step.jokerIndex];
          if (node) {
            node.classList.add("triggered");
            // 触发时叠加金色光环 ring 元素
            const ring = document.createElement("div");
            ring.className = "joker-ring";
            node.appendChild(ring);
            setTimeout(() => ring.remove(), 600);
          }
          e.chipsView.textContent = step.runChips;
          e.multView.textContent = round2(step.runMult);
          if (node) {
            const isMult = step.dMult || step.xmult != null;
            // 先金色火花，再补一圈对应色粒子
            this.burst(node, "#ffd54a", 10);
            this.burst(node, isMult ? "#e44b4b" : "#4aa3e4", 14);
            if (step.dChips) { this._floaterAt(node, "+" + step.dChips, "chip", -8); this._bump(e.chipsView); }
            if (step.dMult)  { this._floaterAt(node, "+" + step.dMult, "mult", -8); this._bump(e.multView); }
            if (step.xmult != null) {
              this._floaterAt(node, "×" + step.xmult, "mult", -8);
              this._bump(e.multView);
              this.flash("red"); this.screenShake();
              this.burst(node, "#ffd54a", 20);
            }
          }
          await sleep(320);
          if (node) node.classList.remove("triggered");
        }
      }

      // 乘区与总分
      e.multView.textContent = round2(result.finalMult);
      this._bump(e.multView);
      await sleep(150);
      const sr = e.roundScore.getBoundingClientRect();
      this._floater("+" + result.gained.toLocaleString(), "chip", sr.left + sr.width / 2 - 20, sr.top + 30);
      e.roundScore.textContent = result.newRoundScore.toLocaleString();
      e.roundScore.classList.add("bump");
      setTimeout(() => e.roundScore.classList.remove("bump"), 400);
      this.flash(result.outcome === "win" ? "gold" : "blue");
      this.screenShake();
      await sleep(600);

      // 清桌
      e.playArea.innerHTML = "";
      e.handTypeBanner.classList.add("hidden");
      e.chipsView.textContent = 0;
      e.multView.textContent = 0;
    }

    // ============================================================
    // 弹层：盲注选择
    // ============================================================
    showBlindSelect(data, onStart) {
      const e = this.el;
      e.blindSelectTitle.textContent = `底注 ${data.ante} / ${data.totalAnte}`;
      e.blindCards.innerHTML = "";

      const card = document.createElement("div");
      card.className = "blind-card" + (data.blindKey === "boss" ? " boss" : "");
      card.innerHTML = `
        <div class="bc-name">${data.blindName}</div>
        <div class="bc-target">目标分数 <b>${data.target.toLocaleString()}</b></div>
        <div class="bc-reward">击败奖励 $${data.reward}</div>
        <div class="bc-desc">${data.blindDesc}</div>
      `;
      const btn = document.createElement("button");
      btn.className = "btn btn-play";
      btn.textContent = "开始挑战";
      btn.onclick = onStart;
      card.appendChild(btn);
      e.blindCards.appendChild(card);
      e.blindOverlay.classList.remove("hidden");
    }
    hideBlindSelect() { this.el.blindOverlay.classList.add("hidden"); }

    // ============================================================
    // 弹层：商店
    // ============================================================
    showShop() {
      this.renderShop();
      this.el.shopOverlay.classList.remove("hidden");
    }
    hideShop() { this.el.shopOverlay.classList.add("hidden"); }

    renderShop() {
      const s = this.query.getState();
      const e = this.el;
      e.shopMoney.textContent = "$" + s.money;
      e.shopJokers.innerHTML = "";
      if (!s.shopItems.length) {
        e.shopJokers.innerHTML = '<div style="color:#9bb0a8">已无可购买的小丑牌</div>';
      }
      s.shopItems.forEach((item, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "shop-item" + (item.sold ? " sold" : "");
        wrap.appendChild(this._jokerNode(item.joker, -1));

        const price = document.createElement("div");
        price.className = "price";
        price.textContent = "$" + item.joker.price;
        wrap.appendChild(price);

        const buy = document.createElement("button");
        buy.className = "btn btn-play buy";
        buy.textContent = item.sold ? "已购买" : "购买";
        buy.disabled = item.sold || s.money < item.joker.price || s.jokers.length >= s.maxJokers;
        buy.onclick = () => this.handlers.onBuyJoker(idx);
        wrap.appendChild(buy);

        e.shopJokers.appendChild(wrap);
      });
      this.el.rerollBtn.disabled = s.money < 5;
    }

    // ============================================================
    // 弹层：结束
    // ============================================================
    showWin(data) {
      const box = this.el.endOverlay.querySelector(".end-box");
      box.className = "end-box win";
      this.el.endTitle.textContent = "🏆 通关胜利！";
      this.el.endMsg.textContent =
        `你击败了全部底注，成为真正的小丑牌大师！最终资金 $${data.money}。`;
      this.el.endOverlay.classList.remove("hidden");
    }
    showLose(data) {
      const box = this.el.endOverlay.querySelector(".end-box");
      box.className = "end-box lose";
      this.el.endTitle.textContent = "游戏失败";
      this.el.endMsg.textContent =
        `在底注 ${data.ante} 的${data.blindName}中未能达到目标分数 ${data.target.toLocaleString()}（你的得分 ${data.score.toLocaleString()}）。`;
      this.el.endOverlay.classList.remove("hidden");
    }
    hideEnd() { this.el.endOverlay.classList.add("hidden"); }

    // ============================================================
    // 飘字
    // ============================================================
    _floater(text, type, x, y) {
      const f = document.createElement("div");
      f.className = "floater " + type;
      f.textContent = text;
      f.style.left = x + "px";
      f.style.top = y + "px";
      this.el.floaters.appendChild(f);
      setTimeout(() => f.remove(), 1000);
    }
    _floaterAt(node, text, type, dy = 0) {
      const r = node.getBoundingClientRect();
      this._floater(text, type, r.left + r.width / 2 - 10, r.top - 10 + dy);
    }
    floaterMoney(text) {
      const r = this.el.moneyView.getBoundingClientRect();
      this._floater(text, "money", r.left, r.top + 24);
    }

    // ============================================================
    // 操作日志
    // ============================================================
    addLog(entry) {
      const div = document.createElement("div");
      div.className = "log-entry " + (entry.type || "info");
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      div.innerHTML = `<span class="log-time">${hh}:${mm}:${ss}</span>${entry.text}`;
      this.el.logList.appendChild(div);
      this.el.logList.scrollTop = this.el.logList.scrollHeight;
      // 控制日志条目数量上限
      while (this.el.logList.childElementCount > 120) {
        this.el.logList.removeChild(this.el.logList.firstChild);
      }
    }

    // ============================================================
    // 屏幕特效
    // ============================================================
    screenShake() {
      const g = this.el.game;
      g.classList.remove("shake");
      void g.offsetWidth; // 重置动画
      g.classList.add("shake");
      setTimeout(() => g.classList.remove("shake"), 450);
    }

    flash(color = "gold") {
      const f = this.el.flash;
      f.className = "";
      void f.offsetWidth;
      f.className = color;
      setTimeout(() => { f.className = ""; }, 600);
    }

    // 在某节点中心迸发粒子
    burst(node, color = "#ffd54a", count = 12) {
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "particle";
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = 40 + Math.random() * 60;
        p.style.left = cx + "px";
        p.style.top = cy + "px";
        p.style.background = color;
        p.style.boxShadow = "0 0 8px " + color;
        p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
        p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
        this.el.fxLayer.appendChild(p);
        setTimeout(() => p.remove(), 700);
      }
    }
  }

  window.GameView = GameView;
})();
