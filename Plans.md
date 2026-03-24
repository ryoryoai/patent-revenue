# Plans.md

## Project: Patent Value Checker MVP + 特許カタログサイト

---

## アーキテクチャ概要

| リポジトリ | 責務 | 技術 | ドメイン |
|-----------|------|------|---------|
| patent-revenue | 獲得LP（簡易診断） | Vanilla + Node.js + Vercel | patent-value-checker.iprich.jp |
| patent-catalog (新規) | 特許カタログ（公開+管理） | Next.js + Tailwind + Supabase + Vercel | MVP: catalog.iprich.jp |
| ip-rich-phase2 | 分析エンジン | FastAPI + Python | 既存 |

## ユーザーフロー（パターンA確定）

```
LP: 名前+企業名+メール+特許番号 → 調査 → 結果表示+メール送信
  → 詳細登録（トークンURL、プリフィル済み）
  → 社内審査 → カタログ公開
```

---

## Phase 0: データモデル・設計確定 `cc:TODO`

- [ ] Supabaseプロジェクト作成（or 既存phase2プロジェクト共有確認） `cc:TODO`
- [ ] テーブル設計確定 `cc:TODO`
  - leads（顧客リスト）
  - patents（特許元データ）
  - detail_registrations（詳細登録）
  - detail_registration_tokens（トークン管理）
  - patent_catalog_entries（公開用編集データ）
  - consultation_inquiries（コンサル問い合わせ）
- [ ] RLS（Row Level Security）方針確定 `cc:TODO`
- [ ] ステータスフロー確定 `cc:TODO`
  - lead_created → research_completed → registration_pending
  - → catalog_draft → catalog_review → catalog_published
- [ ] WP棚卸し（移行対象コンテンツ・URL一覧） `cc:TODO`

## Phase 1: LP（patent-revenue）にSupabase導入 `cc:TODO`

- [ ] Supabase JS client導入（server-side only） `cc:TODO`
- [ ] フォーム改修: 4項目必須化（名前、企業名、メール、特許番号） `cc:TODO`
- [ ] LP訴求文言変更（「個人情報不要」→「特許番号だけで診断スタート」は不使用、4項目入力を前提に） `cc:TODO`
- [ ] leads + patents テーブルへの保存実装 `cc:TODO`
- [ ] 詳細登録トークン発行 + メール送信 `cc:TODO`
- [ ] 詳細登録ページ実装（プリフィル + 追加項目 + 目的別分岐） `cc:TODO`
- [ ] detail_registrations テーブルへの保存 `cc:TODO`
- [ ] Vercelデプロイ: patent-value-checker.iprich.jp `cc:TODO`

## Phase 2: 特許カタログサイト（patent-catalog）MVP `cc:TODO`

- [ ] Next.js App Router プロジェクト作成 `cc:TODO`
- [ ] Supabase接続（同一プロジェクト） `cc:TODO`
- [ ] 公開面 `cc:TODO`
  - /patents（一覧+検索、Postgres FTS）
  - /patents/[slug]（個別特許ページ、ISR）
  - /technology/[category]（カテゴリ別一覧）
  - /contact（問い合わせフォーム）
- [ ] 管理面（スタッフ専用） `cc:TODO`
  - Supabase Auth（Google OAuth制限）
  - 公開/非公開切替、ステータス管理
  - SEO文言編集（タイトル、説明文、slug）
- [ ] SEO基盤 `cc:TODO`
  - sitemap.xml / robots.txt
  - JSON-LD（WebPage + BreadcrumbList + Organization）
  - OGP / Twitter Card / canonical
  - メタタグ（title / description）
- [ ] AIO基盤 `cc:TODO`
  - llms.txt
  - 特許詳細ページの情報構造統一（概要→用途→業界→差別化→権利状況→問い合わせ）
- [ ] Vercelデプロイ: catalog.iprich.jp `cc:TODO`

## Phase 3: ip-rich-phase2連携 `cc:TODO`

- [ ] patents テーブルから侵害調査リストとしてphase2へ連携 `cc:TODO`
- [ ] 非同期評価API（POST /api/evaluation-jobs） `cc:TODO`
- [ ] 評価結果のカタログ反映 `cc:TODO`

## Phase 4: WP移行 `cc:TODO`

- [ ] ブログ記事移行（MDX or DB管理） `cc:TODO`
- [ ] URL/slug/301リダイレクト設計 `cc:TODO`
- [ ] patent-revenue.iprich.jp をカタログサイトへ統合 `cc:TODO`

## Phase 5: 改善 `cc:TODO`

- [ ] UI/UXブラッシュアップ `cc:TODO`
- [ ] Core Web Vitals最適化 `cc:TODO`
- [ ] 検索エンジン追加（Meilisearch/Typesense）※必要時 `cc:TODO`
- [ ] 企業別ページ（/company/[assignee]）`cc:TODO`
