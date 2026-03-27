# ブランド仕様書

## ブランド定義

| 項目 | 値 |
|------|----|
| サービス名 | Patent Value Analyzer |
| サービス名（日本語） | 特許収益化の可能性を無料評価 |
| ブランド名 | PatentRevenue |
| 会社名 | 株式会社IPリッチ |
| 会社名（英語） | IP Rich Co., Ltd. |
| タグライン | 特許を収益に変える |
| メインドメイン | iprich.jp |
| サービスドメイン | patent-value-analyzer.iprich.jp |
| ランディングドメイン | patent-revenue.iprich.jp |

## 使用ルール

- **設定ファイル**: `lib/brand-config.js` で一元管理（Single Source of Truth）
- **ハードコード禁止**: サービス名・会社名・ドメインをコード中に直接記述しない
- **名前変更時**: `lib/brand-config.js` のみを更新する（他ファイルの変更は不要）

### 参照方法（Node.js）

```js
const brand = require('./lib/brand-config');

// 例
brand.siteName        // 'Patent Value Analyzer'
brand.companyName     // '株式会社IPリッチ'
brand.tagline         // '特許を収益に変える'
brand.domain          // 'iprich.jp'
brand.serviceDomain   // 'patent-value-analyzer.iprich.jp'
```

## 連絡先

| 用途 | メールアドレス |
|------|--------------|
| プライバシー・個人情報 | privacy@iprich.jp |
| サポート | support@iprich.jp |

## 法務ページ

| ページ | URL |
|--------|-----|
| プライバシーポリシー | /privacy.html |
| 利用規約 | /terms.html |
| 特許リスト | /patent-list.html |
