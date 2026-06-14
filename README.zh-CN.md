# KaraokeQ — 智能卡拉OK点歌队列管理器

[![English](https://img.shields.io/badge/lang-English-blue.svg)](./README.md)
[![简体中文](https://img.shields.io/badge/lang-简体中文-red.svg)](./README.zh-CN.md)
[![日本語](https://img.shields.io/badge/lang-日本語-green.svg)](./README.ja.md)

一个为 GitHub Pages 打造的现代化跨设备卡拉OK点歌系统。

## 功能特性

- **显示模式** — 在电视或投影仪上全屏播放视频/音频
- **远程遥控** — 局域网内任意手机或平板均可添加、删除和重新排序歌曲
- **YouTube 支持** — 自动播放 YouTube 视频，完整 API 控制并自动续播
- **多格式支持** — 同时支持 Bilibili 嵌入、直链 MP4/MP3 文件以及通用 iframe
- **实时同步** — Firebase 实时数据库让所有设备即时保持同步
- **多语言** — 英语、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch
- **音量控制** — 可从任意遥控设备调节
- **拖拽排序** — 在队列中拖动歌曲即可改变播放顺序
- **二维码加入** — 显示端会展示二维码，方便手机快速接入

---

## 使用方法

### 开始一场卡拉OK

1. 在**显示设备**（电视/投影仪/笔记本）上打开网站
2. 点击 **Create Room（创建房间）** — 会出现一个 6 位房间码和二维码
3. 显示端切换到全屏播放模式，并展示房间码与二维码

### 添加歌曲（从任意手机）

1. 扫描显示端的二维码，或打开 `remote.html?room=XXXXXX`
2. 或打开网站点击 **Join Room（加入房间）**，然后输入房间码
3. 点击 **+** 按钮 → 粘贴 URL → 点击 **Add to Queue（加入队列）**

**支持的 URL 类型：**
| 类型 | 示例 |
|------|---------|
| YouTube | `https://youtube.com/watch?v=...` 或 `https://youtu.be/...` |
| YouTube Shorts | `https://youtube.com/shorts/...` |
| Bilibili | `https://bilibili.com/video/BVxxx` |
| 直链视频 | `https://example.com/song.mp4` |
| 直链音频 | `https://example.com/song.mp3` |
| 通用 iframe | 其他任意 URL（自动续播受限） |

### 键盘快捷键（显示设备上）

| 按键 | 操作 |
|-----|--------|
| `空格` | 播放 / 暂停 |
| `→` | 跳到下一首 |
| `↑` / `↓` | 音量增大 / 减小 |
| `Q` | 切换队列面板 |

---

## 自动续播行为

| 播放器类型 | 歌曲结束时自动续播？ |
|-------------|------------------------------|
| YouTube | ✅ 是（通过 YouTube IFrame API） |
| HTML5 视频/音频 | ✅ 是（通过 `ended` 事件） |
| Bilibili / iframe | ❌ 需手动跳过 |

---

## 浏览器兼容性

- Chrome 80+ / Edge 80+
- Firefox 75+
- Safari 14+ (iOS 14+)
- BroadcastChannel 需在同一设备的同一浏览器中使用（仅演示模式）
- Firebase 模式可在任意网络的所有设备上工作

---

## 许可证

MIT
