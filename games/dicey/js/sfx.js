/* ============================================================
 * sfx.js —— 程序化音效（Web Audio API，无需音频文件）
 * 表现层组件，仅在浏览器运行。首次用户交互后才会激活（浏览器策略）。
 * 暴露：window.SFX.roll() / hit() / shield() / heal() / status()
 *       / buy() / coin() / click() / win() / lose() / setEnabled()
 * ============================================================ */
(function () {
  "use strict";
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!enabled) return null;
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch (e) { enabled = false; return null; }
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

  // 通用：合成一个带包络的音
  function tone({ freq = 880, dur = 0.12, type = "sine", gain = 0.16, attack = 0.005, decay = 0.12, freqEnd = null }) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.02);
  }
  // 噪声脉冲（用于骰子/打击的“沙沙/咚”质感）
  function noise({ dur = 0.12, gain = 0.12, hp = 600 }) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const filt = c.createBiquadFilter(); filt.type = "highpass"; filt.frequency.value = hp;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(filt).connect(g).connect(c.destination);
    src.start(t0);
  }

  // 掷骰子：连续几个清脆的“嗒嗒”
  function roll() {
    noise({ dur: 0.05, gain: 0.10, hp: 1200 });
    setTimeout(() => noise({ dur: 0.05, gain: 0.09, hp: 1400 }), 70);
    setTimeout(() => noise({ dur: 0.06, gain: 0.08, hp: 1000 }), 150);
  }
  // 命中：低频“咚”+噪声
  function hit() {
    tone({ freq: 180, freqEnd: 90, dur: 0.14, type: "sine", gain: 0.2, attack: 0.002, decay: 0.16 });
    noise({ dur: 0.08, gain: 0.10, hp: 500 });
  }
  // 护盾：金属“叮”
  function shield() { tone({ freq: 700, freqEnd: 1100, dur: 0.12, type: "triangle", gain: 0.12, attack: 0.003, decay: 0.14 }); }
  // 治疗：柔和上扬
  function heal() {
    tone({ freq: 520, dur: 0.10, type: "sine", gain: 0.12, attack: 0.005, decay: 0.12 });
    setTimeout(() => tone({ freq: 780, dur: 0.14, type: "sine", gain: 0.12, attack: 0.005, decay: 0.16 }), 70);
  }
  // 施加状态：颤动“呜”
  function status() { tone({ freq: 360, freqEnd: 760, dur: 0.16, type: "sawtooth", gain: 0.10, attack: 0.003, decay: 0.18 }); }
  // 购买：低 → 高小琶音
  function buy() {
    tone({ freq: 660, dur: 0.09, type: "triangle", gain: 0.14, attack: 0.003, decay: 0.10 });
    setTimeout(() => tone({ freq: 990, dur: 0.12, type: "sine", gain: 0.14, attack: 0.003, decay: 0.14 }), 80);
  }
  // 金币
  function coin() { tone({ freq: 1320, freqEnd: 1180, dur: 0.14, type: "triangle", gain: 0.14, attack: 0.003, decay: 0.16 }); }
  // 通用点击
  function click() { tone({ freq: 720, freqEnd: 540, dur: 0.05, type: "square", gain: 0.06, attack: 0.002, decay: 0.06 }); }
  // 胜利
  function win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.18, type: "triangle", gain: 0.14, decay: 0.2 }), i * 110));
  }
  // 失败
  function lose() {
    [440, 350, 260].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.22, type: "sawtooth", gain: 0.12, decay: 0.24 }), i * 140));
  }

  function setEnabled(v) { enabled = !!v; }

  window.SFX = { roll, hit, shield, heal, status, buy, coin, click, win, lose, setEnabled };
})();
