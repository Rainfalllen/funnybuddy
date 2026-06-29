/* ============================================================
 * core.js —— 2048 逻辑层（纯计算，不依赖 DOM）
 * 既能在浏览器随 <script> 加载（挂到 window.Game2048），
 * 也能在 Node 命令行 require（module.exports）。
 *
 * 与外界仅通过三类接口交互（README 的「逻辑/表现分离」约定）：
 *   1. 事件广播：on(evt, fn) 订阅；内部 emit 推送状态变化
 *   2. 只读查询：getState() 返回可序列化快照
 *   3. 操作方法：newGame / move / continueGame / loadGame …
 * ============================================================ */
(function () {
  "use strict";

  const DEFAULT_SIZE = 4;
  const WIN_VALUE = 2048;
  const START_TILES = 2;
  const SAVE_KEY = "funnybuddy_2048";

  // 方向向量：dr=行增量，dc=列增量
  const VECTORS = {
    up: { dr: -1, dc: 0 },
    right: { dr: 0, dc: 1 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
  };

  // ---- 存储抽象：仅浏览器启用 localStorage；命令行下为 null，安全降级 ----
  const __storage =
    typeof window !== "undefined" && window.localStorage ? window.localStorage : null;

  let __tileSeq = 1;

  function makeTile(row, col, value) {
    return {
      id: __tileSeq++,
      row: row,
      col: col,
      value: value,
      prevRow: row,
      prevCol: col,
      mergedFrom: null, // 合并产生时记录来源 [tileA, tileB]
      isNew: true,
    };
  }

  function Game2048(opts) {
    opts = opts || {};
    this.size = opts.size || DEFAULT_SIZE;
    // 注入随机源，便于 CLI / 测试复现（默认 Math.random）
    this._rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    this._listeners = Object.create(null);
    this.cells = this._emptyBoard();
    this.score = 0;
    this.best = this._loadBest();
    this.over = false;
    this.won = false;
    this.keepPlaying = false;
  }

  /* ----------------------------- 事件 ----------------------------- */
  Game2048.prototype.on = function (evt, fn) {
    (this._listeners[evt] || (this._listeners[evt] = [])).push(fn);
    return this;
  };
  Game2048.prototype.off = function (evt, fn) {
    const arr = this._listeners[evt];
    if (arr) this._listeners[evt] = arr.filter((f) => f !== fn);
    return this;
  };
  Game2048.prototype.emit = function (evt, data) {
    const arr = this._listeners[evt];
    if (arr) arr.slice().forEach((fn) => fn(data));
  };

  /* --------------------------- 棋盘工具 --------------------------- */
  Game2048.prototype._emptyBoard = function () {
    const board = [];
    for (let r = 0; r < this.size; r++) {
      const row = [];
      for (let c = 0; c < this.size; c++) row.push(null);
      board.push(row);
    }
    return board;
  };

  Game2048.prototype._eachCell = function (cb) {
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++) cb(r, c, this.cells[r][c]);
  };

  Game2048.prototype._withinBounds = function (pos) {
    return pos.row >= 0 && pos.row < this.size && pos.col >= 0 && pos.col < this.size;
  };

  Game2048.prototype._cellEmpty = function (pos) {
    return this._withinBounds(pos) && !this.cells[pos.row][pos.col];
  };

  Game2048.prototype._tileAt = function (pos) {
    return this._withinBounds(pos) ? this.cells[pos.row][pos.col] : null;
  };

  Game2048.prototype._emptyCells = function () {
    const out = [];
    this._eachCell((r, c, tile) => {
      if (!tile) out.push({ row: r, col: c });
    });
    return out;
  };

  Game2048.prototype._randomEmptyCell = function () {
    const cells = this._emptyCells();
    if (!cells.length) return null;
    return cells[Math.floor(this._rng() * cells.length)];
  };

  /* ----------------------------- 操作 ----------------------------- */
  Game2048.prototype.newGame = function () {
    this.cells = this._emptyBoard();
    this.score = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;
    for (let i = 0; i < START_TILES; i++) this.addRandomTile(true);
    this._save();
    this.emit("init", this.getState());
    this.emit("change", this.getState());
    return this;
  };

  Game2048.prototype.addRandomTile = function (silent) {
    const cell = this._randomEmptyCell();
    if (!cell) return null;
    const value = this._rng() < 0.9 ? 2 : 4;
    const tile = makeTile(cell.row, cell.col, value);
    this.cells[cell.row][cell.col] = tile;
    if (!silent) this.emit("spawn", { row: cell.row, col: cell.col, value: value });
    return tile;
  };

  // 移动前重置每个 tile 的动画标记，并记录上一帧位置
  Game2048.prototype._prepareTiles = function () {
    this._eachCell((r, c, tile) => {
      if (tile) {
        tile.mergedFrom = null;
        tile.prevRow = tile.row;
        tile.prevCol = tile.col;
        tile.isNew = false;
      }
    });
  };

  Game2048.prototype._buildTraversals = function (vector) {
    const rows = [];
    const cols = [];
    for (let i = 0; i < this.size; i++) {
      rows.push(i);
      cols.push(i);
    }
    // 总是从「移动方向的远端」开始遍历，保证先处理最靠边的格子
    if (vector.dr === 1) rows.reverse();
    if (vector.dc === 1) cols.reverse();
    return { rows: rows, cols: cols };
  };

  Game2048.prototype._findFarthest = function (cell, vector) {
    let previous;
    let next = { row: cell.row, col: cell.col };
    do {
      previous = next;
      next = { row: previous.row + vector.dr, col: previous.col + vector.dc };
    } while (this._cellEmpty(next));
    return { farthest: previous, next: next };
  };

  Game2048.prototype._moveTile = function (tile, to) {
    this.cells[tile.row][tile.col] = null;
    this.cells[to.row][to.col] = tile;
    tile.row = to.row;
    tile.col = to.col;
  };

  /**
   * 朝某方向移动一步。
   * @param {"up"|"down"|"left"|"right"} direction
   * @returns {boolean} 本次是否有牌移动/合并
   */
  Game2048.prototype.move = function (direction) {
    if (this.over || (this.won && !this.keepPlaying)) return false;
    const vector = VECTORS[direction];
    if (!vector) return false;

    const traversals = this._buildTraversals(vector);
    let moved = false;

    this._prepareTiles();

    traversals.rows.forEach((row) => {
      traversals.cols.forEach((col) => {
        const tile = this.cells[row][col];
        if (!tile) return;

        const positions = this._findFarthest({ row: row, col: col }, vector);
        const next = this._tileAt(positions.next);

        if (next && next.value === tile.value && !next.mergedFrom) {
          // 合并：生成新牌，保留来源以便表现层做动画
          const merged = makeTile(positions.next.row, positions.next.col, tile.value * 2);
          merged.isNew = false;
          merged.mergedFrom = [tile, next];

          this.cells[positions.next.row][positions.next.col] = merged;
          this.cells[row][col] = null;
          // 被合并的 tile 滑向目标位置（动画用）
          tile.row = positions.next.row;
          tile.col = positions.next.col;

          this.score += merged.value;
          if (merged.value === WIN_VALUE && !this.won) this.won = true;
          moved = true;
        } else if (positions.farthest.row !== row || positions.farthest.col !== col) {
          this._moveTile(tile, positions.farthest);
          moved = true;
        }
      });
    });

    if (moved) {
      this.addRandomTile();
      if (this.score > this.best) {
        this.best = this.score;
        this._saveBest();
      }
      if (!this.movesAvailable()) this.over = true;
      this._save();

      this.emit("move", { direction: direction });
      this.emit("change", this.getState());
      if (this.won && !this.keepPlaying) this.emit("win", { score: this.score });
      if (this.over) this.emit("gameover", { score: this.score });
    }
    return moved;
  };

  Game2048.prototype.continueGame = function () {
    this.keepPlaying = true;
    this.emit("change", this.getState());
    return this;
  };

  Game2048.prototype.movesAvailable = function () {
    return this._emptyCells().length > 0 || this._tileMatchesAvailable();
  };

  Game2048.prototype._tileMatchesAvailable = function () {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const tile = this.cells[r][c];
        if (!tile) continue;
        for (const key in VECTORS) {
          const v = VECTORS[key];
          const other = this._tileAt({ row: r + v.dr, col: c + v.dc });
          if (other && other.value === tile.value) return true;
        }
      }
    }
    return false;
  };

  /* --------------------------- 只读查询 --------------------------- */
  Game2048.prototype.getState = function () {
    const tiles = [];
    this._eachCell((r, c, tile) => {
      if (!tile) return;
      tiles.push({
        id: tile.id,
        value: tile.value,
        row: r,
        col: c,
        prevRow: tile.prevRow,
        prevCol: tile.prevCol,
        isNew: tile.isNew,
        mergedFrom: tile.mergedFrom
          ? tile.mergedFrom.map((t) => ({
              id: t.id,
              value: t.value,
              prevRow: t.prevRow,
              prevCol: t.prevCol,
            }))
          : null,
      });
    });
    const grid = this.cells.map((rowArr) => rowArr.map((t) => (t ? t.value : 0)));
    return {
      size: this.size,
      score: this.score,
      best: this.best,
      over: this.over,
      won: this.won,
      keepPlaying: this.keepPlaying,
      grid: grid,
      tiles: tiles,
    };
  };

  // 命令行/调试友好：把当前棋盘渲染成文本
  Game2048.prototype.toString = function () {
    const w = 6;
    const line = "+" + "------+".repeat(this.size);
    let out = line + "\n";
    for (let r = 0; r < this.size; r++) {
      let row = "|";
      for (let c = 0; c < this.size; c++) {
        const v = this.cells[r][c] ? String(this.cells[r][c].value) : ".";
        const pad = w - v.length;
        const left = Math.floor(pad / 2);
        row += " ".repeat(left) + v + " ".repeat(pad - left) + "|";
      }
      out += row + "\n" + line + "\n";
    }
    return out;
  };

  /* ----------------------------- 存档 ----------------------------- */
  Game2048.prototype.hasSave = function () {
    try {
      const raw = __storage && __storage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return !!(data && data.grid && !data.over);
    } catch (e) {
      return false;
    }
  };

  Game2048.prototype.loadGame = function () {
    try {
      const raw = __storage && __storage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.grid) return false;
      this.size = data.size || DEFAULT_SIZE;
      this.cells = this._emptyBoard();
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const v = data.grid[r] && data.grid[r][c];
          if (v) {
            const tile = makeTile(r, c, v);
            tile.isNew = false;
            this.cells[r][c] = tile;
          }
        }
      }
      this.score = data.score || 0;
      this.won = !!data.won;
      this.over = !!data.over;
      this.keepPlaying = !!data.keepPlaying;
      this.emit("init", this.getState());
      this.emit("change", this.getState());
      return true;
    } catch (e) {
      return false;
    }
  };

  Game2048.prototype.clearSave = function () {
    try {
      if (__storage) __storage.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  };

  Game2048.prototype._save = function () {
    if (!__storage) return;
    try {
      const data = {
        size: this.size,
        score: this.score,
        won: this.won,
        over: this.over,
        keepPlaying: this.keepPlaying,
        grid: this.cells.map((rowArr) => rowArr.map((t) => (t ? t.value : 0))),
      };
      __storage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      /* 存储失败静默 */
    }
  };

  Game2048.prototype._loadBest = function () {
    try {
      return (__storage && parseInt(__storage.getItem(SAVE_KEY + "_best"), 10)) || 0;
    } catch (e) {
      return 0;
    }
  };

  Game2048.prototype._saveBest = function () {
    try {
      if (__storage) __storage.setItem(SAVE_KEY + "_best", String(this.best));
    } catch (e) {
      /* ignore */
    }
  };

  /* --------------------- 通用导出（浏览器 / Node） --------------------- */
  const __root =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof window !== "undefined"
      ? window
      : null;
  if (typeof module !== "undefined" && module.exports) module.exports = Game2048;
  if (__root) __root.Game2048 = Game2048;
})();
