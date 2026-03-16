"""
TMDB API 模块 - 复刻 PyQt5 TMDBClient 类
"""
import requests
from typing import List, Optional, Dict


class TMDBClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = 'https://api.themoviedb.org/3'

    def search_tv(self, query: str) -> List[dict]:
        """搜索 TV 动画"""
        url = f'{self.base_url}/search/tv'
        params = {'api_key': self.api_key, 'query': query, 'language': 'zh-CN', 'page': 1}
        try:
            resp = requests.get(url, params=params, timeout=15)
            return resp.json().get('results', [])
        except:
            return []

    def search_movie(self, query: str) -> List[dict]:
        """搜索电影（剧场版动画）"""
        url = f'{self.base_url}/search/movie'
        params = {'api_key': self.api_key, 'query': query, 'language': 'zh-CN', 'page': 1}
        try:
            resp = requests.get(url, params=params, timeout=15)
            return resp.json().get('results', [])
        except:
            return []

    def get_tv_details(self, tv_id: int) -> Optional[dict]:
        """获取 TV 详情"""
        url = f'{self.base_url}/tv/{tv_id}'
        params = {'api_key': self.api_key, 'language': 'zh-CN'}
        try:
            resp = requests.get(url, params=params, timeout=15)
            return resp.json()
        except:
            return None

    def get_movie_details(self, movie_id: int) -> Optional[dict]:
        """获取电影详情"""
        url = f'{self.base_url}/movie/{movie_id}'
        params = {'api_key': self.api_key, 'language': 'zh-CN'}
        try:
            resp = requests.get(url, params=params, timeout=15)
            return resp.json()
        except:
            return None

    def get_season_details(self, tv_id: int, season_num: int) -> Optional[dict]:
        """获取季度详情"""
        url = f'{self.base_url}/tv/{tv_id}/season/{season_num}'
        params = {'api_key': self.api_key, 'language': 'zh-CN'}
        try:
            resp = requests.get(url, params=params, timeout=15)
            return resp.json()
        except:
            return None
