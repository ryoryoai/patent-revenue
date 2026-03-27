# セキュリティ仕様書

Patent Value Analyzer のセキュリティ実装に関する包括的な仕様書です。

---

## 1. HTTPセキュリティヘッダ

すべてのレスポンスに対して `applySecurityHeaders()` で以下のヘッダが付与されます。

### 1.1 共通ヘッダ

| ヘッダ | 値 | 目的 |
|--------|-----|------|
| `X-Request-Id` | UUID v4 | リクエスト追跡 |
| `X-Content-Type-Options` | `nosniff` | MIMEスニッフィング防止 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | リファラ情報の制限 |
| `X-Frame-Options` | `DENY` | クリックジャッキング防止 |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | ブラウザ機能の制限 |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | HTTPS強制（HTTPS接続時のみ付与） |

### 1.2 Content-Security-Policy

パス別に2種類のCSPを使い分けます。

**通常ページ用 CSP** (`/admin/` および `/api/admin/` 以外):

```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

`frame-src` に `challenges.cloudflare.com` を許可しているのは Cloudflare Turnstile CAPTCHA ウィジェットの表示に必要なためです。

**管理画面用 CSP** (`/admin/` および `/api/admin/`):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self' https://sukemwnslhkehatwvdqd.supabase.co;
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

通常ページと比べて `frame-src` が削除され、`connect-src` が Supabase エンドポイントに限定されます。`script-src` に外部ドメインは含まれません。

---

## 2. 認証・認可

### 2.1 管理画面認証 (`lib/admin-auth.js`)

管理APIへのアクセスには2段階の認証フォールバックを実装しています。

**認証フロー:**

```
1. Authorization: Bearer {JWT} ヘッダを確認
   ↓
   Supabase Auth で JWT を検証
   ↓
   user.email が ADMIN_EMAILS 環境変数のリストに含まれるか確認
   → 含まれる: 認証成功 (method: "jwt")

2. (JWT 検証失敗または Supabase 未設定の場合)
   x-metrics-key ヘッダが METRICS_API_KEY 環境変数と一致するか確認
   → 一致する: 認証成功 (method: "api_key")

3. どちらも失敗: 403 Forbidden
```

**適用エンドポイント:**
- `GET /api/metrics` — メトリクス取得
- `GET /api/admin/*` — 管理API全般
- `GET /api/debug-connectivity` — 接続テスト

**環境変数:**
- `ADMIN_EMAILS`: カンマ区切りの管理者メールアドレスリスト（大文字小文字を区別しない）
- `METRICS_API_KEY`: APIキー認証用シークレット

### 2.2 Edge共有シークレット

`EDGE_SHARED_SECRET` が設定されている場合、`/api/*` への全リクエストで `x-edge-auth` ヘッダとの一致を検証します。

```
EDGE_SHARED_SECRET 設定あり かつ
x-edge-auth ヘッダ ≠ EDGE_SHARED_SECRET
→ 403 Forbidden ("edge auth required")
```

これにより Cloudflare Edge 経由でのみ API にアクセスできるよう制限できます。

### 2.3 オリジン検証

`/api/*` リクエストのすべてに対してオリジン検証を実施します。

**許可条件:**
- `Origin` ヘッダが存在しない（直接アクセス）
- `Origin` がリクエストホストと一致する（同一オリジン）
- `Origin` が `ALLOWED_ORIGINS` 環境変数に含まれる（デフォルト: `https://ryoryoai.github.io`）

不正なオリジンには `403 Forbidden ("forbidden origin")` を返します。

---

## 3. レート制限

診断API (`POST /api/diagnose`) には4層構造のレート制限を実装しています。

### 3.1 ユーザー識別子

識別子は `IP + Cookie` の組み合わせを HMAC-SHA256 でハッシュ化した値です（後述のセクション6を参照）。

### 3.2 4層構造

| 層 | 制限内容 | デフォルト値 | 環境変数 | 超過時の応答 |
|----|---------|------------|---------|------------|
| バーストインターバル | リクエスト間隔 ≥ 15秒 | 15,000ms | `BURST_INTERVAL_MS` | 429 (reason: burst_interval) |
| 毎分上限 | 60秒以内に3回まで | 3回 | `PER_MIN_LIMIT` | 429 + クールダウン (reason: burst_per_minute) |
| クールダウン | バースト違反後5分間のブロック | 300,000ms | `COOLDOWN_MS` | 429 (reason: cooldown) |
| 日次クォータ | 24時間（JST深夜0時リセット）で5回まで | 5回 | `ANON_DAILY_QUOTA` | 429 (reason: daily_quota) |

### 3.3 グローバル予算

外部API呼び出しのコスト保護として、サービス全体の予算も管理します。

| 制限 | デフォルト | 環境変数 |
|------|-----------|---------|
| 1時間あたり | 500回 | `GLOBAL_HOUR_LIMIT` |
| 1日あたり | 3,000回 | `GLOBAL_DAY_LIMIT` |

予算超過時は `503 Service Unavailable` を返します。予算の80%に達するとアラートWebhookに通知します。

### 3.4 CAPTCHA連動（Cloudflare Turnstile）

`TURNSTILE_SITE_KEY` が設定されている場合、違反が一定数以上累積するとCAPTCHAチャレンジを要求します。

**CAPTCHA発動条件:**
- バーストインターバル違反が15分以内に2回以上累積した場合
- 毎分上限（3回/分）を超過した場合

**CAPTCHA発動時の挙動:**
- 429レスポンスに `captchaSiteKey` フィールドを含めてクライアントに通知
- 10分間（`CAPTCHA_REQUIRED_TTL_MS`）CAPTCHA解決が必要な状態が持続
- CAPTCHA解決（`captchaToken` 付きリクエスト）で状態がリセット、違反カウントが-2される

**CAPTCHA検証フロー:**
- Cloudflare Turnstile の `/turnstile/v0/siteverify` APIにトークンとクライアントIPを送信
- タイムアウト: 3秒
- 検証失敗時はリクエストを拒否せず、CAPTCHAなし扱いで通常のレート制限が適用される

---

## 4. 入力検証

### 4.1 クエリ検証（`/api/diagnose`）

```javascript
validateQuery(query):
  - 空文字列 → 400 Bad Request
  - 200文字超 → 400 Bad Request
  - 制御文字 (\x00-\x1F, \x7F) を含む → 400 Bad Request
```

### 4.2 メールアドレス検証

正規表現 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` で検証します。
適用箇所: `/api/diagnose`, `/api/send-report`, `/api/request-detailed-report`, `/api/evaluate`

### 4.3 リクエストボディ制限

| エンドポイント | 上限 |
|--------------|------|
| `/api/diagnose` | 4KB (`BODY_LIMIT_BYTES`) |
| `/api/send-report` | 32KB (`BODY_LIMIT_BYTES × 8`) |
| `/api/detailed-report` | 16KB (`BODY_LIMIT_BYTES × 4`) |
| 管理API (PATCH) | 8KB (`BODY_LIMIT_BYTES × 2`) |

ボディ上限超過時は `413 Payload Too Large` を返します。

### 4.4 ヘッダ値のサニタイズ（`lib/header-safety.js`）

`sanitizeHeaderValue()` は以下の文字を除去します:
- 制御文字: `\x00-\x1F`、`\x7F`
- C1制御文字: `\u0080-\u009F`
- BOM: `\uFEFF`

`summarizeSecret()` はデバッグ出力用にシークレット値を安全に要約します（先頭7文字・末尾4文字のみ表示、改行文字・無効文字の有無を報告）。

### 4.5 その他のフィールド検証

- 氏名・企業名: `.slice(0, 100)` で最大100文字に切り詰め
- メールアドレス: `.slice(0, 200)` で最大200文字に切り詰め
- オリジンURL: `new URL()` で正規化（無効なURLは除外）
- 信頼プロキシIPリスト: IPv4-mapped IPv6アドレス (`::ffff:`) を正規化して比較

---

## 5. Cookie管理

### 5.1 訪問者識別Cookie (`pvc_vid`)

| 属性 | 値 |
|------|-----|
| 名前 | `pvc_vid` |
| 値 | `crypto.randomUUID()` で生成したUUID v4 |
| `Path` | `/` |
| `HttpOnly` | 常に付与 |
| `SameSite` | `Lax` |
| `Max-Age` | `31536000`（1年） |
| `Secure` | HTTPS接続時のみ付与 |

HTTPS判定は `x-forwarded-proto: https`（信頼プロキシ経由）または `req.socket.encrypted` で行います。

---

## 6. ユーザー識別

### 6.1 識別子の生成

ユーザー識別子は以下の組み合わせを HMAC-SHA256 でハッシュ化して生成します:

```
HMAC-SHA256(HASH_SECRET, "{正規化IP}:{visitorId}").slice(0, 24)
```

**IPアドレスの正規化:**
- IPv6アドレスの場合: `/64プレフィックス` 単位で識別（例: `2001:db8:1234:5678::/64`）
- IPv4アドレスの場合: そのまま使用

**IPアドレスの取得:**
- `TRUSTED_PROXIES` に登録されたプロキシからのリクエストの場合: `X-Forwarded-For` ヘッダから最も右のトラストされていないIPを使用
- それ以外: `req.socket.remoteAddress` を使用

**visitorId:** `pvc_vid` Cookieの値

### 6.2 環境変数

- `HASH_SECRET`: HMAC用シークレット（本番環境では必須、未設定時は `"pvc-dev-secret"` を使用してwarningログ）
- `TRUSTED_PROXIES`: カンマ区切りの信頼プロキシIPリスト

---

## 7. 詳細登録トークン（`lib/detail-registration.js`）

### 7.1 トークン生成

```javascript
generateToken():
  → crypto.randomBytes(32).toString("hex")  // 64文字の16進数文字列

hashToken(token):
  → crypto.createHash("sha256").update(token).digest("hex")
```

DBには平文トークンを保存せず、SHA-256ハッシュのみを保存します。

### 7.2 トークン検証

`verifyToken(tokenHash)` は以下の条件をすべて確認します:

1. `token_hash` がDBに存在する
2. `used_at` が NULL（未使用）
3. `expires_at` が現在時刻より後（有効期限内）

### 7.3 有効期限・利用回数

| 属性 | 値 |
|------|-----|
| 有効期限 | 発行から7日間 |
| 利用回数 | 1回限り（使用後に `used_at` が更新される） |

---

## 8. 環境変数管理（`lib/env.js`）

### 8.1 必須シークレット（本番環境）

`resolveSecret(name, devDefault, { isProduction })` により、本番環境（`NODE_ENV=production`）で未設定の場合はサーバー起動時に例外をスローします。

| 変数名 | 用途 | 本番必須 |
|--------|------|---------|
| `HASH_SECRET` | ユーザー識別HMAC | はい |
| `METRICS_API_KEY` | メトリクスAPIキー認証 | はい |

### 8.2 任意シークレット

| 変数名 | 用途 | デフォルト |
|--------|------|-----------|
| `EDGE_SHARED_SECRET` | Edgeゲートウェイ認証 | なし（設定時のみ有効） |
| `ALERT_WEBHOOK_URL` | アラート通知先URL | なし |
| `TURNSTILE_SITE_KEY` | Turnstile サイトキー | なし（CAPTCHA無効） |
| `TURNSTILE_SECRET_KEY` | Turnstile シークレット | なし（CAPTCHA無効） |
| `ADMIN_EMAILS` | 管理者メールアドレスリスト | なし |
| `ALLOWED_ORIGINS` | 追加許可オリジン（カンマ区切り） | なし |
| `TRUSTED_PROXIES` | 信頼プロキシIPリスト（カンマ区切り） | なし |

### 8.3 オリジン・プロキシ設定の正規化

- オリジンURLは `new URL()` で正規化し、無効なURLは除外してwarningログを出力
- IPv4-mapped IPv6アドレス (`::ffff:`) はIPv4として正規化して比較

---

## 9. RLS（Row Level Security）

Supabaseのテーブルに対してRLSポリシーを設定します。詳細はSupabase Dashboardまたはマイグレーションファイル（`supabase/migrations/`）を参照してください。

**基本方針:**
- 管理テーブル（`leads`, `patents`, `detail_registrations` 等）: 認証済みユーザー（管理者）のみアクセス可能
- 公開書き込み操作（リード登録など）はサーバーサイドのサービスロールキーを使用し、RLSをバイパス
- クライアントサイドからの直接アクセスは原則禁止

---

## 10. Edge WAF設定（Cloudflare想定）

詳細は `/EDGE_WAF_CHECKLIST.md` を参照してください。以下は主要な設定項目です。

### 10.1 Vercel WAFルール / Cloudflare WAF

| 設定 | 内容 |
|------|------|
| Managed WAF | SQLi, XSS, RCE, LFI/RFI ルールを有効化 |
| Rate Limit | `/api/diagnose` に対してIPベースの制限を追加 |
| Bot対策 | Bot scoreが低いトラフィックにはChallengeを適用 |
| オリジン直アクセス | Firewall + allowlistでオリジンへの直接アクセスを遮断 |

### 10.2 HTTPS / HSTS設定

| 設定 | 値 |
|------|-----|
| Always Use HTTPS | ON |
| HSTS max-age | 31,536,000秒（1年）以上 |
| HSTS includeSubDomains | 有効 |
| HSTS preload | 有効 |
| TLS最低バージョン | TLS 1.2以上 |

### 10.3 シークレット管理・ローテーション

以下のシークレットはSecrets管理システム（Vercel環境変数、Cloudflare Secrets等）で管理し、90日ごとにローテーションします:

- `EDGE_SHARED_SECRET`
- `METRICS_API_KEY`
- `TURNSTILE_SECRET_KEY`
- `HASH_SECRET`

### 10.4 監視アラート

| イベント | 閾値 |
|---------|------|
| グローバル時間予算 | 80%（`GLOBAL_HOUR_LIMIT`の80%）達成時 |
| グローバル日次予算 | 80%（`GLOBAL_DAY_LIMIT`の80%）達成時 |
| p95レイテンシ | 3,000ms超過時（15分間クールダウン付き） |
| WAFブロック | Cloudflare Dashboardで監視 |
| オリジン5xxエラー率 | Cloudflare Dashboardで監視 |

### 10.5 インシデント対応

- `X-Request-Id` ヘッダを使ってWAFログとアプリケーションログを突合
- 構造化ログ（JSON形式）でリクエストIDを全ログイベントに付与

---

## 11. 観測可能性とログ

### 11.1 構造化ログ

すべてのリクエストイベントは以下の形式でJSON出力されます:

```json
{
  "at": "2024-01-15T12:00:00.000Z",
  "requestId": "uuid-v4",
  "type": "diagnose_success | quota_block | ...",
  "user": "hashed_user_key",
  "ipHash": "hashed_ip"
}
```

ユーザーIPおよびユーザーキーはハッシュ化されており、生のIPアドレスはログに記録されません。

### 11.2 イベントタイプ

| type | 発生タイミング |
|------|--------------|
| `quota_block` | レート制限でブロックされた場合 |
| `diagnose_success` | 診断成功 |
| `request_detailed_report_complete` | 詳細レポート送信完了 |
| `request_detailed_report_error` | 詳細レポート生成失敗 |
| `send_report` | 簡易レポートメール送信 |
| `send_detailed_report` | 詳細レポートメール送信 |
| `detail_registration_saved` | 詳細登録データ保存 |
| `admin_sync_analysis` | 分析結果同期（管理API） |
| `v2_evaluate_complete` | V2評価完了 |
