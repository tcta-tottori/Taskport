# Taskport — AI構造化プロキシ

自然文をタスク候補（JSON）に分解する Cloudflare Workers。
**APIキーを持つのはここだけ**で、クライアントには一切含めない。

## 何を受け取り、何を返すか

```
POST /
{ "text": "明日までにサンプル商事へ AB-1234 の納期を確認する", "today": "2026-08-18", "weekday": "火" }
  ↓
{ "content": "{\"tasks\":[{\"title\":\"サンプル商事へ AB-1234 の納期を確認する\", ...}]}" }
```

- 受け取るのは**認識後のテキストだけ**。音声データは扱わない。
- 返す `content` はクライアント側で `JSON.parse` し、`due` / `priority` を再検証する。
  サーバの返り値は信用しない、という前提で両側に検証を置いている。

## セットアップ

```bash
cd worker
npm install
npx wrangler secret put ANTHROPIC_API_KEY   # ここでAPIキーを登録
```

`wrangler.toml` の `ALLOWED_ORIGINS` に配信元オリジンを入れる。
**未設定だと誰でも呼び出せる**ので、デプロイ前に必ず設定する。

```toml
ALLOWED_ORIGINS = "https://tcta-tottori.github.io"
```

レート制限を効かせる場合は KV を作って紐づける（未設定なら制限なし）。

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
# 出力された id を wrangler.toml の [[kv_namespaces]] に書く
```

## 実行

```bash
npx wrangler dev      # ローカル
npx wrangler deploy   # デプロイ
```

デプロイで出た URL を、アプリの「設定 → AI構造化プロキシ」に入れる。
または `.env` の `VITE_PARSE_ENDPOINT` に入れてビルドする。

## ログ

`[observability] enabled = false` にしてある。
リクエスト本文に取引先名・品番・数量が含まれるため、本文をログに残さない。
エラー時も HTTP ステータスだけを記録する。
