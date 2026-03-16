FROM python:3.11-slim

WORKDIR /app

# 日志实时输出
ENV PYTHONUNBUFFERED=1

# 不生成__pycache__
ENV PYTHONDONTWRITEBYTECODE=1

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
