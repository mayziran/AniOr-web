"""
配置管理模块 - 复刻 PyQt5 Config 类
"""
import json
import os
from pathlib import Path
from typing import List, Set, Optional

# 配置文件路径
CONFIG_DIR = Path(__file__).parent.parent / 'config'
CONFIG_PATH = CONFIG_DIR / 'config.json'


class Config:
    # 默认视频格式
    DEFAULT_VIDEO_EXTENSIONS = [
        '.mp4', '.mkv', '.avi', '.wmv', '.flv',
        '.webm', '.m4v', '.mov', '.ts',
        '.mpg', '.mpeg',
        '.rm', '.rmvb',
    ]

    # 字幕文件格式
    SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt']

    DEFAULT = {
        'source_dir': '',
        'target_dir': '',
        'movie_target_dir': '',
        'tmdb_api_key': '',
        'move_mode': 'link',
        'video_extensions': DEFAULT_VIDEO_EXTENSIONS.copy(),
        'auto_extras': True,
        'embyignore_extras': True,
        'scan_unorganized': True,
    }

    def __init__(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self.config = self._load()
        self._pending = False

    def _load(self) -> dict:
        data = dict(self.DEFAULT)
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    data.update(json.load(f))
            except:
                pass
        return data

    def save(self):
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)
        self._pending = False

    def get(self, key: str, default=None):
        return self.config.get(key, default)

    def set(self, key: str, value, save_later=True):
        # 如果是视频格式字符串，转换为列表
        if key == 'video_extensions' and isinstance(value, str):
            import re
            exts = [ext.strip().lower() for ext in re.split(r'[,\s]+', value) if ext.strip()]
            if exts:
                self.config[key] = exts
            else:
                self.config[key] = self.DEFAULT_VIDEO_EXTENSIONS.copy()
        else:
            self.config[key] = value
        if save_later:
            self._pending = True
        else:
            self.save()

    def get_video_extensions(self) -> Set[str]:
        """获取视频格式集合（小写）"""
        exts = self.config.get('video_extensions', self.DEFAULT_VIDEO_EXTENSIONS)
        return {ext.lower() for ext in exts}

    def to_dict(self) -> dict:
        """导出配置为字典"""
        result = self.config.copy()
        # 视频格式转换为逗号分隔的字符串
        if 'video_extensions' in result and isinstance(result['video_extensions'], list):
            result['video_extensions'] = ','.join(result['video_extensions'])
        return result


# 全局配置实例
config = Config()
