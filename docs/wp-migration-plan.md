# WordPress サイト移行計画

## 現行サイト: patent-revenue.iprich.jp
## 移行先: catalog.iprich.jp

作成日: 2026-03-25

---

## 1. 現行 WP サイト URL 一覧

### 固定ページ

| URL | ページ名 | 概要 |
|-----|---------|------|
| `/` | トップページ | メインビジュアル、収益化の3つの柱、メンバー紹介、導入の流れ、費用、FAQ、登録フォーム、問い合わせフォーム |
| `/patent/` | 特許一覧 | 検索・フィルター付き特許リスト（約70件、7ページ） |
| `/patent/[日本語タイトル]/` | 個別特許ページ | 特許詳細情報（URLエンコードされた日本語スラッグ） |
| `/%e8%a8%98%e4%ba%8b/` (= `/記事/`) | 記事一覧 | 知財の収益化に関する記事（50件以上） |
| `/news/` | 世界知財ニュース一覧 | トップページ内セクション用のニュース表示 |
| `/world-news/` | 世界知財ニュースアーカイブ | ニュース記事のアーカイブ（25件以上、4ページ） |
| `/world-news/[スラッグ]/` | 個別ニュース記事 | ニュース記事詳細 |
| `/recruite/` | 求人一覧 | 求人情報（現在1件） |
| `/privacy-policy/` | プライバシーポリシー | 個人情報の取扱いについて |
| `/terms/` | 利用規約 | サービス利用規約 |

### アンカーリンク（トップページ内セクション）

| アンカー | セクション名 |
|---------|------------|
| `/#licence` | 特許登録フォーム |
| `/#contact` | お問い合わせフォーム |
| `/#flow` | 導入の流れ |
| `/#price` | 費用について |

### 記事カテゴリ（確認済み）

- スタートアップ・中小企業向け
- 著作権
- 契約・法務
- 特許
- 知財戦略
- 専門家向け
- 一般向け

---

## 2. コンテンツ種別と件数

| 種別 | 件数（概算） | WP投稿タイプ（推定） |
|------|------------|-------------------|
| 特許 | 約70件 | カスタム投稿タイプ `patent` |
| 知財記事（ブログ） | 50件以上 | 投稿 `post` |
| 世界知財ニュース | 25件以上 | カスタム投稿タイプ `world-news` |
| 求人 | 1件 | カスタム投稿タイプまたは固定ページ |
| 固定ページ | 約5件 | 固定ページ `page` |

---

## 3. 新サイト（catalog.iprich.jp）ページ構成案

### コアページ

| 新URL | 内容 | 移行元 |
|-------|------|--------|
| `/` | トップ（特許プラットフォーム紹介 + 最新特許 + 検索導線） | `/` |
| `/patents` | 特許一覧 + 検索・フィルター | `/patent/` |
| `/patents/[slug]` | 個別特許ページ（英数字slugに変換） | `/patent/[日本語タイトル]/` |
| `/technology/[category]` | 技術カテゴリ別特許一覧 | 新規（WPの技術カテゴリを再編） |
| `/blog` | ブログ記事一覧 | `/%e8%a8%98%e4%ba%8b/` |
| `/blog/[slug]` | 個別ブログ記事 | 記事個別ページ |
| `/news` | 世界知財ニュース一覧 | `/news/`, `/world-news/` |
| `/news/[slug]` | 個別ニュース記事 | `/world-news/[スラッグ]/` |
| `/about` | PatentRevenueについて（メンバー紹介、導入の流れ、費用） | `/` 内セクション |
| `/contact` | お問い合わせフォーム | `/#contact` |
| `/register` | 特許登録フォーム | `/#licence` |
| `/terms` | 利用規約 | `/terms/` |
| `/privacy` | プライバシーポリシー | `/privacy-policy/` |

### SEO・機械読み取り用

| URL | 内容 |
|-----|------|
| `/llms.txt` | LLM向けサイト説明（特許プラットフォームの構造化情報） |
| `/sitemap.xml` | XMLサイトマップ（自動生成） |
| `/robots.txt` | クローラー制御 |

### 技術カテゴリ案（`/technology/[category]`）

WPサイトの検索フィルターを元に以下を設定:

| slug | カテゴリ名 |
|------|----------|
| `ai` | AI・人工知能 |
| `it` | 情報技術 |
| `mechanical` | 機械工学 |
| `chemistry` | 化学・材料 |
| `electronics` | 電気・電子 |
| `energy` | エネルギー |
| `medical` | 医療・バイオ |
| `other` | その他 |

---

## 4. 301リダイレクトマッピング

### 固定ページ

| 旧URL | 新URL | 備考 |
|-------|-------|------|
| `patent-revenue.iprich.jp/` | `catalog.iprich.jp/` | トップページ |
| `patent-revenue.iprich.jp/patent/` | `catalog.iprich.jp/patents` | 一覧ページ |
| `patent-revenue.iprich.jp/patent/[日本語slug]/` | `catalog.iprich.jp/patents/[英数字slug]` | 個別特許（slugマッピングテーブル別途作成要） |
| `patent-revenue.iprich.jp/%e8%a8%98%e4%ba%8b/` | `catalog.iprich.jp/blog` | 記事一覧 |
| `patent-revenue.iprich.jp/news/` | `catalog.iprich.jp/news` | ニュース一覧 |
| `patent-revenue.iprich.jp/world-news/` | `catalog.iprich.jp/news` | ニュースアーカイブ |
| `patent-revenue.iprich.jp/world-news/[slug]/` | `catalog.iprich.jp/news/[slug]` | 個別ニュース |
| `patent-revenue.iprich.jp/privacy-policy/` | `catalog.iprich.jp/privacy` | プライバシーポリシー |
| `patent-revenue.iprich.jp/terms/` | `catalog.iprich.jp/terms` | 利用規約 |
| `patent-revenue.iprich.jp/recruite/` | `catalog.iprich.jp/about` | 求人 → aboutに統合 |

### アンカーリンク

| 旧URL | 新URL |
|-------|-------|
| `patent-revenue.iprich.jp/#licence` | `catalog.iprich.jp/register` |
| `patent-revenue.iprich.jp/#contact` | `catalog.iprich.jp/contact` |
| `patent-revenue.iprich.jp/#flow` | `catalog.iprich.jp/about#flow` |
| `patent-revenue.iprich.jp/#price` | `catalog.iprich.jp/about#pricing` |

### ページネーション

| 旧URL | 新URL |
|-------|-------|
| `patent-revenue.iprich.jp/patent/?paged=N` | `catalog.iprich.jp/patents?page=N` |
| `patent-revenue.iprich.jp/world-news/page/N/` | `catalog.iprich.jp/news?page=N` |

---

## 5. 移行対象コンテンツと優先度

### 優先度: 高（Phase 1）

| コンテンツ | 理由 |
|-----------|------|
| 特許データ（約70件） | コアコンテンツ。API経由で構造化データとして移行 |
| 特許一覧・検索機能 | 主要ユースケース |
| 特許登録フォーム | リード獲得の主要導線 |
| お問い合わせフォーム | 必須コミュニケーション手段 |
| プライバシーポリシー / 利用規約 | 法的に必要 |

### 優先度: 中（Phase 2）

| コンテンツ | 理由 |
|-----------|------|
| ブログ記事（50件以上） | SEO資産。コンテンツマーケティングの基盤 |
| 世界知財ニュース（25件以上） | SEO資産。定期更新コンテンツ |
| メンバー紹介 | 信頼性の担保 |
| 導入の流れ / 費用説明 | コンバージョン支援 |

### 優先度: 低（Phase 3 / 削除検討）

| コンテンツ | 理由 |
|-----------|------|
| 求人ページ | 掲載期限切れ（2025年12月31日）。別途採用サイトで対応可 |
| WP管理画面・テーマ資産 | 移行不要 |
| wp-content/uploads 画像 | 必要な画像のみ移行、不要なWPメディアは削除 |

---

## 6. 移行不要（削除可）なコンテンツ

| コンテンツ | 理由 |
|-----------|------|
| `/recruite/` 求人ページ | 掲載終了済み。新サイトでは不要 |
| `/wp-admin/` 管理画面 | WP固有 |
| `/wp-content/` テーマ・プラグインファイル | Next.jsで再構築 |
| `/wp-includes/` WordPressコアファイル | 不要 |
| WP固有のフィード (`/feed/`, `/comments/feed/`) | 新サイトで別途RSS生成 |
| ページネーション用URL (`/page/N/`) | クエリパラメータ方式に変更 |

---

## 7. 移行時の注意事項

### slug変換

現行WPサイトでは特許ページのスラッグが日本語URLエンコード（例: `%e3%83%88%e3%82%a4%e3%83%ac%e3%82%ac%e3%83%bc%e3%83%89`）になっている。新サイトでは:

- 特許番号ベースのslug（例: `JP-2024-123456`）または
- 英語の短縮スラッグ（例: `toilet-guard`）

に変換し、旧URLからの301リダイレクトを設定する。

### フォーム移行

- WP Contact Form 7（推定）からの移行
- 特許登録フォームの必須フィールドを新サイトのCRMに対応させる
- お問い合わせフォームはシンプル化可能

### 画像移行

- メンバー写真、ロゴは手動で移行
- 記事内の画像はWPエクスポートから一括取得
- 新サイトではCDN配信（Vercel Image Optimization等）

### SEO考慮

- Google Search Consoleでのサイト変更通知
- 301リダイレクトを最低1年間維持
- canonical URLの設定
- 構造化データ（JSON-LD）の実装
