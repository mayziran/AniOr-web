"""
Flask Web Application - AniOr Web
动漫视频手动整理工具 Web版
"""
import os
import time
from pathlib import Path
from functools import wraps
from flask import Flask, render_template, request, jsonify, session

from backend.config import Config
from backend.tmdb import TMDBClient
from backend.organizer import Organizer

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'anior-web-secret-key')

# 密码认证（通过环境变量 ADMIN_PASSWORD 设置）
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')

# 全局配置实例
config = Config()


def login_required(f):
    """登录装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if ADMIN_PASSWORD and not session.get('logged_in'):
            return jsonify({'success': False, 'error': '请先登录'}), 401
        return f(*args, **kwargs)
    return decorated_function

# 一级文件夹缓存
_folder_cache = {
    'source_dir': None,
    'folders': [],
    'timestamp': 0
}


@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/login', methods=['POST'])
def login():
    """登录验证"""
    if not ADMIN_PASSWORD:
        return jsonify({'success': True, 'message': '未启用密码认证'})

    data = request.json or {}
    password = data.get('password', '')

    if password == ADMIN_PASSWORD:
        session['logged_in'] = True
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': '密码错误'}), 401


@app.route('/api/logout', methods=['POST'])
def logout():
    """退出登录"""
    session.pop('logged_in', None)
    return jsonify({'success': True})


@app.route('/api/check-login', methods=['GET'])
def check_login():
    """检查登录状态"""
    password_required = bool(ADMIN_PASSWORD)
    logged_in = session.get('logged_in', False) if ADMIN_PASSWORD else True
    return jsonify({'success': True, 'logged_in': logged_in, 'password_required': password_required})


@app.route('/api/config', methods=['GET', 'POST'])
@login_required
def handle_config():
    """获取/保存配置"""
    if request.method == 'GET':
        return jsonify({
            'success': True,
            'config': config.to_dict()
        })
    else:
        data = request.json or {}
        for key, value in data.items():
            config.set(key, value, save_later=False)
        config.save()
        return jsonify({'success': True})


@app.route('/api/folders', methods=['GET'])
@login_required
def get_folders():
    """加载文件夹列表（带缓存，只有刷新或源目录改变时才重新扫描）"""
    global _folder_cache

    source_dir = config.get('source_dir')
    if not source_dir or not Path(source_dir).exists():
        return jsonify({
            'success': False,
            'error': '请先配置源目录'
        })

    # 判断是否需要刷新
    refresh = request.args.get('refresh', '').lower() == 'true'

    # 获取请求的路径，默认为源目录
    req_path = request.args.get('path', source_dir)
    # 标准化路径比较
    req_path = str(Path(req_path).resolve())
    source_dir_normalized = str(Path(source_dir).resolve())

    # 判断是否是根目录（请求路径等于源目录）
    is_root = req_path == source_dir_normalized

    # 子文件夹不使用缓存，始终扫描
    if not is_root:
        folder_path = Path(req_path)
        return _scan_immediate_folders(folder_path)

    # 根目录：使用缓存
    if not refresh and _folder_cache['source_dir'] == source_dir and _folder_cache['folders']:
        return jsonify({
            'success': True,
            'folders': _folder_cache['folders'],
            'cached': True
        })

    # 需要扫描
    folder_path = Path(source_dir)
    folders = _scan_immediate_folders(folder_path)

    # 更新缓存
    if folders.get('success'):
        _folder_cache = {
            'source_dir': source_dir,
            'folders': folders['folders']
        }

    return jsonify(folders)


def _add_video(item, matched_files, videos):
    """添加视频到列表"""
    try:
        size_bytes = item.stat().st_size
        if size_bytes >= 1024 * 1024 * 1024:
            size_str = f"{size_bytes / 1024 / 1024 / 1024:.2f} GB"
        elif size_bytes >= 1024 * 1024:
            size_str = f"{size_bytes / 1024 / 1024:.1f} MB"
        elif size_bytes >= 1024:
            size_str = f"{size_bytes / 1024:.1f} KB"
        else:
            size_str = f"{size_bytes} B"
        mtime = item.stat().st_mtime
        file_date = time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime))
        videos.append({
            'name': item.name,
            'path': str(item),
            'size': size_str,
            'date': file_date,
            'is_matched': str(item) in matched_files
        })
    except:
        videos.append({
            'name': item.name,
            'path': str(item),
            'size': '未知',
            'date': '',
            'is_matched': str(item) in matched_files
        })


def _scan_immediate_folders(folder_path):
    """扫描immediate文件夹（不递归）"""
    folders = []
    try:
        for item in sorted(folder_path.iterdir(), key=lambda x: x.name.lower()):
            if item.is_dir():
                has_subfolders = any(sub.is_dir() for sub in item.iterdir())
                try:
                    mtime = item.stat().st_mtime
                    folder_date = time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime))
                except:
                    folder_date = ''
                folders.append({
                    'name': item.name,
                    'path': str(item),
                    'has_subfolders': has_subfolders,
                    'date': folder_date,
                    'video_count': None,
                    'matched_count': None
                })
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

    return {
        'success': True,
        'folders': folders
    }


@app.route('/api/scan-folder', methods=['GET'])
@login_required
def scan_folder():
    """扫描指定文件夹"""
    folder_path = request.args.get('path')
    if not folder_path or not Path(folder_path).exists():
        return jsonify({
            'success': False,
            'error': '无效的文件夹路径'
        })

    # 是否只扫描根目录视频（用于显示视频列表）
    root_only = request.args.get('root_only', '').lower() == 'true'

    video_extensions = config.get_video_extensions()
    matched_files = set(request.args.get('matched_files', '').split(',') if request.args.get('matched_files') else [])

    folder = Path(folder_path)
    videos = []
    subfolders = []

    try:
        # 群晖和系统文件夹排除列表（用于排除系统文件夹）
        system_folders = ['@eaDir', '.@__thumb', '.AppleDouble']

        # 根据 root_only 参数决定扫描方式
        if root_only:
            # 只扫描根目录视频，不扫描子文件夹
            for item in sorted(folder.glob('*'), key=lambda x: x.name.lower()):
                if item.is_file() and item.suffix.lower() in video_extensions:
                    _add_video(item, matched_files, videos)
            # root_only 模式不需要子文件夹结构
            subfolders = []
        else:
            # 递归扫描所有视频文件
            for item in folder.rglob('*'):
                if item.is_file() and item.suffix.lower() in video_extensions:
                    _add_video(item, matched_files, videos)

            # 递归获取子文件夹结构（只包含有视频的文件夹）
            def get_subfolders(parent_path, depth=0):
                result = []
                if depth > 5:  # 限制递归深度
                    return result
                try:
                    for item in sorted(parent_path.iterdir(), key=lambda x: x.name.lower()):
                        if item.is_dir():
                            # 排除系统文件夹
                            if item.name in system_folders:
                                continue
                            # 检查该文件夹下是否有视频
                            folder_videos = [f for f in item.rglob('*')
                                           if f.is_file() and f.suffix.lower() in video_extensions]
                            if folder_videos:
                                # 递归获取子文件夹
                                children = get_subfolders(item, depth + 1)
                                # 获取文件夹修改日期
                                try:
                                    mtime = item.stat().st_mtime
                                    folder_date = time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime))
                                except:
                                    folder_date = ''
                                result.append({
                                    'name': item.name,
                                    'path': str(item),
                                    'video_count': len(folder_videos),
                                    'matched_count': sum(1 for f in folder_videos if str(f) in matched_files),
                                    'has_subfolders': len(children) > 0,
                                    'children': children,
                                    'date': folder_date
                                })
                except:
                    pass
                return result

            subfolders = get_subfolders(folder)

        # 统计当前文件夹根目录的视频数量
        root_video_count = sum(1 for f in folder.glob('*') if f.is_file() and f.suffix.lower() in video_extensions)
        root_matched_count = sum(1 for f in folder.glob('*')
                                if f.is_file() and f.suffix.lower() in video_extensions
                                and str(f) in matched_files)

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

    return jsonify({
        'success': True,
        'folder': {
            'name': folder.name,
            'path': str(folder),
            'video_count': len(videos),
            'matched_count': sum(1 for v in videos if v['is_matched']),
            'root_video_count': root_video_count,
            'root_matched_count': root_matched_count,
            'subfolders': subfolders,
            'videos': videos
        }
    })


@app.route('/api/videos', methods=['GET'])
@login_required
def get_videos():
    """加载视频列表"""
    folder_path = request.args.get('path')
    if not folder_path or not Path(folder_path).exists():
        return jsonify({
            'success': False,
            'error': '无效的文件夹路径'
        })

    video_extensions = config.get_video_extensions()
    videos = []
    try:
        folder = Path(folder_path)
        for item in sorted(folder.iterdir(), key=lambda x: x.name.lower()):
            if item.is_file() and item.suffix.lower() in video_extensions:
                try:
                    size_bytes = item.stat().st_size
                    # 自动选择合适的单位
                    if size_bytes >= 1024 * 1024 * 1024:
                        size_str = f"{size_bytes / 1024 / 1024 / 1024:.2f} GB"
                    elif size_bytes >= 1024 * 1024:
                        size_str = f"{size_bytes / 1024 / 1024:.1f} MB"
                    elif size_bytes >= 1024:
                        size_str = f"{size_bytes / 1024:.1f} KB"
                    else:
                        size_str = f"{size_bytes} B"
                    mtime = item.stat().st_mtime
                    file_date = time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime))
                    videos.append({
                        'name': item.name,
                        'path': str(item),
                        'size': size_str,
                        'date': file_date
                    })
                except:
                    videos.append({
                        'name': item.name,
                        'path': str(item),
                        'size': '未知',
                        'date': ''
                    })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

    return jsonify({
        'success': True,
        'videos': videos
    })


@app.route('/api/browse-dir', methods=['GET'])
@login_required
def browse_dir():
    """浏览目录"""
    path = request.args.get('path', '')

    if not path:
        # 返回可用的根目录
        import platform
        system = platform.system()
        if system == 'Windows':
            # Windows: 返回盘符
            drives = []
            import string
            for letter in string.ascii_uppercase:
                drive = f'{letter}:\\'
                if Path(drive).exists():
                    drives.append({'name': f'{letter}:\\', 'path': drive})
            return jsonify({'success': True, 'entries': drives})
        else:
            # Linux/Mac: 返回根目录或用户目录
            home = str(Path.home())
            return jsonify({'success': True, 'entries': [
                {'name': '/', 'path': '/', 'is_dir': True},
                {'name': 'Home', 'path': home, 'is_dir': True}
            ]})

    folder_path = Path(path)
    if not folder_path.exists() or not folder_path.is_dir():
        return jsonify({'success': False, 'error': '目录不存在'})

    entries = []
    try:
        for item in sorted(folder_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if item.is_dir():
                entries.append({
                    'name': item.name,
                    'path': str(item),
                    'is_dir': True
                })
    except PermissionError:
        return jsonify({'success': False, 'error': '没有权限访问此目录'})

    return jsonify({'success': True, 'entries': entries})


@app.route('/api/tmdb/search', methods=['POST'])
@login_required
def tmdb_search():
    """TMDB 搜索"""
    data = request.json or {}
    query = data.get('query', '').strip()
    search_type = data.get('type', 'tv')

    if not query:
        return jsonify({
            'success': False,
            'error': '请输入搜索关键词'
        })

    api_key = config.get('tmdb_api_key')
    if not api_key:
        return jsonify({
            'success': False,
            'error': '请先配置 TMDB API Key'
        })

    tmdb = TMDBClient(api_key)

    try:
        if search_type == 'tv':
            results = tmdb.search_tv(query)
        else:
            results = tmdb.search_movie(query)

        formatted_results = []
        for item in results:
            if search_type == 'tv':
                formatted_results.append({
                    'id': item.get('id'),
                    'name': item.get('name', '未知'),
                    'year': (item.get('first_air_date', '') or '')[:4],
                    'date': item.get('first_air_date', ''),
                    'vote': item.get('vote_average', 0),
                    'overview': item.get('overview', ''),
                    'poster_path': item.get('poster_path')
                })
            else:
                formatted_results.append({
                    'id': item.get('id'),
                    'title': item.get('title', '未知'),
                    'year': (item.get('release_date', '') or '')[:4],
                    'date': item.get('release_date', ''),
                    'vote': item.get('vote_average', 0),
                    'overview': item.get('overview', ''),
                    'poster_path': item.get('poster_path')
                })

        return jsonify({
            'success': True,
            'results': formatted_results
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })


@app.route('/api/tmdb/details', methods=['GET'])
@login_required
def tmdb_details():
    """获取 TMDB 详情"""
    tmdb_id = request.args.get('id', type=int)
    content_type = request.args.get('type', 'tv')
    season_num = request.args.get('season', type=int)

    api_key = config.get('tmdb_api_key')
    if not api_key:
        return jsonify({
            'success': False,
            'error': '请先配置 TMDB API Key'
        })

    tmdb = TMDBClient(api_key)

    try:
        if content_type == 'tv':
            if season_num is not None:
                # 获取季度详情
                details = tmdb.get_season_details(tmdb_id, season_num)
                if details:
                    episodes = []
                    for ep in details.get('episodes', []):
                        episodes.append({
                            'episode_number': ep.get('episode_number', 0),
                            'name': ep.get('name', '未知'),
                            'overview': ep.get('overview', ''),
                            'air_date': ep.get('air_date', ''),
                            'runtime': ep.get('runtime', 0),
                            'still_path': ep.get('still_path')
                        })
                    return jsonify({
                        'success': True,
                        'episodes': episodes
                    })
                return jsonify({
                    'success': False,
                    'error': '获取季度详情失败'
                })
            else:
                # 获取 TV 详情
                details = tmdb.get_tv_details(tmdb_id)
                if details:
                    seasons = []
                    for s in details.get('seasons', []):
                        # 包含 S0 (Specials) 和其他季度
                        if s.get('season_number', 0) >= 0:
                            seasons.append({
                                'season_number': s.get('season_number', 0),
                                'name': s.get('name', ''),
                                'episode_count': s.get('episode_count', 0)
                            })
                    return jsonify({
                        'success': True,
                        'info': {
                            'name': details.get('name', '未知'),
                            'overview': details.get('overview', ''),
                            'first_air_date': details.get('first_air_date', ''),
                            'poster_path': details.get('poster_path')
                        },
                        'seasons': seasons
                    })
                return jsonify({
                    'success': False,
                    'error': '获取 TV 详情失败'
                })
        else:
            # 获取电影详情
            details = tmdb.get_movie_details(tmdb_id)
            if details:
                return jsonify({
                    'success': True,
                    'info': {
                        'title': details.get('title', '未知'),
                        'overview': details.get('overview', ''),
                        'release_date': details.get('release_date', ''),
                        'runtime': details.get('runtime', 0),
                        'vote_average': details.get('vote_average', 0),
                        'poster_path': details.get('poster_path')
                    }
                })
            return jsonify({
                'success': False,
                'error': '获取电影详情失败'
            })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })


@app.route('/api/organize', methods=['POST'])
@login_required
def organize():
    """执行整理"""
    data = request.json or {}
    file_mappings = data.get('file_mappings', {})
    content_type = data.get('content_type', 'tv')
    tv_info = data.get('tv_info')
    movie_info = data.get('movie_info')
    auto_extras = data.get('auto_extras', True)
    scan_unorganized = data.get('scan_unorganized', True)

    organizer = Organizer(config)
    result = organizer.organize(file_mappings, content_type, tv_info, movie_info, auto_extras, scan_unorganized)

    return jsonify(result)


@app.route('/api/organize-extras', methods=['POST'])
@login_required
def organize_extras():
    """整理选中文件到 extras 文件夹"""
    from backend.file_ops import FileOperator

    data = request.json or {}
    files = data.get('files', [])
    tv_name = data.get('tv_name', 'Unknown')
    year = data.get('year', '')
    mode = data.get('mode', 'link')

    target = config.get('target_dir')
    if not target:
        return jsonify({'success': False, 'error': '请先配置目标目录'})

    target_path = Path(target)
    extras_folder = target_path / f"{tv_name} ({year})" / "extras"
    extras_folder.mkdir(parents=True, exist_ok=True)

    success_count = 0
    for src_path in files:
        src = Path(src_path)
        if src.exists():
            dst = extras_folder / src.name
            ok, error = FileOperator.operate(src, dst, mode)
            if ok:
                success_count += 1
                # 处理关联字幕
                sub_exts = ['.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt']
                for sub_file in src.parent.iterdir():
                    if sub_file.is_file() and sub_file.stem == src.stem and sub_file.suffix.lower() in sub_exts:
                        sub_dst = extras_folder / sub_file.name
                        FileOperator.operate(sub_file, sub_dst, mode)

    return jsonify({'success': True, 'count': success_count})


@app.route('/api/scan-unmatched', methods=['POST'])
@login_required
def scan_unmatched():
    """扫描未匹配文件"""
    data = request.json or {}
    source_dir = data.get('source_dir', config.get('source_dir'))
    matched_files = set(data.get('matched_files', []))

    if not source_dir or not Path(source_dir).exists():
        return jsonify({
            'success': False,
            'error': '源目录不存在'
        })

    video_extensions = config.get_video_extensions()
    source_path = Path(source_dir)
    unmatched = []

    try:
        for item in source_path.rglob('*'):
            if item.is_file() and item.suffix.lower() in video_extensions:
                if str(item) not in matched_files:
                    unmatched.append({
                        'name': item.name,
                        'path': str(item)
                    })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

    return jsonify({
        'success': True,
        'unmatched': unmatched
    })


@app.route('/api/check-volume', methods=['GET'])
@login_required
def check_volume():
    """检查两个路径是否在同一个卷（仅硬链接需要）"""
    path1 = request.args.get('path1', '')
    path2 = request.args.get('path2', '')
    mode = request.args.get('mode', 'link')

    # 剪切和复制模式可以跨卷
    if mode != 'link':
        return jsonify({
            'success': True,
            'same_volume': True,
            'warning': None
        })

    if not path1 or not path2:
        return jsonify({
            'success': False,
            'error': '请提供两个路径进行比较'
        })

    try:
        # 获取两个路径的设备号（st_dev）
        p1 = Path(path1).resolve()
        p2 = Path(path2).resolve()

        if not p1.exists():
            return jsonify({
                'success': False,
                'error': f'路径不存在: {path1}'
            })
        if not p2.exists():
            return jsonify({
                'success': False,
                'error': f'路径不存在: {path2}'
            })

        # 获取设备的设备号
        import stat
        dev1 = p1.stat().st_dev
        dev2 = p2.stat().st_dev

        same_volume = (dev1 == dev2)

        return jsonify({
            'success': True,
            'same_volume': same_volume,
            'path1': str(p1),
            'path2': str(p2),
            'warning': None if same_volume else '⚠️ 硬链接模式要求源目录和目标目录在同一个挂载卷内！当前目录在不同卷上，请使用复制或剪切模式。'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })


def _startup_scan():
    """服务器启动时预扫描一级文件夹（后台执行）"""
    import threading
    import logging

    def scan():
        try:
            # 等待配置加载完成
            import time
            time.sleep(1)

            source_dir = config.get('source_dir')
            if not source_dir or not Path(source_dir).exists():
                logging.info(f'[启动扫描] 源目录未配置或不存在：{source_dir}')
                return

            # 扫描一级文件夹
            folder_path = Path(source_dir)
            folders = []

            for item in sorted(folder_path.iterdir(), key=lambda x: x.name.lower()):
                if item.is_dir():
                    # 排除系统文件夹
                    system_folders = ['@eaDir', '.@__thumb', '.AppleDouble']
                    if item.name in system_folders:
                        continue

                    has_subfolders = any(sub.is_dir() for sub in item.iterdir())
                    try:
                        mtime = item.stat().st_mtime
                        folder_date = time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime))
                    except:
                        folder_date = ''

                    folders.append({
                        'name': item.name,
                        'path': str(item),
                        'has_subfolders': has_subfolders,
                        'date': folder_date,
                        'video_count': None,
                        'matched_count': None
                    })

            # 更新全局缓存
            global _folder_cache
            _folder_cache = {
                'source_dir': source_dir,
                'folders': folders,
                'timestamp': time.time()
            }
            logging.info(f'[启动扫描] 已预扫描 {len(folders)} 个一级文件夹')
        except Exception as e:
            logging.error(f'[启动扫描] 扫描失败：{e}')

    # 在后台线程中执行，不阻塞启动
    thread = threading.Thread(target=scan, daemon=True)
    thread.start()


if __name__ == '__main__':
    import os
    # 检测是否在 Docker 容器中
    in_docker = os.path.exists('/.dockerenv')
    # Docker 默认关闭 debug，本地开发默认开启
    debug_mode = not in_docker
    
    # 服务器启动时预扫描一级文件夹（后台执行）
    _startup_scan()
    
    app.run(host='0.0.0.0', port=5000, debug=debug_mode)
