# AniOr Web

> AniOr 桌面版的 Web 移植版本

## 功能

- 📁 文件夹浏览和选择视频
- 🔍 TMDB 搜索匹配动漫信息
- 📥 拖放视频到季度批量匹配
- 📺 TV 动画按季度整理，🎬 剧场版单独整理
- 💬 字幕文件自动跟随移动
- 📦 未匹配视频自动归入 extras
- 🔗 硬链接 / ✂️ 剪切 / 📋 复制三种模式

## 快速开始

```bash
# 启动
docker-compose up -d

# 访问
http://localhost:5000
```

> 修改 `docker-compose.yml` 中的 `/你的视频目录` 为实际路径

## 配置

Web 界面 "设置" 中配置：
- 源目录
- 目标目录
- TMDB API Key（从 https://www.themoviedb.org 获取）

## 整理模式

| 模式 | 跨挂载卷 | 说明 |
|:----:|:--------:|:-----|
| 硬链接 | ❌ | 要求同一挂载卷 |
| 剪切 | ⚠️ | 同卷移动，跨卷复制+删除 |
| 复制 | ✅ | 可跨卷 |

## 本地开发

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

## 桌面版

https://github.com/mayziran/AniOr
