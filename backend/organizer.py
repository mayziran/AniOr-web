"""
整理逻辑模块 - 复刻 PyQt5 start_link 方法
"""
import os
import re
from pathlib import Path
from typing import List, Tuple, Dict, Set, Optional

from .config import Config
from .file_ops import FileOperator


class Organizer:
    # 字幕文件格式
    SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt']

    def __init__(self, config: Config):
        self.config = config

    def organize(self, file_mappings: Dict[str, str], content_type: str,
                 tv_info: dict = None, movie_info: dict = None,
                 auto_extras: bool = True, scan_unorganized: bool = True) -> Dict:
        """
        执行整理操作

        Args:
            file_mappings: 文件映射 {源文件路径: 目标标识}
            content_type: "tv" 或 "movie"
            tv_info: TV 动画信息 (content_type="tv" 时需要)
            movie_info: 电影信息 (content_type="movie" 时需要)
            auto_extras: 未匹配视频自动归入 extras
            scan_unorganized: 整理后扫描未整理文件

        Returns:
            整理结果字典
        """
        if not file_mappings:
            return {
                'success': False,
                'error': '请先拖放文件到季度区域或 extras'
            }

        target = self.config.get('target_dir')
        if not target:
            return {
                'success': False,
                'error': '请先在设置中配置目标目录'
            }

        mode = self.config.get('move_mode', 'link')
        mode_names = {'link': '硬链接', 'cut': '剪切', 'copy': '复制'}
        target_path = Path(target)

        # 根据内容类型获取名称和年份
        if content_type == "movie":
            target_path = Path(self.config.get('movie_target_dir', target))
            if not target_path or str(target_path) == '':
                target_path = Path(target)
            tv_name = movie_info.get('title', 'Unknown') if movie_info else 'Unknown'
            year = (movie_info.get('release_date', '') or '')[:4] if movie_info else ''
        else:
            tv_name = tv_info.get('name', 'Unknown') if tv_info else 'Unknown'
            year = (tv_info.get('first_air_date', '') or '')[:4] if tv_info else ''

        success, fail = 0, 0
        fail_details = []
        extras_files = []
        processed_files = set(Path(k) for k in file_mappings.keys())

        # 1. 收集 extras 标签页的文件
        for src_str, ep_key in file_mappings.items():
            src = Path(src_str)
            if not src.exists():
                fail += 1
                continue

            if ep_key == "extras":
                extras_files.append(src)

        # 2. auto_extras: 扫描未匹配文件并添加到 extras_files
        if auto_extras:
            source_dir = Path(self.config.get('source_dir', ''))
            if source_dir.exists():
                anime_folders = set()
                for f in file_mappings.keys():
                    try:
                        relative = Path(f).relative_to(source_dir)
                        anime_folder = source_dir / relative.parts[0]
                        anime_folders.add(anime_folder)
                    except ValueError:
                        continue

                for anime_folder in anime_folders:
                    all_videos = self._get_folder_videos(anime_folder)
                    matched_paths = set(Path(k) for k in file_mappings.keys())
                    unmatched_videos = [v for v in all_videos if v not in matched_paths]
                    extras_files.extend(unmatched_videos)

        # 3. 处理正片文件
        if content_type == "movie":
            # 剧场版模式
            movie_folder = target_path / f"{tv_name} ({year})"
            movie_folder.mkdir(parents=True, exist_ok=True)

            for src_str, ep_key in file_mappings.items():
                src = Path(src_str)
                if not src.exists():
                    fail += 1
                    continue

                if ep_key == "extras":
                    continue

                src_filename = src.stem
                src_suffix = src.suffix

                if ep_key == "movie":
                    video_dst_name = f"{tv_name} - {src.name}"
                elif ep_key.startswith("movie-cd"):
                    cd_num = ep_key.replace("movie-cd", "")
                    video_dst_name = f"{tv_name} - {src_filename}-cd{cd_num}{src_suffix}"
                else:
                    video_dst_name = f"{tv_name} - {src.name}"

                dst = movie_folder / video_dst_name

                ok, error = FileOperator.operate(src, dst, mode)
                if ok:
                    success += 1
                else:
                    fail += 1
                    fail_details.append({
                        'src': str(src),
                        'dst': str(dst),
                        'error': error
                    })
                    continue

                # 处理关联字幕文件
                sub_success, sub_fail = self._move_subtitles_for_movie(
                    src, movie_folder, video_dst_name, processed_files, mode
                )
                success += sub_success
                for sub_item in sub_fail:
                    fail += 1
                    fail_details.append(sub_item)
        else:
            # TV 动画模式
            for src_str, ep_key in file_mappings.items():
                src = Path(src_str)
                if not src.exists():
                    fail += 1
                    continue

                if ep_key == "extras":
                    continue

                # 解析 S01E01 格式
                import re
                match = re.match(r'S(\d+)E\d+', ep_key)
                s_num = int(match.group(1)) if match else 0
                folder = target_path / f"{tv_name} ({year})" / (f"Season0" if s_num == 0 else f"Season{s_num}")
                dst = folder / f"{ep_key} - {src.name}"

                ok, error = FileOperator.operate(src, dst, mode)
                if ok:
                    success += 1
                else:
                    fail += 1
                    fail_details.append({
                        'src': str(src),
                        'dst': str(dst),
                        'error': error
                    })
                    continue

                sub_success, sub_fail = self._move_subtitles(src, folder, ep_key, processed_files, mode)
                success += sub_success
                for sub_item in sub_fail:
                    fail += 1
                    fail_details.append(sub_item)

        # 4. 处理所有 extras 文件
        if extras_files:
            extras_folder = target_path / f"{tv_name} ({year})" / "extras"
            extras_folder.mkdir(parents=True, exist_ok=True)

            for src in extras_files:
                if src.exists():
                    dst = extras_folder / src.name
                    ok, error = FileOperator.operate(src, dst, mode)
                    if ok:
                        success += 1
                        processed_files.add(src)
                        sub_success, sub_fail = self._move_subtitles(src, extras_folder, None, processed_files, mode)
                        success += sub_success
                        for sub_item in sub_fail:
                            fail += 1
                            fail_details.append(sub_item)
                    else:
                        fail += 1
                        fail_details.append({
                            'src': str(src),
                            'dst': str(dst),
                            'error': error
                        })

            # 生成.embyignore 文件
            if self.config.get('embyignore_extras', True) and content_type != "movie":
                embyignore_file = extras_folder / ".embyignore"
                if not embyignore_file.exists():
                    with open(embyignore_file, 'w', encoding='utf-8') as f:
                        f.write('*')

        # 5. 收集未整理的文件
        unorganized_files = []
        duplicate_files = set()
        for item in fail_details:
            if "目标文件已存在" in item.get('error', ''):
                duplicate_files.add(item['src'])

        source_dir = Path(self.config.get('source_dir', ''))
        if scan_unorganized and source_dir.exists():
            anime_folders = set()
            for f in file_mappings.keys():
                try:
                    relative = Path(f).relative_to(source_dir)
                    anime_folder = source_dir / relative.parts[0]
                    anime_folders.add(anime_folder)
                except ValueError:
                    continue

            for anime_folder in anime_folders:
                all_files = self._get_folder_files(anime_folder)
                for f in all_files:
                    if f not in processed_files:
                        is_duplicate = str(f) in duplicate_files
                        unorganized_files.append({
                            'path': str(f),
                            'is_duplicate': is_duplicate
                        })

            # 重名文件置顶
            unorganized_files.sort(key=lambda x: (not x['is_duplicate'], x['path']))

        return {
            'success': True,
            'success_count': success,
            'fail_count': fail,
            'fail_details': fail_details,
            'unorganized_files': unorganized_files,
            'mode': mode_names.get(mode, '硬链接'),
            'tv_name': tv_name,
            'year': year
        }

    def _get_folder_videos(self, folder: Path) -> List[Path]:
        """获取文件夹中的视频文件（递归扫描子文件夹）"""
        video_extensions = self.config.get_video_extensions()
        videos = []
        if folder.exists() and folder.is_dir():
            for f in folder.rglob('*'):
                if f.is_file() and f.suffix.lower() in video_extensions:
                    videos.append(f)
        return videos

    def _get_folder_files(self, folder: Path) -> List[Path]:
        """获取文件夹中的所有文件"""
        files = []
        if folder.exists() and folder.is_dir():
            for f in folder.rglob('*'):
                if f.is_file():
                    files.append(f)
        return files

    def _move_subtitles(self, video_src: Path, target_folder: Path, ep_key: Optional[str],
                       processed_files: Set[Path], mode: str) -> Tuple[int, List[dict]]:
        """处理视频文件关联的字幕文件"""
        success = 0
        fail_details = []

        video_filename = video_src.stem
        video_parent = video_src.parent

        sub_files_to_move = []
        for f in video_parent.iterdir():
            if f.is_file() and f.name.startswith(f"{video_filename}.") and f != video_src:
                if f.suffix.lower() in self.SUBTITLE_EXTENSIONS:
                    if f not in processed_files:
                        sub_files_to_move.append(f)

        for sub_src in sub_files_to_move:
            if ep_key:
                sub_dst = target_folder / f"{ep_key} - {sub_src.name}"
            else:
                sub_dst = target_folder / sub_src.name

            ok, error = FileOperator.operate(sub_src, sub_dst, mode)
            if ok:
                success += 1
                processed_files.add(sub_src)
            else:
                fail_details.append({
                    'src': str(sub_src),
                    'dst': str(sub_dst),
                    'error': error
                })

        return success, fail_details

    def _move_subtitles_for_movie(self, video_src: Path, target_folder: Path, video_dst_name: str,
                                  processed_files: Set[Path], mode: str) -> Tuple[int, List[dict]]:
        """处理剧场版视频文件关联的字幕文件"""
        success = 0
        fail_details = []

        video_filename = video_src.stem
        video_parent = video_src.parent
        dst_prefix = Path(video_dst_name).stem

        sub_files_to_move = []
        for f in video_parent.iterdir():
            if f.is_file() and f.name.startswith(f"{video_filename}.") and f != video_src:
                if f.suffix.lower() in self.SUBTITLE_EXTENSIONS:
                    if f not in processed_files:
                        sub_files_to_move.append(f)

        for sub_src in sub_files_to_move:
            sub_suffix = sub_src.suffix
            sub_dst_name = f"{dst_prefix}{sub_suffix}"
            sub_dst = target_folder / sub_dst_name

            ok, error = FileOperator.operate(sub_src, sub_dst, mode)
            if ok:
                success += 1
                processed_files.add(sub_src)
            else:
                fail_details.append({
                    'src': str(sub_src),
                    'dst': str(sub_dst),
                    'error': error
                })

        return success, fail_details
