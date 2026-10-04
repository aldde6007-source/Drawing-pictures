# 開発用コンテナ
# - python:ローカル確認用の静的サーバー(http.server)と、アイコン生成(Pillow)
# - nodejs:JS の構文チェック(node --check)だけに使う。アプリ本体は npm を使わない
FROM python:3.12-slim

RUN pip install --no-cache-dir pillow==11.3.0 \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
