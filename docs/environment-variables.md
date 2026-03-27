# 環境変数仕様書

## 必須

本番環境（`NODE_ENV=production`）では以下の変数が未設定の場合、起動時にエラーになります。

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `HASH_SECRET` | IPアドレスなどのハッシュ化に使用するHMACシークレット | `my-strong-secret-key` |
| `METRICS_API_KEY` | メトリクスAPIエンドポイントの認証キー | `prod-metrics-key-xxxx` |

## 任意

未設定の場合はデフォルト値が使用されます。

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `NODE_ENV` | 実行環境（`production` で本番モードが有効化） | `development` |
| `PORT` | サーバーがリッスンするポート番号 | `3000` |
| `SITE_HOST` | サービスのホスト名（メールリンク・ Turnstile 設定等に使用） | `patent-value-analyzer.iprich.jp` |
| `ALLOWED_ORIGINS` | CORSで許可するオリジン（カンマ区切り） | `https://ryoryoai.github.io` |
| `TRUSTED_PROXIES` | 信頼するプロキシのIPアドレス（カンマ区切り） | （なし） |
| `OPENAI_API_KEY` | OpenAI APIキー（特許リサーチ・評価に使用） | （なし） |
| `OPENAI_MODEL` | 特許リサーチで使用するOpenAIモデル名 | `gpt-5.4` |
| `OPENAI_DETAIL_MODEL` | 詳細レポート生成で使用するOpenAIモデル名 | `gpt-5.4` |
| `LLM_TIMEOUT_MS` | LLM APIリクエストのタイムアウト（ミリ秒） | `60000` |
| `RESEND_API_KEY` | Resend メール送信サービスのAPIキー | （なし） |
| `MAIL_FROM` | 送信元メールアドレス | `noreply@patent-revenue.iprich.jp` |
| `SUPABASE_URL` | Supabase プロジェクトのURL | （なし） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase サービスロールキー | （なし） |
| `JPO_USERNAME` | J-PlatPat（特許庁）APIのユーザー名 | （なし） |
| `JPO_PASSWORD` | J-PlatPat（特許庁）APIのパスワード | （なし） |
| `JPO_API_TIMEOUT_MS` | J-PlatPat APIリクエストのタイムアウト（ミリ秒） | `10000` |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile のサイトキー（CAPTCHA） | （なし） |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile のシークレットキー（CAPTCHA） | （なし） |
| `EDGE_SHARED_SECRET` | エッジ（CDN）とサーバー間の共有シークレット | （なし） |
| `ALERT_WEBHOOK_URL` | アラート通知先のWebhook URL | （なし） |
| `ADMIN_EMAILS` | 管理者メールアドレス（カンマ区切り） | （なし） |
| `V2_API_BASE` | V2分析APIのベースURL | `http://localhost:8000` |
| `V2_API_TOKEN` | V2分析API認証トークン | （なし） |
| `CHROME_PATH` | PDF生成用Chromeバイナリのパス | （自動検出） |
| `VERCEL` | Vercelデプロイ環境フラグ（Vercelが自動設定） | （なし） |

## レート制限パラメータ

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `ANON_DAILY_QUOTA` | 匿名ユーザーの1日あたりの診断上限件数 | `5` |
| `BURST_INTERVAL_MS` | バースト制限の間隔（ミリ秒） | `15000`（15秒） |
| `PER_MIN_LIMIT` | 1分あたりのリクエスト上限件数 | `3` |
| `COOLDOWN_MS` | レート制限後のクールダウン時間（ミリ秒） | `300000`（5分） |
| `CAPTCHA_REQUIRED_TTL_MS` | CAPTCHAが必要になるまでの猶予時間（ミリ秒） | `600000`（10分） |
| `GLOBAL_DAY_LIMIT` | サービス全体の1日あたりのリクエスト上限 | `3000` |
| `GLOBAL_HOUR_LIMIT` | サービス全体の1時間あたりのリクエスト上限 | `500` |
| `REQUEST_TIMEOUT_MS` | リクエスト処理のタイムアウト（ミリ秒） | `4500` |
| `BODY_LIMIT_BYTES` | リクエストボディのサイズ上限（バイト） | `4096`（4KB） |
| `CACHE_TTL_MS` | 診断結果キャッシュの有効期間（ミリ秒） | `2592000000`（30日） |
| `V2_POLL_INTERVAL_MS` | V2 API ポーリング間隔（ミリ秒） | `10000`（10秒） |
| `V2_POLL_TIMEOUT_MS` | V2 API ポーリングのタイムアウト（ミリ秒） | `600000`（10分） |

## ローカル開発

プロジェクトルートに `.env` ファイルを作成し、以下を参考に設定してください。

```dotenv
# サーバー設定
NODE_ENV=development
PORT=3000

# OpenAI（特許リサーチに必要）
OPENAI_API_KEY=sk-...

# Supabase（リード保存・登録機能に必要）
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# メール送信（Resend）
RESEND_API_KEY=re_...

# J-PlatPat API（特許ステータス取得に必要）
JPO_USERNAME=your-jpo-username
JPO_PASSWORD=your-jpo-password

# セキュリティ（本番では必ず変更する）
HASH_SECRET=dev-hash-secret
METRICS_API_KEY=dev-metrics-key

# CORS（開発時はデフォルトのまま可）
# ALLOWED_ORIGINS=http://localhost:3001

# Cloudflare Turnstile（CAPTCHA、省略可）
# TURNSTILE_SITE_KEY=...
# TURNSTILE_SECRET_KEY=...
```

> **注意**: `.env` ファイルはコミットしないでください。`.gitignore` に追加されていることを確認してください。
