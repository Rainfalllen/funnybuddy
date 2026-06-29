# 🎮 FunnyBuddy · 小游戏合集

一个用纯 HTML/CSS/JS 编写的小游戏合集。根目录是游戏大厅，每个游戏独立存放在 `games/<id>/` 下，互不耦合、可单独运行。

## ✨ 特性

- **纯前端**：无后端、无打包工具，任何静态托管都能部署。
- **PWA 离线可玩**：大厅与每个游戏各自带 Service Worker，可添加到主屏幕，断网也能玩。
- **可扩展**：新增游戏只需放入 `games/<id>/`，并在大厅配置里加一条记录。
- **响应式**：桌面端 / 平板 / 手机自适配。

## 🕹 当前收录

| 游戏 | 目录 | 简介 |
| --- | --- | --- |
| 🤡 小丑牌（Balatro JS） | `games/balatro/` | 出牌、凑牌型、组小丑、滚雪球的卡牌肉鸽 |

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
└── games/
    └── balatro/            # 🤡 小丑牌（自包含，可单独运行）
        ├── index.html
        ├── manifest.webmanifest
        ├── service-worker.js
        ├── icons/
        ├── css/style.css
        └── js/
            ├── cards.js     # 扑克牌数据
            ├── jokers.js    # 小丑牌数据 + 效果
            ├── planets.js   # 行星牌
            ├── tarots.js    # 塔罗牌
            ├── spectrals.js # 幻灵牌
            ├── sfx.js       # 音效
            ├── core.js      # 逻辑层（牌型识别、计分、回合）
            ├── view.js      # 表现层（DOM 渲染、动画）
            └── app.js       # 控制层（连接逻辑与表现）
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

## 📱 添加到主屏幕

- **Android Chrome**：菜单 → “添加到主屏幕” / 自动弹出“安装”。
- **iOS Safari**：分享按钮 → “添加到主屏幕”。

安装后启动是无浏览器栏的全屏体验，离线可用。

## 📜 License

MIT
