# 🤡 小丑牌 · Balatro JS

一个用纯 HTML/CSS/JS 编写的 Balatro 风格扑克 Roguelike 小游戏。

## ✨ 特性

- **纯前端**：无后端、无打包工具，任何静态托管都能部署。
- **PWA 离线可玩**：可添加到主屏幕，断网也能开局。
- **响应式**：桌面端 / 平板 / 手机自适配。
- **特效拉满**：Balatro 风格小丑牌全息流光、稀有度光环、粒子爆发、屏幕震动。
- **分层架构**：`core.js` 逻辑层 / `view.js` 表现层 / `app.js` 控制层互不耦合。

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

## 📁 目录结构

```
.
├── index.html              # 主页
├── manifest.webmanifest    # PWA 应用清单
├── service-worker.js       # PWA 离线缓存
├── icons/                  # 图标
├── css/style.css           # 全部样式
└── js/
    ├── cards.js            # 扑克牌数据
    ├── jokers.js           # 小丑牌数据 + 效果
    ├── core.js             # 逻辑层（牌型识别、计分、回合）
    ├── view.js             # 表现层（DOM 渲染、动画）
    └── app.js              # 控制层（连接逻辑与表现）
```

## 📱 添加到主屏幕

- **Android Chrome**：菜单 → "添加到主屏幕" / 自动弹出"安装"。
- **iOS Safari**：分享按钮 → "添加到主屏幕"。

安装后启动是无浏览器栏的全屏体验，离线可用。

## 🎮 玩法简介

- 选择手牌打出最佳牌型，达到目标分数通过当前盲注。
- 通关后到商店购买**小丑牌**，叠加各种 Buff。
- 8 个底注全部击败即获胜。

## 📜 License

MIT
