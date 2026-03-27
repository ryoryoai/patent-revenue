# API仕様書

## 概要

Patent Value Analyzer の全APIエンドポイント仕様

## 共通仕様

- **Base URL**: Vercel Serverless（hnd1リージョン）
- **Content-Type**: `application/json`
- **タイムアウト**: 120秒（Vercel Serverless上限）
- **リクエストボディ上限**: 4KB（エンドポイントによって2〜8倍まで拡張）

## セキュリティ

### レスポンスヘッダ（全エンドポイント共通）

| ヘッダ | 値 |
|-------|-----|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'self'; ...`（管理画面は別ポリシー） |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload`（HTTPS時のみ） |
| `X-Request-Id` | リクエストごとに採番されたUUID |

### Originチェック

- リクエストの `Origin` ヘッダを `ALLOWED_ORIGINS` 環境変数と照合
- 許可されたOriginにのみ `Access-Control-Allow-Origin` を付与
- 不正なOriginは **403 Forbidden** を返す

### CAPTCHA（Cloudflare Turnstile）

- `TURNSTILE_SITE_KEY` が設定されている場合に有効
- レート違反2回以上で10分間のCAPTCHA検証が必須となる
- 検証成功時は違反カウンタを2減算、CAPTCHA必須状態を解除

### エッジ共有シークレット

- `EDGE_SHARED_SECRET` 環境変数が設定されている場合、APIリクエストには `x-edge-auth` ヘッダが必要
- 不一致の場合は **403 Forbidden**

---

## レート制限（4層）

`/api/diagnose` に適用される4層のレート制限。

| レベル | 制限 | 違反時レスポンス |
|--------|------|----------------|
| バースト間隔 | 1件/15秒（`BURST_INTERVAL_MS`） | 429 + `retryAfterSeconds` |
| 分間上限 | 3件/60秒（`PER_MIN_LIMIT`） | 429 + 5分クールダウン |
| 日次（ユーザー） | 5件/日（JST午前0時リセット、`ANON_DAILY_QUOTA`） | 429 |
| 日次（グローバル） | 3,000件/日・500件/時（`GLOBAL_DAY_LIMIT` / `GLOBAL_HOUR_LIMIT`） | 503 + Webhookアラート |

ユーザー識別は **IPアドレス（/64サブネット）+ `pvc_vid` Cookieのハッシュ** で行う。

---

## エンドポイント一覧

---

### POST /api/diagnose

クイック診断。特許番号またはキーワードで特許情報とスコアを返す。

**リクエストボディ上限**: 4KB

**リクエスト**:

```json
{
  "name": "string（必須）",
  "company": "string（必須）",
  "email": "string（必須、email形式）",
  "query": "string（必須、特許番号またはキーワード、1〜200文字）",
  "useStatus": "using | planned | not_using（任意）",
  "salesRange": "under_100m | 100m_1b | 1b_10b | 10b_100b | over_100b（任意）",
  "contribution": "number（任意、0.05〜1.00）",
  "captchaToken": "string（CAPTCHA必須状態の場合は必須）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string（UUID）",
  "resultId": "string（例: r_xxx_yyy）",
  "patent": {
    "id": "string（特許番号）",
    "title": "string",
    "applicant": "string",
    "applicantType": "企業 | 大学 | 個人",
    "filingDate": "string（YYYY-MM-DD）",
    "registrationDate": "string（YYYY-MM-DD）",
    "status": "string（例: 登録）",
    "category": "string（例: 製造DX / AI）",
    "ipcCodes": ["string"]
  },
  "scores": {
    "impact": "number（0〜100）",
    "breadth": "number（0〜100）",
    "strength": "number（0〜100）",
    "monetization": "number（0〜100）",
    "total": "number（0〜100）"
  },
  "rank": "A | B | C | D",
  "valueBracket": "string（例: 3,000万〜1億円）",
  "valueLow": "number（円）",
  "valueHigh": "number（円）",
  "royaltyRange": {
    "low": "number（円/年）",
    "high": "number（円/年）"
  },
  "registrationUrl": "string（J-PlatPatへのURL）",
  "quota": {
    "remainingToday": "number",
    "resetAt": "string（ISO8601）"
  },
  "leadId": "string（UUID、メール保存成功時のみ）",
  "meta": {
    "mode": "api",
    "cacheHit": "boolean",
    "requestId": "string"
  }
}
```

**レスポンス 429 Too Many Requests**:

```json
{
  "requestId": "string",
  "reason": "captcha_required | burst_interval | burst_per_minute | daily_quota | cooldown",
  "retryAfterSeconds": "number",
  "message": "quota exceeded",
  "captchaSiteKey": "string（CAPTCHA必須時のみ、Cloudflare Turnstileサイトキー）"
}
```

**レスポンス 503 Service Unavailable**（グローバル日次上限到達時）:

```json
{
  "requestId": "string",
  "reason": "global_budget_exceeded",
  "message": "service is in degraded mode"
}
```

**レスポンス 504 Gateway Timeout**（上流タイムアウト、`REQUEST_TIMEOUT_MS`デフォルト4.5秒）:

```json
{
  "requestId": "string",
  "message": "upstream timeout"
}
```

**ランク判定基準**:

| ランク | 条件 |
|--------|------|
| A | breadth ≥ 70 かつ strength ≥ 60 かつ salesRange が 10b_100b 以上 |
| B | breadth ≥ 70 かつ strength ≥ 60 かつ salesRange が 100m_1b 以上 |
| C | breadth ≥ 40 |
| D | 上記いずれにも該当しない |

---

### POST /api/request-detailed-report

詳細レポートの申請。内部で2層評価エンジン（`researchPatent`）を実行し、PDF添付メールを送信する。

**レート制限**: 1ユーザーあたり3件/日（`emailLimitStore`）

**リクエストボディ上限**: 8KB（4KB × 2）

**リクエスト**:

```json
{
  "email": "string（必須、email形式）",
  "patentId": "string（必須、特許番号）",
  "name": "string（任意）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "レポートを送信しました。メールをご確認ください。",
  "patentId": "string",
  "_pdf": {
    "id": "string（Resend メールID）"
  }
}
```

**レスポンス 422 Unprocessable Entity**（特許が無効・失効済みの場合）:

```json
{
  "requestId": "string",
  "code": "PATENT_INVALID",
  "message": "string（無効理由）",
  "patentId": "string"
}
```

備考: 特許無効の場合は自動的に無効通知メールをユーザーに送信する。クオータは消費しない。

---

### POST /api/detailed-report

詳細レポートの生成（JSONレスポンス）。2層評価エンジンの出力をそのまま返す。PDF添付メールは送信しない。

**レート制限**: 1ユーザーあたり3件/日（`reportLimitStore`）

**リクエストボディ上限**: 16KB（4KB × 4）

**リクエスト**:

```json
{
  "patentId": "string（必須）または patent.id として渡すことも可",
  "patent": {
    "id": "string（patentId の代替）"
  },
  "name": "string（任意）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "report": {
    "summary": "string",
    "strengths": ["string"],
    "risks": ["string"],
    "monetizationAdvice": "string"
  },
  "structured": "object（評価エンジンの構造化出力）",
  "source": "string（データソース識別子）"
}
```

**レスポンス 422 Unprocessable Entity**（特許が無効・失効済みの場合）:

```json
{
  "requestId": "string",
  "code": "PATENT_INVALID",
  "status": "string（無効理由）",
  "message": "string",
  "patent": {
    "id": "string",
    "title": "string",
    "applicant": "string",
    "status": "string"
  }
}
```

---

### POST /api/send-report

簡易結果メールの送信。`reportType: "detailed"` を指定すると `/api/send-detailed-report` と同等のPDF添付メールを送信する。

**レート制限**: 1ユーザーあたり3件/日（`emailLimitStore`）

**リクエストボディ上限**: 32KB（4KB × 8）

**リクエスト**:

```json
{
  "email": "string（必須、email形式）",
  "reportData": "object（必須、レポート内容）",
  "reportType": "string（任意、'detailed' でPDF添付メール）",
  "name": "string（任意）",
  "leadId": "string（任意、UUID。指定時は詳細登録用トークンURLを生成してメールに含める）"
}
```

`reportData` の内容例（簡易版）:

```json
{
  "rank": "string",
  "name": "string"
}
```

`reportData` の内容例（詳細版 `reportType: "detailed"` 時）:

```json
{
  "patent": "object",
  "scores": "object",
  "valueRange": "object",
  "route": { "title": "string" },
  "rank": "string",
  "rankMessage": "string",
  "report": "object",
  "structured": "object"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "メールを送信しました。（詳細版の場合: 詳細評価レポートメールを送信しました。）",
  "emailId": "string（Resend メールID）"
}
```

---

### POST /api/send-detailed-report

`/api/send-report` の互換エイリアス。常に `reportType: "detailed"` として動作する（PDF添付メール）。

リクエスト・レスポンス仕様は `/api/send-report` と同一。

---

### GET /api/detail-registration

詳細登録フォームのプリフィルデータ取得。メール送信時に生成されたトークンを検証する。

**リクエスト**:

```
GET /api/detail-registration?t={token}
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `t` | 必須 | トークン文字列（有効期限7日） |

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "lead": {
    "id": "string（UUID）",
    "name": "string",
    "company_name": "string",
    "email": "string"
  }
}
```

**レスポンス 401 Unauthorized**（トークン無効・期限切れ）:

```json
{
  "requestId": "string",
  "message": "invalid or expired token"
}
```

---

### POST /api/detail-registration

詳細登録フォームのデータ保存。トークンを検証してからSupabaseに保存する。

**リクエストボディ上限**: 16KB（4KB × 4）

**リクエスト**:

```json
{
  "token": "string（必須、有効期限7日以内のトークン）",
  "type": "string（必須、登録種別。例: 'license_inquiry', 'sale_inquiry'）",
  "fields": {
    "department": "string（任意）",
    "contact_name": "string（任意）",
    "phone": "string（任意）",
    "desired_price": "string（任意）",
    "support_method": "string（任意）"
  }
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "詳細情報を受け付けました。"
}
```

**レスポンス 401 Unauthorized**（トークン無効・期限切れ）:

```json
{
  "requestId": "string",
  "message": "invalid or expired token"
}
```

---

### POST /api/evaluate

V2パイプライン評価の開始。特許IDを受け取り、`investigateAndRank` で評価を実行後、結果をメールで送信する。

**リクエストボディ上限**: 8KB（4KB × 2）

**リクエスト**:

```json
{
  "patentId": "string（必須）",
  "email": "string（必須、email形式）",
  "name": "string（任意）",
  "pipeline": "string（任意、デフォルト: 'C'）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "評価が完了しました。メールをご確認ください。",
  "patentId": "string"
}
```

**レスポンス 503 Service Unavailable**（V2サービス未起動の場合）:

```json
{
  "requestId": "string",
  "message": "評価サービスが現在利用できません。しばらくしてからお試しください。"
}
```

---

### GET /api/admin/stats

ダッシュボード統計情報の取得。

**認証**: Bearer JWT（Supabase Auth、`ADMIN_EMAILS`に含まれるメールアドレス必須）または `x-metrics-key` ヘッダ

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "totalLeads": "number（累計リード数）",
  "newToday": "number（本日のリード数）",
  "pendingRegistrations": "number（status='pending' の詳細登録数）",
  "newInquiries": "number（status='new' の問い合わせ数）"
}
```

---

### GET /api/admin/leads

リード一覧の取得。

**認証**: Bearer JWT または `x-metrics-key`

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `status` | string | ステータスフィルタ（任意） |
| `search` | string | 名前・企業名・メールの部分一致検索（任意） |
| `limit` | number | 取得件数（デフォルト50、最大200） |
| `offset` | number | オフセット（デフォルト0） |

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "leads": [
    {
      "id": "string（UUID）",
      "name": "string",
      "company_name": "string",
      "email": "string",
      "status": "string",
      "source": "string",
      "admin_notes": "string",
      "created_at": "string（ISO8601）",
      "updated_at": "string（ISO8601）",
      "patents": [{ "patent_number": "string", "title": "string" }],
      "detail_registrations": [{ "id": "string", "type": "string", "status": "string" }]
    }
  ],
  "count": "number",
  "offset": "number",
  "limit": "number"
}
```

---

### GET /api/admin/leads/{id}

リード詳細の取得。

**認証**: Bearer JWT または `x-metrics-key`

**パスパラメータ**: `id`（UUID）

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "lead": "object（leadsテーブルの全フィールド）",
  "patents": ["object（patentsテーブル、lead_idで絞込）"],
  "registrations": ["object（detail_registrationsテーブル、lead_idで絞込）"]
}
```

**レスポンス 404 Not Found**:

```json
{
  "requestId": "string",
  "message": "lead not found"
}
```

---

### PATCH /api/admin/leads/{id}

リードのステータス・メモの更新。

**認証**: Bearer JWT または `x-metrics-key`

**パスパラメータ**: `id`（UUID）

**リクエスト**:

```json
{
  "status": "string（任意）",
  "admin_notes": "string（任意）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "updated"
}
```

---

### GET /api/admin/detail-registrations

詳細登録一覧の取得。

**認証**: Bearer JWT または `x-metrics-key`

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `status` | string | ステータスフィルタ（任意） |
| `limit` | number | 取得件数（デフォルト50、最大200） |
| `offset` | number | オフセット（デフォルト0） |

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "registrations": [
    {
      "id": "string（UUID）",
      "lead_id": "string（UUID）",
      "patent_id": "string（UUID）",
      "type": "string",
      "department": "string",
      "contact_name": "string",
      "phone": "string",
      "desired_price": "string",
      "support_method": "string",
      "status": "string",
      "admin_notes": "string",
      "created_at": "string（ISO8601）",
      "updated_at": "string（ISO8601）"
    }
  ],
  "count": "number",
  "offset": "number",
  "limit": "number"
}
```

---

### PATCH /api/admin/detail-registrations/{id}

詳細登録のステータス・メモの更新。

**認証**: Bearer JWT または `x-metrics-key`

**パスパラメータ**: `id`（UUID）

**リクエスト**:

```json
{
  "status": "string（任意）",
  "admin_notes": "string（任意）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "updated"
}
```

---

### GET /api/admin/consultation-inquiries

問い合わせ一覧の取得。

**認証**: Bearer JWT または `x-metrics-key`

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `status` | string | ステータスフィルタ（任意） |
| `limit` | number | 取得件数（デフォルト50、最大200） |
| `offset` | number | オフセット（デフォルト0） |

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "inquiries": [
    {
      "id": "string（UUID）",
      "catalog_entry_id": "string",
      "name": "string",
      "company_name": "string",
      "email": "string",
      "phone": "string",
      "message": "string",
      "inquiry_type": "string",
      "status": "string",
      "admin_notes": "string",
      "created_at": "string（ISO8601）"
    }
  ],
  "count": "number",
  "offset": "number",
  "limit": "number"
}
```

---

### PATCH /api/admin/consultation-inquiries/{id}

問い合わせのステータス・メモの更新。

**認証**: Bearer JWT または `x-metrics-key`

**パスパラメータ**: `id`（UUID）

**リクエスト**:

```json
{
  "status": "string（任意）",
  "admin_notes": "string（任意）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "updated"
}
```

---

### GET /api/admin/patents

特許一覧の取得。

**認証**: Bearer JWT または `x-metrics-key`

**クエリパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `status` | string | ステータスフィルタ（任意） |
| `limit` | number | 取得件数（デフォルト100、最大500） |
| `offset` | number | オフセット（デフォルト0） |

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "patents": [
    {
      "id": "string（UUID）",
      "patent_number": "string",
      "normalized_number": "string",
      "title": "string",
      "category": "string",
      "applicant": "string",
      "ipc_codes": ["string"],
      "status": "string",
      "diagnosis_result": "object",
      "created_at": "string（ISO8601）",
      "updated_at": "string（ISO8601）"
    }
  ],
  "count": "number",
  "offset": "number",
  "limit": "number"
}
```

---

### POST /api/admin/export-patents

特許データのバッチエクスポート。JSON形式またはCSV形式で返す。

**認証**: Bearer JWT または `x-metrics-key`

**リクエストボディ上限**: 8KB（4KB × 2）

**リクエスト**:

```json
{
  "format": "json | csv（任意、デフォルト: 'json'）",
  "limit": "number（任意、デフォルト100、最大500）",
  "status": "string（任意、デフォルト: '登録'）"
}
```

**レスポンス 200 OK（JSON形式）**:

```json
{
  "requestId": "string",
  "patents": [
    {
      "id": "string",
      "patent_number": "string",
      "normalized_number": "string",
      "title": "string",
      "category": "string",
      "applicant": "string",
      "ipc_codes": ["string"]
    }
  ],
  "count": "number"
}
```

**レスポンス 200 OK（CSV形式）**:

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="patents-export-YYYY-MM-DD.csv"`
- カラム: `id, patent_number, normalized_number, title, category, applicant, ipc_codes`

---

### POST /api/admin/sync-analysis

V2分析結果のSupabaseへの同期保存。

**認証**: Bearer JWT または `x-metrics-key`

**リクエストボディ上限**: 16KB（4KB × 4）

**リクエスト**:

```json
{
  "patent_id": "string（必須、SupabaseのpatentレコードのUUID）",
  "result": "object（必須、V2分析結果）"
}
```

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "message": "analysis result saved",
  "patentId": "string"
}
```

---

### GET /api/metrics

システムメトリクスの取得。

**認証**: Bearer JWT（Supabase Auth）または `x-metrics-key` ヘッダ

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "metrics": {
    "diagnoseRequests": "number（診断リクエスト総数）",
    "diagnoseAllowed": "number（許可された診断数）",
    "diagnoseBlocked": "number（レート制限でブロックされた数）",
    "blockedByReason": {
      "captcha_required": "number",
      "burst_interval": "number",
      "burst_per_minute": "number",
      "daily_quota": "number",
      "global_budget_exceeded": "number"
    },
    "cacheHit": "number（キャッシュヒット数）",
    "cacheMiss": "number（キャッシュミス数）",
    "upstreamCalls": "number（上流API呼び出し数）",
    "errors4xx": "number",
    "errors5xx": "number",
    "latencyP95Ms": "number（p95レイテンシ ms）"
  },
  "budget": {
    "hour": {
      "used": "number",
      "limit": "number",
      "resetAt": "string（ISO8601）"
    },
    "day": {
      "used": "number",
      "limit": "number",
      "resetAt": "string（ISO8601）"
    }
  }
}
```

---

### GET /api/v2-status

V2 APIの疎通確認。

**認証**: 不要

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "v2Available": "boolean"
}
```

---

### GET /api/debug-connectivity

接続性デバッグ情報の取得。OpenAI API・JPO API・Supabase・PDF生成の疎通を確認する。

**認証**: Bearer JWT または `x-metrics-key`（管理者認証）

**レスポンス 200 OK**:

```json
{
  "requestId": "string",
  "openai": {
    "ok": "boolean",
    "response": "string（成功時、最大50文字）",
    "error": "string（失敗時）"
  },
  "jpo": {
    "available": "boolean",
    "connected": "boolean（available=true かつ疎通成功時）",
    "error": "string（失敗時）"
  },
  "supabase": {
    "available": "boolean",
    "connected": "boolean（available=true かつ疎通成功時）",
    "leadsCount": "number（接続成功時）",
    "error": "string（失敗時）"
  },
  "pdf": {
    "ok": "boolean",
    "size": "number（バイト数、成功時）",
    "error": "string（失敗時）"
  },
  "env": {
    "OPENAI_API_KEY": "string（マスク済み、例: sk-proj-...xxxx）",
    "RESEND_API_KEY": "string（マスク済み）",
    "OPENAI_MODEL": "string",
    "JPO_USERNAME": "boolean（設定有無）",
    "JPO_PASSWORD": "boolean（設定有無）",
    "SUPABASE_URL": "boolean（設定有無）",
    "NODE_ENV": "string"
  }
}
```

---

## 共通エラーレスポンス

全エンドポイントで返される可能性のあるエラー。

| HTTPステータス | 説明 | `message` |
|--------------|------|-----------|
| 400 | リクエストボディが不正またはバリデーションエラー | `"invalid request body"` 等 |
| 403 | 不正なOrigin、エッジ認証失敗、または管理者認証失敗 | `"forbidden origin"` / `"edge auth required"` / `"forbidden"` |
| 404 | 管理APIのパスが存在しない | `"admin endpoint not found"` / `"lead not found"` |
| 413 | リクエストボディが上限を超過 | `"payload too large"` |
| 422 | 特許が無効・失効済み（`/api/request-detailed-report`, `/api/detailed-report`） | `"PATENT_INVALID"` |
| 429 | レート制限超過 | `"quota exceeded"` / `"1日あたりの上限に達しました"` 等 |
| 500 | サーバー内部エラー | `"internal server error"` 等 |
| 503 | グローバル予算超過またはSupabase未設定 | `"service is in degraded mode"` 等 |
| 504 | 上流APIタイムアウト | `"upstream timeout"` |

---

## CORS プリフライト

**OPTIONS /api/***

```
Access-Control-Allow-Methods: POST, GET, PATCH, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Metrics-Key, Authorization
```

ステータス: **204 No Content**

---

## 環境変数一覧（抜粋）

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `ANON_DAILY_QUOTA` | `5` | ユーザーあたりの1日診断上限 |
| `BURST_INTERVAL_MS` | `15000` | バースト間隔（ms） |
| `PER_MIN_LIMIT` | `3` | 1分あたりの上限 |
| `COOLDOWN_MS` | `300000` | クールダウン時間（ms） |
| `GLOBAL_DAY_LIMIT` | `3000` | グローバル1日上限 |
| `GLOBAL_HOUR_LIMIT` | `500` | グローバル1時間上限 |
| `CACHE_TTL_MS` | `2592000000` | キャッシュ有効期間（30日） |
| `REQUEST_TIMEOUT_MS` | `4500` | 上流APIタイムアウト（ms） |
| `BODY_LIMIT_BYTES` | `4096` | リクエストボディ基本上限（bytes） |
| `ALLOWED_ORIGINS` | `https://ryoryoai.github.io` | 許可するOrigin（カンマ区切り） |
| `CAPTCHA_REQUIRED_TTL_MS` | `600000` | CAPTCHA必須期間（ms、10分） |
| `TURNSTILE_SITE_KEY` | `""` | Cloudflare Turnstileサイトキー |
| `TURNSTILE_SECRET_KEY` | `""` | Cloudflare Turnstileシークレットキー |
| `EDGE_SHARED_SECRET` | `""` | エッジ共有シークレット（設定時はAPIに必須） |
| `ADMIN_EMAILS` | `""` | 管理者メールアドレス（カンマ区切り） |
| `METRICS_API_KEY` | `dev-metrics-key` | メトリクスAPIキー |
| `SITE_HOST` | `patent-value-analyzer.iprich.jp` | メール内リンクのホスト名 |
| `ALERT_WEBHOOK_URL` | `""` | アラートWebhook URL |
