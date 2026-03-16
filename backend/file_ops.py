"""
文件操作模块 - 复刻 PyQt5 FileOperator 类
"""
import os
import shutil
from pathlib import Path
from typing import Tuple


class FileOperator:
    @staticmethod
    def operate(src: Path, dst: Path, mode: str) -> Tuple[bool, str]:
        """
        执行文件操作

        Args:
            src: 源文件路径
            dst: 目标文件路径
            mode: 操作模式 (link/cut/copy)

        Returns:
            (success, error_message) 元组
            - 成功：(True, "")
            - 失败：(False, "错误原因")
        """
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)

            # 如果目标文件已存在，报错（防止误覆盖）
            if dst.exists():
                return False, f"目标文件已存在：{dst.name}"

            if mode == 'link':
                os.link(src, dst)
            elif mode == 'cut':
                shutil.move(src, dst)
            elif mode == 'copy':
                shutil.copy2(src, dst)
            else:
                return False, "无效的整理模式"

            return True, ""

        except Exception as e:
            return False, f"{type(e).__name__}: {str(e)}"
