/* ============================================================
 * app.js —— 2048 控制层（连接逻辑层与表现层）
 * 负责：把用户输入（键盘 / 触摸 / 按钮）转成对逻辑层的调用，
 * 并把逻辑层广播的状态交给表现层渲染。自身不含游戏规则。
 * 仅在浏览器运行。
 * ============================================================ */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    const game = new window.Game2048();
    const view = new window.View(document);
    view.setup(4);

    // 逻辑 → 表现：订阅状态变化
    game.on("init", (s) => view.render(s));
    game.on("change", (s) => view.render(s));

    // 启动：有存档则续上，否则开新局
    if (game.hasSave()) game.loadGame();
    else game.newGame();

    function startNew() {
      game.clearSave();
      game.newGame();
    }

    /* ----------------------- 键盘输入 ----------------------- */
    const KEY_MAP = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
      W: "up",
      S: "down",
      A: "left",
      D: "right",
      k: "up",
      j: "down",
      h: "left",
      l: "right",
    };
    document.addEventListener("keydown", function (e) {
      // 回退快捷键：U / Z，或 Ctrl/Cmd+Z
      if (e.key === "u" || e.key === "U" || e.key === "z" || e.key === "Z") {
        if (e.altKey) return;
        e.preventDefault();
        game.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = KEY_MAP[e.key];
      if (!dir) return;
      e.preventDefault();
      game.move(dir);
    });

    /* ----------------------- 触摸滑动 ----------------------- */
    const board = document.getElementById("board");
    if (board) {
      let sx = 0,
        sy = 0,
        tracking = false;
      const THRESHOLD = 24;
      board.addEventListener(
        "touchstart",
        function (e) {
          if (e.touches.length !== 1) return;
          sx = e.touches[0].clientX;
          sy = e.touches[0].clientY;
          tracking = true;
        },
        { passive: true }
      );
      board.addEventListener(
        "touchmove",
        function (e) {
          if (tracking) e.preventDefault();
        },
        { passive: false }
      );
      board.addEventListener(
        "touchend",
        function (e) {
          if (!tracking) return;
          tracking = false;
          const t = e.changedTouches[0];
          const dx = t.clientX - sx;
          const dy = t.clientY - sy;
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          if (Math.max(adx, ady) < THRESHOLD) return;
          let dir;
          if (adx > ady) dir = dx > 0 ? "right" : "left";
          else dir = dy > 0 ? "down" : "up";
          game.move(dir);
        },
        { passive: true }
      );
    }

    /* ----------------------- 按钮 ----------------------- */
    const newBtn = document.getElementById("newGameBtn");
    if (newBtn) newBtn.addEventListener("click", startNew);

    const undoBtn = document.getElementById("undoBtn");
    if (undoBtn) undoBtn.addEventListener("click", () => game.undo());

    const retryBtn = document.getElementById("retryBtn");
    if (retryBtn) retryBtn.addEventListener("click", startNew);

    const keepBtn = document.getElementById("keepPlayingBtn");
    if (keepBtn) keepBtn.addEventListener("click", () => game.continueGame());

    // 暴露给控制台调试
    window.__game2048 = game;
  });
})();
