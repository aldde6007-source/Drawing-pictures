# わたしのキャラずかん(開発メモ)

小4の子ども向け、自作キャラの図鑑 PWA。静的ファイルのみ・外部通信なし・データは IndexedDB。

## コマンド(すべて Docker Compose の dev サービスで実行)

```sh
docker compose up dev                                      # ローカルサーバー http://localhost:8000
docker compose run --rm dev sh tools/check.sh              # JS/manifest の構文チェック
docker compose run --rm dev python tools/make_icons.py     # icons/ を再生成
```

## ルール

- フレームワーク・npm パッケージ・ビルド・CDN・外部フォント・外部 API は使わない(CSP でも禁止している)
- パスはすべて相対パス(GitHub Pages のサブパスで動かすため)
- アプリのファイルを変えたら `sw.js` の `VERSION` を上げる。ファイルを追加したら `FILES` にも足す
- 画面の文言はひらがな中心(漢字は小4までに習うもの)。やさしい言葉で、エラーっぽい表現は避ける
- ボタンは高さ 48px 以上、入力欄の文字は 16px 以上(iOS の自動ズーム防止)
- 画像の向きは `<img>` のブラウザ自動補正に任せる(手動で回転すると二重回転になる)
- 画像は IndexedDB に `{ type, data: ArrayBuffer }` で保存する(Safari の Blob 保存の不具合対策)
