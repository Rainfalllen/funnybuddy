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
        shopOwnedJokers: $("shopOwnedJokers"), shopOwnedCount: $("shopOwnedCount"),
        rerollBtn: $("rerollBtn"), nextRoundBtn: $("nextRoundBtn"),
        blindOverlay: $("blindOverlay"), blindSelectTitle: $("blindSelectTitle"), blindCards: $("blindCards"),
        openShopBtn: $("openShopBtn"),
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
      const sellValue = Math.max(1, Math.floor(j.price / 2));
      // idx >= 0 表示是局内（牌桌区）持有的小丑牌，需要 × 卖出按钮
      const sellBtnHtml = idx >= 0 ? `<button class="joker-x" title="卖出 +$${sellValue}" aria-label="卖出">×</button>` : "";
      node.innerHTML = `
        <div class="joker-holo"></div>
        <div class="joker-shine"></div>
        ${sellBtnHtml}
        <div class="joker-face">${j.face}</div>
        <div class="joker-name">${j.name}</div>
        <div class="joker-effect">${j.desc}</div>
        <div class="joker-sell">$${sellValue}</div>
        <div class="joker-rarity-badge">${
          rarity === "uncommon" ? "稀有" : rarity === "rare" ? "罕见" : rarity === "legendary" ? "传说" : "普通"
        }</div>
        <div class="tip"><b>${j.name}</b><br>${j.desc}</div>
      `;

      if (idx >= 0) {
        // 局内卖牌：无 confirm，直接卖出并播放动画
        const sell = () => {
          this.animateSellJoker(node, sellValue).then(() => {
            this.handlers.onSellJoker(idx);
          });
        };
        // × 按钮：任何端点击都直接卖出（阻止冒泡，避免触发牌面其它逻辑）
        const xBtn = node.querySelector(".joker-x");
        if (xBtn) {
          xBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            sell();
          });
          // 触屏上 touchstart 同样要阻断冒泡，避免触发 hover/tip
          xBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
        }

        const isTouchEnv = window.matchMedia("(hover: none)").matches;
        if (isTouchEnv) {
          // 触屏：单击牌面只切换 tip，卖出走 × 按钮
          node.addEventListener("click", () => {
            document.querySelectorAll(".joker.show-tip").forEach((n) => { if (n !== node) n.classList.remove("show-tip"); });
            node.classList.toggle("show-tip");
          });
        } else {
          // 鼠标：单击牌面直接卖出（hover 即可看完整说明）
          node.onclick = () => sell();
        }
      } else {
        // 商店里小丑牌（idx<0）：触屏单击切换 tip
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

      // 在盲注选择阶段也允许进入商店（用现有资金买卖/重排）
      if (this.el.openShopBtn) {
        this.el.openShopBtn.onclick = () => this.handlers.onOpenShop();
      }

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

      // ----- 待售小丑牌 -----
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

      // ----- 我的小丑牌（可卖 + 可拖拽重排）-----
      e.shopOwnedCount.textContent = `${s.jokers.length}/${s.maxJokers}`;
      e.shopOwnedJokers.innerHTML = "";
      if (!s.jokers.length) {
        e.shopOwnedJokers.innerHTML = '<div style="color:#9bb0a8">还没有小丑牌，去商店买一张吧</div>';
      }
      s.jokers.forEach((j, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "shop-item owned-item";
        wrap.draggable = true;
        wrap.dataset.idx = idx;

        // 复用 _jokerNode，但用一个不与"鼠标点击=卖出"冲突的 idx（-2 表示商店里的已拥有）
        const jokerEl = this._jokerNode(j, -2);
        wrap.appendChild(jokerEl);

        const value = Math.max(1, Math.floor(j.price / 2));
        const sell = document.createElement("button");
        sell.className = "btn btn-discard buy";
        sell.textContent = `卖出 +$${value}`;
        sell.onclick = (ev) => {
          ev.stopPropagation();
          // 复用小丑触发风格的卖牌动画（无 confirm）
          this.animateSellJoker(jokerEl, value).then(() => {
            this.handlers.onSellJoker(idx);
          });
        };
        wrap.appendChild(sell);

        // ---- HTML5 拖拽重排 ----
        wrap.addEventListener("dragstart", (ev) => {
          wrap.classList.add("dragging");
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", String(idx));
        });
        wrap.addEventListener("dragend", () => {
          wrap.classList.remove("dragging");
          e.shopOwnedJokers.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
        });
        wrap.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          wrap.classList.add("drop-target");
        });
        wrap.addEventListener("dragleave", () => wrap.classList.remove("drop-target"));
        wrap.addEventListener("drop", (ev) => {
          ev.preventDefault();
          wrap.classList.remove("drop-target");
          const from = parseInt(ev.dataTransfer.getData("text/plain"), 10);
          const to = parseInt(wrap.dataset.idx, 10);
          if (Number.isInteger(from) && Number.isInteger(to)) {
            this.handlers.onReorderJoker(from, to);
          }
        });

        // ---- 触屏长按拖拽（简化版：长按高亮 + 再点目标位置完成移动）----
        let lpTimer = null;
        let isMoving = false;
        jokerEl.addEventListener("touchstart", () => {
          lpTimer = setTimeout(() => {
            isMoving = true;
            e.shopOwnedJokers.classList.add("moving-mode");
            wrap.classList.add("dragging");
          }, 500);
        }, { passive: true });
        jokerEl.addEventListener("touchend", () => clearTimeout(lpTimer));
        jokerEl.addEventListener("touchmove", () => clearTimeout(lpTimer));
        wrap.addEventListener("click", (ev) => {
          if (!e.shopOwnedJokers.classList.contains("moving-mode")) return;
          // 处于移动模式：点击其他位置即作为目标
          const draggingEl = e.shopOwnedJokers.querySelector(".dragging");
          if (!draggingEl || draggingEl === wrap) {
            // 点自己：取消
            e.shopOwnedJokers.classList.remove("moving-mode");
            if (draggingEl) draggingEl.classList.remove("dragging");
            return;
          }
          const from = parseInt(draggingEl.dataset.idx, 10);
          const to = parseInt(wrap.dataset.idx, 10);
          e.shopOwnedJokers.classList.remove("moving-mode");
          draggingEl.classList.remove("dragging");
          if (Number.isInteger(from) && Number.isInteger(to)) {
            this.handlers.onReorderJoker(from, to);
          }
          ev.stopPropagation();
        }, true);

        e.shopOwnedJokers.appendChild(wrap);
      });
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

    // 卖出小丑牌动画：碎片炸开 + 金色光环 + 金币粒子 + +$N 飘字 + 闪光 + 金币音效
    // 返回 Promise，动画播完才 resolve，让控制层在动画结束后再真正从数据里移除该牌。
    animateSellJoker(node, value) {
      return new Promise((resolve) => {
        const r = node.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        // 1) 音效 + 闪光 + 金币粒子两轮
        if (window.SFX) window.SFX.coin();
        this.flash("gold");
        this.burst(node, "#ffd54a", 18);
        setTimeout(() => this.burst(node, "#ffe98a", 12), 80);
        // 2) +$N 飘字
        this._floaterAt(node, "+$" + value, "money", -10);

        // 3) 把原牌临时隐藏，原位置生成碎片
        node.style.visibility = "hidden";
        node.style.pointerEvents = "none";

        // 4) 生成碎片：用 SVG 切多边形碎块，每块都是原牌的克隆但用 clip-path 显示一块
        const SHARDS = [
          // 多边形碎片 clip-path（百分比坐标），覆盖整张牌
          "polygon(0% 0%, 50% 0%, 30% 50%, 0% 60%)",
          "polygon(50% 0%, 100% 0%, 100% 45%, 60% 35%, 30% 50%)",
          "polygon(0% 60%, 30% 50%, 45% 100%, 0% 100%)",
          "polygon(30% 50%, 60% 35%, 70% 70%, 45% 100%)",
          "polygon(60% 35%, 100% 45%, 100% 75%, 70% 70%)",
          "polygon(45% 100%, 70% 70%, 100% 75%, 100% 100%)",
          "polygon(0% 0%, 30% 25%, 0% 40%)",
          "polygon(70% 0%, 100% 0%, 100% 30%, 80% 20%)",
        ];

        SHARDS.forEach((clip, i) => {
          // 克隆原牌，作为碎片底图
          const shard = node.cloneNode(true);
          shard.classList.remove("selling", "show-tip", "joker-enter");
          // 去掉碎片里的 × 按钮、tip、ring 等交互元素
          shard.querySelectorAll(".joker-x, .tip, .joker-ring").forEach((n) => n.remove());
          shard.style.position = "fixed";
          shard.style.left = r.left + "px";
          shard.style.top = r.top + "px";
          shard.style.width = r.width + "px";
          shard.style.height = r.height + "px";
          shard.style.margin = "0";
          shard.style.zIndex = "215";
          shard.style.pointerEvents = "none";
          shard.style.clipPath = clip;
          shard.style.webkitClipPath = clip;
          shard.style.filter = "brightness(1.25) saturate(1.3) drop-shadow(0 0 8px #ffd54aaa)";
          shard.classList.add("joker-shard");

          // 飞散方向：以牌中心为原点，给每块一个朝外的随机向量
          const ang = (Math.PI * 2 * i) / SHARDS.length + (Math.random() - 0.5) * 0.6;
          const dist = 120 + Math.random() * 120;
          const dx = Math.cos(ang) * dist;
          const dy = Math.sin(ang) * dist - 30; // 略上扬
          const rot = (Math.random() - 0.5) * 720; // 旋转角度
          shard.style.setProperty("--sx", dx + "px");
          shard.style.setProperty("--sy", dy + "px");
          shard.style.setProperty("--srot", rot + "deg");
          // 重力让后半段往下掉
          shard.style.setProperty("--sy2", (dy + 220) + "px");

          this.el.fxLayer.appendChild(shard);
          setTimeout(() => shard.remove(), 720);
        });

        // 5) 中心爆炸光圈
        const flash = document.createElement("div");
        flash.className = "joker-explode-ring";
        flash.style.left = cx + "px";
        flash.style.top = cy + "px";
        this.el.fxLayer.appendChild(flash);
        setTimeout(() => flash.remove(), 600);

        // 6) 动画结束后 resolve（让 core 移除该牌、view 重新渲染）
        setTimeout(() => resolve(), 520);
      });
    }
  }

  window.GameView = GameView;
})();
