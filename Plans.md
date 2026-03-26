# Plans.md

## Project: Patent Value Analyzer MVP + 特許カタログサイト

---

## アーキテクチャ概要

| リポジトリ | 責務 | 技術 | ドメイン |
|-----------|------|------|---------|
| patent-revenue | 獲得LP（簡易診断） | Vanilla + Node.js + Vercel | patent-value-analyzer.iprich.jp |
| patent-catalog (新規) | 特許カタログ（公開+管理） | Next.js + Tailwind + Supabase + Vercel | MVP: catalog.iprich.jp |
| ip-rich-phase2 | 分析エンジン | FastAPI + Python | 既存 |

## ユーザーフロー（パターンA確定）

```
LP: 名前+企業名+メール+特許番号 → 調査 → 結果表示+メール送信
  → 詳細登録（トークンURL、プリフィル済み）
  → 社内審査 → カタログ公開
```

---

## Phase 0: データモデル・設計確定 `cc:完了`

- [x] Supabaseテーブル設計確定（6テーブル+RLS+インデックス） `cc:完了`
- [x] ステータスフロー確定 `cc:完了`
- [x] WP棚卸し（docs/wp-migration-plan.md） `cc:完了`

## Phase 1: LP（patent-revenue）にSupabase導入 `cc:完了`

- [x] Supabase JS client導入（lib/supabase.js） `cc:完了`
- [x] フォーム改修: 4項目必須化（名前、企業名、メール、特許番号） `cc:完了`
- [x] LP訴求文言変更 `cc:完了`
- [x] leads + patents テーブルへの保存実装 `cc:完了`
- [x] 詳細登録トークン発行 + メール送信 `cc:完了`
- [x] 詳細登録ページ実装（プリフィル + 追加項目 + 目的別分岐） `cc:完了`
- [x] detail_registrations テーブルへの保存 `cc:完了`
- [x] Codexレビュー: トークンimportバグ修正済み `cc:完了`
- [ ] Vercelデプロイ: patent-value-analyzer.iprich.jp `cc:TODO`

## Phase 2: 特許カタログサイト（patent-catalog）MVP `cc:完了`

- [x] Next.js App Router プロジェクト作成 `cc:完了`
- [x] Supabase接続（同一プロジェクト） `cc:完了`
- [x] 公開面（/patents, /patents/[slug], /technology/[category], /contact） `cc:完了`
- [x] 管理面（ログイン、ダッシュボード、エントリ管理、問い合わせ管理、特許→カタログ変換） `cc:完了`
- [x] SEO基盤（sitemap, robots, JSON-LD, OGP, canonical） `cc:完了`
- [x] AIO基盤（llms.txt, 情報構造統一） `cc:完了`
- [x] Codexレビュー: admin認証バイパス+JSON-LD XSS修正済み `cc:完了`
- [ ] Vercelデプロイ: catalog.iprich.jp `cc:TODO`

## Phase 3: ip-rich-phase2連携 `cc:完了`

- [x] patents テーブルからエクスポート（GET/POST /api/admin/export-patents） `cc:完了`
- [x] 分析結果同期（POST /api/admin/sync-analysis） `cc:完了`
- [x] 管理用特許一覧API（GET /api/admin/patents） `cc:完了`

## Phase 4: WP移行 `cc:完了`

- [x] ブログページ実装（Supabase wp_imported_contents連携） `cc:完了`
- [x] 301リダイレクト設定（next.config.ts） `cc:完了`
- [x] 静的ページ（about, privacy, terms） `cc:完了`
- [x] ナビゲーション更新 `cc:完了`
- [ ] patent-revenue.iprich.jp をカタログサイトへ統合 `cc:TODO`（WP停止後）

## Phase 5: 改善 `cc:完了`

- [x] SEO/AIO強化（メタデータ、JSON-LD拡張、情報構造最適化） `cc:完了`
- [x] Core Web Vitals最適化（フォントpreload、画像avif/webp、CSS最適化） `cc:完了`
- [ ] 検索エンジン追加（Meilisearch/Typesense）※必要時 `cc:TODO`
- [ ] 企業別ページ（/company/[assignee]）`cc:TODO`

## Codexレビュー指摘・修正履歴

| # | 指摘 | 重要度 | 修正 |
|---|------|--------|------|
| 1 | /admin直下が未認証でアクセス可能 | 重大 | matcher修正+二重防御追加 |
| 2 | JSON-LD出力のStored XSS | 重大 | safeJsonLdStringify導入 |
| 3 | detail-registration.jsのSupabase import名不一致 | 重大 | getSupabaseClient→getSupabase修正 |
