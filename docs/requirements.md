# PatentRevenue 要件定義書

**バージョン**: 1.0
**最終更新日**: 2026-03-17
**プロジェクト名**: patent-revenue (PatentRevenue MVP)
**ステータス**: 運用中（V2パイプライン連携は一部制限あり）

---

## 1. プロジェクト概要

### 1.1 目的

特許権者が保有特許の収益化ポテンシャルを簡易に評価し、ライセンス・売却に向けたアクションにつなげるWebサービス。

### 1.2 サービスコンセプト

「知財を収益に変える」— 特許番号を入力するだけで、AIによる簡易評価と詳細レポートを取得でき、収益化への第一歩を踏み出せる。

### 1.3 ターゲットユーザー

- 特許権者（企業知財部門、個人発明家）
- 知財ブローカー・コンサルタント
- 特許の価値を把握したい経営者・事業担当者

### 1.4 ビジネスモデル

- 簡易評価: 無料（1日5回まで）
- 詳細レポート: 無料（1日3回まで。特許登録が前提）
- 将来的に専門家による精密評価・マッチングサービスへ誘導

---

## 2. システム構成

### 2.1 アーキテクチャ

```
[ブラウザ] ──→ [patent-revenue (Node.js)]
                      │
                      ├── JPO特許情報API（特許庁）
                      ├── OpenAI API（GPT-5 / 推定・レポート生成）
                      ├── Resend API（メール送信）
                      ├── V2パイプライン (ip-rich-poc-phase2)
                      │     └── 構成要件充足判定 + 売上推定
                      └── Cloudflare Turnstile（CAPTCHA）
```

### 2.2 技術スタック

| レイヤー | 技術 |
|---------|------|
| バックエンド | Node.js (標準 http モジュール、フレームワークなし) |
| フロントエンド | Vanilla HTML/CSS/JS |
| メール送信 | Resend API |
| LLM | OpenAI API (GPT-5) |
| 特許データ | JPO特許情報取得API |
| 構成要件充足判定 | V2パイプライン (Python/FastAPI, Vercel Functions) |
| CAPTCHA | Cloudflare Turnstile |
| CI/CD | GitHub Actions |
| ホスティング | Vercel (patent-revenue本体は別途) |

### 2.3 外部依存パッケージ

| パッケージ | 用途 |
|-----------|------|
| dotenv | 環境変数管理 |
| resend | メール送信SDK |

---

## 3. 機能要件

### 3.1 簡易評価機能

**FR-001: 特許番号による簡易診断**

| 項目 | 内容 |
|------|------|
| エンドポイント | `POST /api/diagnose` |
| 入力 | 特許番号またはキーワード（最大200文字） |
| 処理 | 1. JPO APIで特許情報取得 → 2. 取得失敗時はOpenAI LLMで推定 → 3. モックデータへフォールバック |
| 出力 | 特許情報（発明名、出願人、出願日、カテゴリ、メトリクス） |
| キャッシュ | 30日間（正規化された特許番号をキーとして） |

**FR-002: 評価メール送信**

| 項目 | 内容 |
|------|------|
| エンドポイント | `POST /api/send-report` |
| 入力 | メールアドレス、氏名、評価データ |
| 処理 | Resend API経由でHTML形式の簡易評価結果メールを送信 |
| テンプレート | ランク表示（A〜D）、ランク説明、次のステップ案内 |

### 3.2 詳細レポート機能

**FR-003: 詳細レポート申請（非同期）**

| 項目 | 内容 |
|------|------|
| エンドポイント | `POST /api/request-detailed-report` |
| 入力 | 特許番号、メールアドレス、氏名 |
| レスポンス | 202 Accepted（即時応答） |
| バックグラウンド処理 | 1. 特許情報取得 → 2. V2パイプライン（利用可能な場合）→ 3. スコア算出 → 4. OpenAIでレポート生成 → 5. メール送信 |

**FR-004: スコア算出ロジック**

4軸スコア（各0〜100）:

| 軸 | 算出方法 |
|----|---------|
| 影響度 (impact) | 被引用数 × 2.5 (上限100) |
| 権利の広さ (breadth) | 請求項数 × 6 + ファミリーサイズ × 5 (上限100) |
| 実務上の強さ (strength) | 分類ランク (上限100) |
| 収益化の近さ (monetization) | 市場プレイヤー数 × 3 (上限100) |
| 総合スコア | 4軸の単純平均 |

**FR-005: ランク判定**

V2パイプラインの結果がある場合:

| ランク | 条件 |
|--------|------|
| A | 全構成要件充足 かつ 被疑侵害製品売上100億円以上 |
| B | 全構成要件充足 かつ 被疑侵害製品売上1億円以上 |
| C | 構成要件の一部を充足 |
| D | 構成要件を充足していない |

V2パイプラインの結果がない場合（フォールバック）:

| ランク | 条件 |
|--------|------|
| A | 総合スコア 75以上 |
| B | 総合スコア 55以上 |
| C | 総合スコア 35以上 |
| D | 総合スコア 35未満 |

**FR-006: 詳細レポート生成（OpenAI）**

| 項目 | 内容 |
|------|------|
| モデル | GPT-5 (環境変数で変更可能) |
| 出力形式 | JSON |
| レポート項目 | summary（発明の概要）, strengths（強み・優位性）, licensableFields（ライセンス可能分野）, royaltyRate（想定ロイヤルティ率）, valueBracket（ライセンス可能額の目安）, monetizationMethods（推奨する収益化手段）, nextSteps（次の一手） |
| フォールバック | API失敗時はカテゴリ別テンプレートを使用した決定論的出力 |

**FR-007: 詳細レポートメール送信**

| 項目 | 内容 |
|------|------|
| 送信元 | noreply@patent-revenue.iprich.jp |
| テンプレート | 総合スコア、ランク、4軸スコアバー、特許情報、推定価値レンジ、レポート7項目、次のステップCTA |
| ブランディング | PatentRevenueロゴ、深紺 (#33478e) カラー、Noto Serif JP |

### 3.3 V2パイプライン連携

**FR-008: V2パイプラインによる構成要件充足判定**

| 項目 | 内容 |
|------|------|
| 連携先 | ip-rich-poc-phase2 (https://iprich-phase2-api.vercel.app) |
| 認証 | Bearer token（INTERNAL_API_KEY） |
| パイプライン | Pipeline "C" |
| ポーリング | 10秒間隔、最大10分 |
| 取得データ | judgment（充足判定）, satisfaction_rate（充足率）, sales_oku_yen（売上推定・億円） |
| フォールバック | V2失敗時はスコアベースのランク判定 + GPT-5レポートで代替 |

**FR-009: V2ステータス確認**

| 項目 | 内容 |
|------|------|
| エンドポイント | `GET /api/v2-status` |
| 処理 | V2 APIの `/docs` エンドポイントにリクエストし、応答の有無で利用可否を判定 |
| 出力 | `{ v2Available: boolean }` |

### 3.4 V2簡易評価（直接V2呼出）

**FR-010: V2パイプラインによる簡易評価**

| 項目 | 内容 |
|------|------|
| エンドポイント | `POST /api/evaluate` |
| 入力 | patentId, email, name, pipeline(任意) |
| レスポンス | 202 Accepted（即時応答） |
| バックグラウンド処理 | V2 investigateAndRank → 簡易評価メール送信 |

### 3.5 メトリクス・監視

**FR-011: 運用メトリクス取得**

| 項目 | 内容 |
|------|------|
| エンドポイント | `GET /api/metrics` |
| 認証 | `X-Metrics-Key` ヘッダ |
| 出力 | リクエスト数、ブロック数、キャッシュヒット率、レイテンシP95、グローバル予算使用状況 |

---

## 4. 非機能要件

### 4.1 レート制限

**NFR-001: ユーザーレベルレート制限**

| 制限種別 | デフォルト値 | 環境変数 |
|---------|------------|---------|
| 1日あたりの診断回数 | 5回 | ANON_DAILY_QUOTA |
| 1分あたりの診断回数 | 3回 | PER_MIN_LIMIT |
| バースト検出間隔 | 15秒 | BURST_INTERVAL_MS |
| クールダウン時間 | 5分 | COOLDOWN_MS |
| メール送信回数（詳細レポート含む） | 3通/日 | （ハードコード） |

**NFR-002: グローバルレート制限**

| 制限種別 | デフォルト値 | 環境変数 |
|---------|------------|---------|
| 1時間あたりの上流API呼出 | 500回 | GLOBAL_HOUR_LIMIT |
| 1日あたりの上流API呼出 | 3,000回 | GLOBAL_DAY_LIMIT |
| 80%到達時のアラート | webhook通知 | ALERT_WEBHOOK_URL |

**NFR-003: CAPTCHA連動**

- バースト違反2回以上でCAPTCHA必須化（10分間）
- 1分3回制限超過時にもCAPTCHA必須化
- CAPTCHA通過で違反カウントを2減算

### 4.2 セキュリティ

**NFR-004: HTTPセキュリティヘッダ**

| ヘッダ | 値 |
|--------|-----|
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| X-Frame-Options | DENY |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |
| Content-Security-Policy | default-src 'self'; script-src 'self' https://challenges.cloudflare.com; ... |
| Strict-Transport-Security | max-age=31536000; includeSubDomains; preload (HTTPS時) |

**NFR-005: CORS**

- デフォルト許可オリジン: `https://ryoryoai.github.io`
- 環境変数 `ALLOWED_ORIGINS` でカンマ区切りで追加可能
- 同一オリジンリクエストは許可
- 信頼プロキシ経由の `X-Forwarded-For` / `X-Forwarded-Proto` を尊重

**NFR-006: 入力バリデーション**

| 対象 | 制限 |
|------|------|
| 診断クエリ | 最大200文字、制御文字禁止 |
| メールアドレス | 正規表現による形式チェック |
| リクエストボディ | 4KB〜32KB（エンドポイント別） |
| 特許番号 | 正規化処理（「特許第」「号」削除、数字抽出） |

**NFR-007: Edge WAF認証**

- 本番環境ではAPIエンドポイントに `X-Edge-Auth` ヘッダが必須
- `EDGE_SHARED_SECRET` が未設定の場合、起動時に警告
- 開発環境ではスキップ可能

**NFR-008: 秘匿情報管理**

- APIキー・トークンはすべて環境変数で管理
- `.env` ファイルは `.gitignore` に含まれる
- Vercel環境変数は `encrypted` タイプで保存
- ユーザーIDはSHA-256 HMACでハッシュ化してログに記録
- `_jpoRaw`（JPO APIの生レスポンス）はクライアントに返さない
- `internal_api_key` は `repr=False` でログ出力を抑制

### 4.3 パフォーマンス

**NFR-009: レスポンス時間**

| 処理 | 目標 |
|------|------|
| 簡易診断（キャッシュヒット） | < 100ms |
| 簡易診断（キャッシュミス） | < 4.5秒（REQUEST_TIMEOUT_MS） |
| 詳細レポート申請 | < 500ms（202 Accepted返却まで） |
| 詳細レポート生成（バックグラウンド） | 1〜3分（V2失敗時のフォールバック含む） |

**NFR-010: キャッシュ**

- 特許情報キャッシュ: 30日間（インメモリ）
- 同一クエリのin-flight dedup: 重複リクエストは同一Promiseを共有

**NFR-011: 監視・アラート**

- レイテンシP95が3秒超過時にwebhook通知（15分間隔）
- グローバル予算80%到達時にwebhook通知
- 全リクエストをJSON形式で構造化ログ出力

### 4.4 可用性

**NFR-012: フォールバック戦略**

| レイヤー | 正常系 | フォールバック |
|---------|--------|-------------|
| 特許情報取得 | JPO API | OpenAI LLM推定 → モックデータ |
| 構成要件充足判定 | V2パイプライン | スコアベースのランク判定 |
| 詳細レポート生成 | OpenAI API | カテゴリ別テンプレート出力 |
| メール送信 | Resend API | ログ出力（APIキー未設定時） |

---

## 5. 画面定義

### 5.1 メインページ (`index.html`)

- 特許番号 / キーワード入力フォーム
- 評価結果の表示（ランク、スコア、特許情報）
- メール送信フォーム
- 詳細レポート申請への導線
- サービス紹介セクション
- Cloudflare Turnstile CAPTCHA（必要時に表示）

### 5.2 詳細レポート申請ページ (`request-report.html`)

- 特許番号入力
- メールアドレス入力
- 氏名入力
- 申請ボタン → 202 Accepted → 完了メッセージ表示

### 5.3 プライバシーポリシー (`privacy.html`)

- 個人情報の取り扱い方針
- Cookie利用に関する説明

---

## 6. メールテンプレート定義

### 6.1 簡易評価結果メール

| 項目 | 内容 |
|------|------|
| 件名 | 【PatentRevenue】特許の簡易評価結果のお知らせ |
| ヘッダ | PatentRevenueロゴ、「知財を収益に変える」 |
| 本文 | 挨拶 → ランク表示（A〜D）→ ランク一覧表 → 次のステップ案内（特許登録CTA、詳細レポート申請CTA） |
| フッタ | プライバシーポリシーリンク、免責事項 |

### 6.2 詳細評価レポートメール

| 項目 | 内容 |
|------|------|
| 件名 | 【PatentRevenue】特許の詳細評価レポートのご送付 |
| ヘッダ | PatentRevenueロゴ |
| 本文 | 挨拶 → 総合スコア＋ランク表示 → ランク説明 → 4軸スコアバー → 特許情報 → 推定価値レンジ → レポート7項目 → 次のステップ（3段階の案内）→ ダッシュボードCTA |
| フッタ | 免責事項、プライバシーポリシーリンク |

---

## 7. 外部API仕様

### 7.1 JPO特許情報取得API

| 項目 | 内容 |
|------|------|
| ベースURL | https://ip-data.jpo.go.jp |
| 認証 | username/password → access_token (有効期限1時間、refresh token対応) |
| 取得データ | 出願番号、登録番号、発明名、出願人、出願日、登録日、経過情報 |
| タイムアウト | 10秒 |

### 7.2 OpenAI API

| 項目 | 内容 |
|------|------|
| モデル | GPT-5 (環境変数 `OPENAI_MODEL` で変更可能) |
| 用途 | 特許情報推定、詳細レポート生成 |
| レスポンス形式 | JSON mode (`response_format: { type: "json_object" }`) |
| タイムアウト | 30秒 |

### 7.3 Resend API

| 項目 | 内容 |
|------|------|
| エンドポイント | https://api.resend.com/emails |
| 認証 | Bearer token |
| 送信元 | noreply@patent-revenue.iprich.jp |
| タイムアウト | 10秒 |

### 7.4 V2パイプライン (ip-rich-poc-phase2)

| 項目 | 内容 |
|------|------|
| ベースURL | 環境変数 `V2_API_BASE` |
| 認証 | Bearer token (`V2_API_TOKEN` = phase2の `INTERNAL_API_KEY`) |
| 主要エンドポイント | POST /v1/analysis/start, GET /v1/analysis/{job_id}, GET /v1/analysis/{job_id}/results |
| ポーリング | 10秒間隔、10分タイムアウト |
| 取得結果 | Stage 14: 構成要件充足判定、Stage 24: 売上推定、Stage 13: 個別構成要件判定 |

### 7.5 Cloudflare Turnstile

| 項目 | 内容 |
|------|------|
| 検証URL | https://challenges.cloudflare.com/turnstile/v0/siteverify |
| タイムアウト | 3秒 |
| トリガー条件 | バースト違反2回以上、または1分3回制限超過 |

---

## 8. 環境変数一覧

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|-----------|------|
| PORT | - | 3000 | リッスンポート |
| NODE_ENV | - | development | 環境識別 |
| HASH_SECRET | 本番必須 | pvc-dev-secret | ユーザーID匿名化用HMAC秘密鍵 |
| METRICS_API_KEY | 本番必須 | dev-metrics-key | メトリクスAPI認証キー |
| EDGE_SHARED_SECRET | 本番必須 | (なし) | Edge WAF認証シークレット |
| ALLOWED_ORIGINS | - | https://ryoryoai.github.io | CORS許可オリジン（カンマ区切り） |
| TRUSTED_PROXIES | - | (なし) | 信頼するプロキシIPリスト |
| TURNSTILE_SITE_KEY | - | (なし) | Cloudflare Turnstile サイトキー |
| TURNSTILE_SECRET_KEY | - | (なし) | Cloudflare Turnstile シークレットキー |
| JPO_USERNAME | - | (なし) | JPO API認証ユーザー名 |
| JPO_PASSWORD | - | (なし) | JPO API認証パスワード |
| JPO_API_TIMEOUT_MS | - | 10000 | JPO APIタイムアウト |
| OPENAI_API_KEY | 必須 | (なし) | OpenAI APIキー |
| OPENAI_MODEL | - | gpt-5 | 使用モデル |
| LLM_TIMEOUT_MS | - | 30000 | LLMタイムアウト |
| RESEND_API_KEY | - | (なし) | Resend APIキー（未設定時はメール送信スキップ） |
| MAIL_FROM | - | noreply@patent-revenue.iprich.jp | 送信元メールアドレス |
| V2_API_BASE | - | http://localhost:8000 | V2パイプラインAPIベースURL |
| V2_API_TOKEN | - | (なし) | V2パイプライン認証トークン |
| V2_POLL_INTERVAL_MS | - | 10000 | V2ポーリング間隔 |
| V2_POLL_TIMEOUT_MS | - | 600000 | V2ポーリングタイムアウト |
| ANON_DAILY_QUOTA | - | 5 | ユーザー1日あたり診断回数 |
| BURST_INTERVAL_MS | - | 15000 | バースト検出間隔 |
| PER_MIN_LIMIT | - | 3 | 1分あたり診断回数上限 |
| COOLDOWN_MS | - | 300000 | クールダウン時間 |
| CAPTCHA_REQUIRED_TTL_MS | - | 600000 | CAPTCHA必須期間 |
| GLOBAL_DAY_LIMIT | - | 3000 | グローバル1日上限 |
| GLOBAL_HOUR_LIMIT | - | 500 | グローバル1時間上限 |
| CACHE_TTL_MS | - | 2592000000 | キャッシュ有効期間（30日） |
| REQUEST_TIMEOUT_MS | - | 4500 | 上流APIタイムアウト |
| BODY_LIMIT_BYTES | - | 4096 | リクエストボディ上限 |
| ALERT_WEBHOOK_URL | - | (なし) | アラートwebhook URL |

---

## 9. データフロー

### 9.1 簡易診断フロー

```
ユーザー入力 (特許番号/キーワード)
       ↓
  [入力バリデーション]
       ↓
  [ユーザーレート制限チェック]
       ├─ 超過 → 429 + CAPTCHA要求（条件付き）
       ↓
  [グローバル予算チェック]
       ├─ 超過 → 503
       ↓
  [キャッシュ確認]
       ├─ ヒット → 即座にレスポンス
       ↓
  [特許情報取得]
       ├─ JPO API (認証情報あり)
       ├─ OpenAI LLM推定 (JPO失敗時)
       └─ モックデータ (全失敗時)
       ↓
  [キャッシュ保存 (30日)]
       ↓
  レスポンス返却
```

### 9.2 詳細レポート申請フロー

```
ユーザー入力 (特許番号, メール, 氏名)
       ↓
  [メールレート制限チェック (3通/日)]
       ├─ 超過 → 429
       ↓
  202 Accepted（即座に返却）
       ↓ (バックグラウンド)
  [1. 特許情報取得]
       ↓
  [2. V2パイプライン (利用可能な場合)]
       ├─ 成功 → V2結果でランク判定
       └─ 失敗 → スコアベースでランク判定
       ↓
  [3. スコア算出 (4軸)]
       ↓
  [4. OpenAI 詳細レポート生成]
       ├─ 成功 → LLMレポート
       └─ 失敗 → テンプレートレポート
       ↓
  [5. Resend メール送信]
       ↓
  [6. ログ記録]
```

---

## 10. 既知の制限事項・課題

### 10.1 V2パイプライン

- **temperature問題**: phase2の `pipeline.py` でハードコードされた `temperature=0.0` が推論モデル（o4-mini系）でサポートされず、全件失敗する。スコアベースフォールバックで代替中
- **対応方針**: phase2側で推論モデル使用時にtemperatureパラメータを除外する修正が必要

### 10.2 インメモリストア

- レート制限・キャッシュはすべてインメモリ（`Map`）
- サーバー再起動で全データリセット
- 将来的にRedis等への移行が望ましい

### 10.3 ランク判定精度

- V2パイプライン未使用時のフォールバックランクは、特許メトリクス（引用数、請求項数等）からの推定であり、構成要件充足判定に基づくものではない
- DDシートのランク（S〜E）とシステムのランク（A〜D）のマッピングは未定義

---

## 11. CI/CD

### 11.1 GitHub Actions (ci.yml)

| ステップ | 内容 |
|---------|------|
| セットアップ | Node.js 20, npm ci |
| 構文チェック | `node --check server.js && node --check lib/*.js` |
| 脆弱性監査 | `npm audit --audit-level=high` (警告のみ) |
| スモークテスト | サーバー起動 → `curl http://localhost:3000/` → 200確認 |

### 11.2 トリガー

- `main` ブランチへの push
- `main` ブランチへの pull request

---

## 付録A: APIエンドポイント一覧

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| POST | /api/diagnose | CORS + Edge WAF | 簡易診断 |
| POST | /api/evaluate | CORS + Edge WAF | V2簡易評価（非同期） |
| GET | /api/v2-status | CORS + Edge WAF | V2ステータス確認 |
| POST | /api/request-detailed-report | CORS + Edge WAF | 詳細レポート申請（非同期） |
| POST | /api/detailed-report | CORS + Edge WAF | レポート生成（同期） |
| POST | /api/send-report | CORS + Edge WAF | 簡易評価メール送信 |
| POST | /api/send-detailed-report | CORS + Edge WAF | 詳細レポートメール送信 |
| GET | /api/metrics | X-Metrics-Key | メトリクス取得 |
| OPTIONS | /api/** | - | CORS preflight |

## 付録B: ロイヤルティ率テーブル

| カテゴリ | 範囲 |
|---------|------|
| 製造DX・AI | 1.2% - 4% |
| エネルギー・材料 | 1% - 3.5% |
| 医療機器・画像解析 | 1.5% - 5% |
| 通信・IoT | 1.2% - 4% |
| ソフトウェア | 1.5% - 5.5% |
