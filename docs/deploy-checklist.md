# Vercelデプロイチェックリスト

## 環境変数（Vercel Dashboard で設定）

### 必須
- [ ] `OPENAI_API_KEY` — GPT-5 による特許評価
- [ ] `RESEND_API_KEY` — メール送信（Resend）
- [ ] `TURNSTILE_SITE_KEY` — Cloudflare Turnstile（フロントエンド用）
- [ ] `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile（サーバー検証用）
- [ ] `SUPABASE_URL` — Supabase プロジェクト URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Supabase サービスロールキー
- [ ] `HASH_SECRET` — セッションハッシュ用シークレット
- [ ] `EDGE_SHARED_SECRET` — エッジ・サーバー間の共有シークレット
- [ ] `METRICS_API_KEY` — メトリクス API キー
- [ ] `SITE_HOST=patent-value-checker.iprich.jp` — 詳細登録URLのホスト名
- [ ] `NODE_ENV=production`

### 任意
- [ ] `JPO_USERNAME` — J-PlatPat API ユーザー名
- [ ] `JPO_PASSWORD` — J-PlatPat API パスワード
- [ ] `OPENAI_MODEL` — 使用モデル（デフォルト: gpt-5）
- [ ] `MAIL_FROM` — 送信元メールアドレス（デフォルト: noreply@patent-revenue.iprich.jp）
- [ ] `ALLOWED_ORIGINS` — 許可するオリジン（デフォルト: https://ryoryoai.github.io）
- [ ] `V2_API_BASE` — V2パイプラインのベースURL
- [ ] `V2_API_TOKEN` — V2パイプライン認証トークン
- [ ] `ALERT_WEBHOOK_URL` — アラート通知Webhook URL

## デプロイコマンド

```bash
# Vercel CLI でデプロイ（推奨）
cd /Users/ryohei/projects/patent-revenue
vercel --prod

# または git push でデプロイ
git push origin main
```

## プロジェクト情報

- projectId: `prj_WiWML7AAa4W4yCmK6Nr6e7u3hJTh`
- orgId: `team_rpUvDujPujo91hZdZv1VwBhD`
- projectName: `patent-revenue`

## ルーティング構成

`vercel.json` のrewriteルール `"/(.*)" → "/api"` により、すべてのリクエストが
`api/index.js` → `server.js` の handler へ転送されます。

静的ファイル配信は server.js 内の `sendFile()` ロジックが担当します：
- `GET /` → `public/index.html`
- `GET /detail-registration.html` → `public/detail-registration.html`
- `GET /privacy.html` → `public/privacy.html`
- `GET /request-report.html` → `public/request-report.html`
- `GET /styles.css` → `public/styles.css`
- `GET /app.js` → `public/app.js`

## デプロイ後の確認事項

- [ ] トップページが表示される（`https://patent-value-checker.iprich.jp/`）
- [ ] 4項目フォーム（特許番号・氏名・メール・電話）が表示される
- [ ] 診断が実行できる（特許番号入力 → 評価結果表示）
- [ ] メール送信される（診断結果メールが届く）
- [ ] 詳細登録ページが表示される（`/detail-registration.html?t=...`）
- [ ] プライバシーポリシーページが表示される（`/privacy.html`）
- [ ] レポート申請ページが表示される（`/request-report.html`）

## 構文チェック結果（デプロイ前確認済み）

| ファイル | 状態 |
|---------|------|
| server.js | OK |
| lib/supabase.js | OK |
| lib/detail-registration.js | OK |
| lib/v2-client.js | OK |
| lib/mailer.js | OK |
| lib/patent-api.js | OK |
| lib/patent-research.js | OK |
| lib/env.js | OK |
| lib/http-utils.js | OK |
| lib/llm.js | OK |
| lib/patent-data.js | OK |
| lib/pdf-report.js | OK |
| lib/result-store.js | OK |
