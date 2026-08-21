# Bookkeeping 记账

本地优先的个人记账应用，单文件 HTML 运行，数据存储在设备本地（WebView / localStorage），隐私安全，无需联网。

## 下载 APK（Android）

点击右侧 **Releases** → 选择 **Bookkeeping APK（最新版）** → 下载 `app-debug.apk`，安装时允许「安装未知应用」即可。

> 每次代码更新后 GitHub Actions 会自动重新构建并发布到 Releases，下载最新版即可。

也可通过 Actions 页面下载构建产物：进入某个运行记录 → 底部 **Artifacts** → `bookkeeping-apk`。

## 功能

- 💰 支出 / 收入 / 转账三类交易
- 📊 月度统计 & 分类占比
- 📋 原预算 vs 实际扣款对比
- 🔁 固定支出模板 + 快捷记账
- 🔍 交易搜索
- 📱 自定义账户管理（现金 / 理财，支持删除）
- 📤 CSV 导出 / 导入（含账户结构同步，跨端加账户自动合并）
- 📥 从系统通知导入支付（微信/支付宝/银行，需授权「通知使用权」）
- 📋 剪贴板导入
- 🎨 自定义背景
- 🧮 内置计算器（可引用账户余额）
- ⛶ 全屏模式
- 🖼 自定义 App 图标（墨绿账本主题）

## 使用

- **网页版**：直接用浏览器打开 `app.html`。
- **APK 版**：安装后直接使用，首次打开显示启动动画，上滑进入主界面。

数据保存在本地，可随时通过 CSV 导出备份，换设备时用 CSV 导入迁移（账户结构会自动同步）。

## 技术栈

- 纯 HTML/CSS/JavaScript，零前端依赖
- Android WebView 封装为独立 APK
- 原生 JS Bridge（读剪贴板 / 读系统通知 / 全屏）
- 数据持久化：WebView localStorage

## 许可证

MIT
