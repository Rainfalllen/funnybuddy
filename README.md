# 🎮 FunnyBuddy · 小游戏合集

一个用纯 HTML/CSS/JS 编写的小游戏合集。根目录是游戏大厅，每个游戏独立存放在 `games/<id>/` 下，互不耦合、可单独运行。

## ✨ 特性

- **纯前端**：无后端、无打包工具，任何静态托管都能部署。
- **逻辑 / 表现分离**：每个游戏的**核心逻辑不依赖浏览器与 DOM**，可在命令行(Node)独立运行与验证（见下文「架构约定」）。
- **PWA 离线可玩**：大厅与每个游戏各自带 Service Worker，可添加到主屏幕，断网也能玩。
- **可扩展**：新增游戏只需放入 `games/<id>/`，并在大厅配置里加一条记录。
- **响应式**：桌面端 / 平板 / 手机自适配。

## 🕹 当前收录

| 游戏 | 目录 | 简介 |
| --- | --- | --- |
| 🤡 小丑牌（Balatro JS） | `games/balatro/` | 出牌、凑牌型、组小丑、滚雪球的卡牌肉鸽 |
| 🔢 2048 | `games/2048/` | 滑动合并相同数字，挑战凑出 2048（支持键盘 / 触摸） |
| 🎲 骰子地下城（Dicey Dungeon JS） | `games/dicey/` | 掷骰子、把骰子分配到装备、闯地牢的骰子构筑肉鸽 |

> 更多游戏陆续添加中……

## 🚀 在线试玩

> 部署到 GitHub Pages 后填入实际地址：
> https://`<your-username>`.github.io/funnybuddy/

## 🛠 本地运行

```bash
node server.js
# 终端会同时打印 Local 与 Network 地址
# 手机连同一 Wi-Fi 后用 Network 地址即可在手机浏览器里玩
```

或者直接用任意静态服务器：

```bash
npx serve .
# 或
python -m http.server 8123
```

打开根地址进入大厅，点击卡片进入对应游戏。

## 🧩 架构约定：逻辑与表现分离

本合集要求**所有游戏代码都做到逻辑与表现分离**：

- **逻辑层**（规则、状态、计分、流程）必须是**纯计算**，不得直接访问 `document` / DOM、不得直接操作界面，也不得硬依赖浏览器特有 API。它通过「事件广播 + 只读查询 + 操作方法」与外界交互。
- **表现层**（渲染、动画、音效）只负责把逻辑层的状态画出来、把用户输入转成对逻辑层的调用，自身不包含任何游戏规则。
- **控制层**负责把两者连接起来，并协调动画等异步流程。

带来的直接好处：**逻辑层可以脱离浏览器，在命令行(Node)里独立跑起来**——便于自动化测试、模拟对局、回归验证。

### 命令行验证（以小丑牌为例）

```bash
npm run balatro:cli          # 自动打一局并打印全过程（牌型、计分、商店、Boss…）
npm run balatro:cli:quiet    # 只打印关键节点与最终结果
# 或直接：
node games/balatro/cli.js
```

该运行器复用与浏览器**完全相同**的逻辑层（`core/cards/jokers/planets/tarots/spectrals`），仅把「表现层」换成终端文字输出 + 一个简单自动决策器，全程不加载 `view.js` / `sfx.js`，不触碰任何 DOM。

骰子地下城同样提供命令行验证，并支持批量模拟以观察平衡（通关率）：

```bash
npm run dicey:cli            # 自动打一局并打印过程（地图、战斗、掷骰、状态、商店…）
npm run dicey:cli:quiet      # 只打印关键节点与最终结果
npm run dicey:sim            # 连续模拟 300 局，统计通关率
# 或直接（--seed 固定随机种子复现）：
node games/dicey/cli.js --runs=200 --seed=1
```

### 跨环境模块写法

逻辑层模块同时兼容浏览器与 Node：

```js
// 浏览器：随 <script> 加载后挂到 window；Node：可被 require。
(function (exported) {
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  const g = (typeof globalThis !== "undefined") ? globalThis
          : (typeof window !== "undefined") ? window : null;
  if (g) g.Cards = exported;
})({ /* 导出内容 */ });
```

依赖其它逻辑模块时，按「全局优先、`require` 兜底」解析；浏览器特有 API（如 `localStorage`）需做存在性守卫并安全降级。

## 📁 目录结构

```
.
├── index.html              # 合集大厅（首页）
├── manifest.webmanifest    # 大厅 PWA 应用清单
├── service-worker.js       # 大厅离线缓存
├── server.js               # 本地静态服务器
├── icons/                  # 大厅图标
├── css/hub.css             # 大厅样式
├── js/hub.js               # 大厅逻辑（游戏列表配置）
├── package.json            # 脚本：本地服务器 / 命令行逻辑验证
└── games/
    └── balatro/            # 🤡 小丑牌（自包含，可单独运行）
        ├── index.html
        ├── manifest.webmanifest
        ├── service-worker.js
        ├── cli.js          # 命令行运行器（无 DOM，验证逻辑可独立执行）
        ├── icons/
        ├── css/style.css
        └── js/
            ├── cards.js     # 逻辑层·扑克牌数据/牌型识别（跨环境）
            ├── jokers.js    # 逻辑层·小丑牌数据 + 效果（跨环境）
            ├── planets.js   # 逻辑层·行星牌（跨环境）
            ├── tarots.js    # 逻辑层·塔罗牌（跨环境）
            ├── spectrals.js # 逻辑层·幻灵牌（跨环境）
            ├── core.js      # 逻辑层·计分/回合/流程（不依赖 DOM，跨环境）
            ├── sfx.js       # 表现层·音效（仅浏览器）
            ├── view.js      # 表现层·DOM 渲染/动画（仅浏览器）
            └── app.js       # 控制层·连接逻辑与表现（仅浏览器）
```

## ➕ 新增一个游戏

1. 在 `games/` 下新建文件夹，例如 `games/your-game/`，放入该游戏自包含的 `index.html` 及资源。
2. 编辑 `js/hub.js`，在 `GAMES` 数组里追加一条配置：

   ```js
   {
     id: "your-game",
     title: "游戏名",
     subtitle: "副标题",
     desc: "一句话简介。",
     emoji: "🎲",
     tags: ["标签"],
     accent: "#e7b94e",
     path: "games/your-game/index.html",
     status: "ready", // 或 "soon" 显示为「敬请期待」
   }
   ```

3. 若该游戏需要离线能力，给它自带一个 Service Worker，并使用**独立的缓存名前缀**（如 `your-game-v1`），避免与大厅及其它游戏互相清理缓存。

4. **遵循「逻辑 / 表现分离」约定**：把规则与状态写进不依赖 DOM 的逻辑模块（用上文的跨环境写法导出），表现层只做渲染与输入转发。建议同时提供一个 `cli.js`，证明逻辑层能在命令行独立跑通。

## 📱 添加到主屏幕

- **Android Chrome**：菜单 → “添加到主屏幕” / 自动弹出“安装”。
- **iOS Safari**：分享按钮 → “添加到主屏幕”。

安装后启动是无浏览器栏的全屏体验，离线可用。

## 📜 License

MIT
