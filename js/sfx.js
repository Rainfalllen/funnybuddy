/* ============================================================
 * sfx.js —— 程序化音效（Web Audio API，无需音频文件）
 * 首次用户交互后才会激活（浏览器策略）。
 * 暴露：window.SFX.coin() / SFX.buy() / SFX.click()
 * ============================================================ */
(function () {
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!enabled) return null;
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch (e) {
      enabled = false;
      return null;
    }
    return ctx;
  }
  // 首次用户手势后解锁 AudioContext（iOS/Android 浏览器策略）
  function unlock() {
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  }
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("touchstart", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });

  // 通用：合成一个带包络的 sine/triangle 音
  function tone({ freq = 880, dur = 0.12, type = "sine", gain = 0.18, attack = 0.005, decay = 0.12, freqEnd = null }) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.02);
  }

  // 金币"叮~"：两个音高的快速叠加，带轻微下行
  function coin() {
    tone({ freq: 1320, freqEnd: 1180, dur: 0.16, type: "triangle", gain: 0.18, attack: 0.004, decay: 0.18 });
    setTimeout(() => {
      tone({ freq: 1760, freqEnd: 1560, dur: 0.18, type: "sine", gain: 0.14, attack: 0.004, decay: 0.20 });
    }, 50);
  }

  // 购买：低 → 高的小琶音
  function buy() {
    tone({ freq: 660, dur: 0.10, type: "triangle", gain: 0.16, attack: 0.004, decay: 0.10 });
    setTimeout(() => tone({ freq: 880, dur: 0.10, type: "triangle", gain: 0.16, attack: 0.004, decay: 0.10 }), 60);
    setTimeout(() => tone({ freq: 1320, dur: 0.14, type: "sine", gain: 0.16, attack: 0.004, decay: 0.18 }), 120);
  }

  // 通用 UI 点击
  function click() {
    tone({ freq: 720, freqEnd: 540, dur: 0.05, type: "square", gain: 0.06, attack: 0.002, decay: 0.06 });
  }

  // 出牌/小丑触发的小提示（保留接口，未来用）
  function pop() {
    tone({ freq: 980, freqEnd: 1480, dur: 0.10, type: "sine", gain: 0.12, attack: 0.002, decay: 0.12 });
  }

  function setEnabled(v) { enabled = !!v; }

  window.SFX = { coin, buy, click, pop, setEnabled };
})();
