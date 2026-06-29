/* ============================================================
 * view.js —— 2048 表现层（只负责把逻辑层状态画出来）
 * 不包含任何游戏规则；只读 GameCore 的 getState() 快照并渲染，
 * 自身不直接改变游戏状态。仅在浏览器运行。
 * ============================================================ */
(function () {
  "use strict";

  function setPos(el, row, col) {
    el.style.setProperty("--row", row);
    el.style.setProperty("--col", col);
  }

  function View(root) {
    this.root = root || document;
    this.gridBg = this.root.getElementById("gridBg");
    this.tileContainer = this.root.getElementById("tileContainer");
    this.scoreEl = this.root.getElementById("score");
    this.bestEl = this.root.getElementById("best");
    this.message = this.root.getElementById("gameMessage");
    this.messageText = this.message ? this.message.querySelector(".msg-text") : null;
    this.size = 4;
    this._lastScore = 0;
  }

  // 仅在尺寸变化时重建底层网格
  View.prototype.setup = function (size) {
    this.size = size;
    if (this.gridBg) {
      this.gridBg.style.setProperty("--size", size);
      this.gridBg.innerHTML = "";
      for (let i = 0; i < size * size; i++) {
        const c = document.createElement("div");
        c.className = "grid-cell";
        this.gridBg.appendChild(c);
      }
    }
    if (this.tileContainer) this.tileContainer.style.setProperty("--size", size);
  };

  View.prototype.render = function (state) {
    if (state.size !== this.size) this.setup(state.size);

    // 分数（带一个 +delta 的小飘动）
    if (this.scoreEl) {
      const delta = state.score - this._lastScore;
      this.scoreEl.textContent = state.score;
      if (delta > 0) this._floatScore(delta);
    }
    this._lastScore = state.score;
    if (this.bestEl) this.bestEl.textContent = state.best;

    // 重建 tile（经典做法：每帧重画，借助上一帧位置做滑动动画）
    const cont = this.tileContainer;
    if (cont) {
      cont.innerHTML = "";
      state.tiles.forEach((t) => {
        if (t.mergedFrom) {
          // 两张来源牌先滑到合并位置
          t.mergedFrom.forEach((src) => {
            this._addTile(src.value, t.row, t.col, { fromRow: src.prevRow, fromCol: src.prevCol });
          });
          // 合并后的新牌叠在上面，做一个弹跳
          this._addTile(t.value, t.row, t.col, { merged: true });
        } else if (t.isNew) {
          this._addTile(t.value, t.row, t.col, { isNew: true });
        } else {
          this._addTile(t.value, t.row, t.col, { fromRow: t.prevRow, fromCol: t.prevCol });
        }
      });
    }

    // 胜负提示
    if (this.message) {
      this.message.classList.remove("is-win", "is-over", "show");
      if (state.over) {
        if (this.messageText) this.messageText.textContent = "游戏结束";
        this.message.classList.add("is-over", "show");
      } else if (state.won && !state.keepPlaying) {
        if (this.messageText) this.messageText.textContent = "你赢了！";
        this.message.classList.add("is-win", "show");
      }
    }
  };

  View.prototype._addTile = function (value, row, col, opts) {
    opts = opts || {};
    const el = document.createElement("div");
    const cls = value > 2048 ? "tile-super" : "tile-" + value;
    el.className = "tile " + cls;
    const inner = document.createElement("div");
    inner.className = "tile-inner";
    inner.textContent = value;
    el.appendChild(inner);

    const hasFrom = opts.fromRow != null;
    const startRow = hasFrom ? opts.fromRow : row;
    const startCol = hasFrom ? opts.fromCol : col;
    setPos(el, startRow, startCol);

    if (opts.merged) el.classList.add("tile-merged");
    if (opts.isNew) el.classList.add("tile-new");

    this.tileContainer.appendChild(el);

    // 需要滑动：下一帧把位置改到目标，触发 CSS transition
    if (hasFrom && (startRow !== row || startCol !== col)) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPos(el, row, col));
      });
    }
  };

  View.prototype._floatScore = function (delta) {
    if (!this.scoreEl) return;
    const f = document.createElement("div");
    f.className = "score-add";
    f.textContent = "+" + delta;
    this.scoreEl.appendChild(f);
    setTimeout(() => f.remove(), 600);
  };

  const __root =
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : null;
  if (__root) __root.View = View;
})();
