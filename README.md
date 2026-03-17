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

## Docker 部署

### docker-compose.yml

```yaml
version: '3.8'

services:
  anior:
    image: mayziran/anior:latest
    container_name: anior
    restart: unless-stopped
    network_mode: bridge
    ports:
      - "5000:5000"
    volumes:
      # 修改为你的视频目录
      - /你的视频目录:/data
      # 配置文件持久化
      - ./config:/app/config
    environment:
      - TZ=Asia/Shanghai
```

### 启动命令

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

> 修改 `/你的视频目录` 为实际路径

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
