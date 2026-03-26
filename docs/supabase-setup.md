# Supabase セットアップ手順

## 概要

patent-revenue / patent-catalog / ip-rich-poc-phase2 の3プロジェクトは **同一の Supabase プロジェクト** を共有します。

| 項目 | 値 |
|------|-----|
| プロジェクト ID | `fnqenhcpdmhzndefbvnw` |
| プロジェクト URL | `https://fnqenhcpdmhzndefbvnw.supabase.co` |
| リージョン | ap-southeast-2 (AWS Sydney) |
| スキーマ構成 | `public`（patent-revenue / patent-catalog）、`phase2`（ip-rich-poc-phase2） |

スキーマが分離されているため、テーブル名の競合はありません。

---

## スキーマ構成

```
public スキーマ（patent-revenue / patent-catalog 共用）
├── leads                      顧客リード
├── patents                    特許元データ
├── detail_registration_tokens 詳細登録用トークン
├── detail_registrations       詳細登録情報
├── patent_catalog_entries     公開カタログ
└── consultation_inquiries     問い合わせ

phase2 スキーマ（ip-rich-poc-phase2 専用）
└── （既存テーブル群）
```

---

## マイグレーション実行方法

### 方法 A: Supabase CLI（推奨）

#### 1. CLI インストール確認

```bash
supabase --version
# インストールされていない場合:
brew install supabase/tap/supabase
```

#### 2. リモートプロジェクトにリンク

```bash
cd /Users/ryohei/projects/patent-revenue

supabase link --project-ref fnqenhcpdmhzndefbvnw
# プロンプトでデータベースパスワードを入力
```

#### 3. マイグレーション実行

```bash
# 現在の状態を確認
supabase db diff --linked

# リモートにマイグレーション適用
supabase db push
```

#### 4. 適用確認

```bash
supabase migration list --linked
```

---

### 方法 B: Supabase Studio での手動 SQL 実行

1. ブラウザで [Supabase Studio](https://supabase.com/dashboard/project/fnqenhcpdmhzndefbvnw) を開く
2. 左メニューから「SQL Editor」を選択
3. 「New query」をクリック
4. `/Users/ryohei/projects/patent-revenue/supabase/migrations/001_initial_schema.sql` の内容をコピー&ペースト
5. 「Run」ボタンをクリック

---

### 方法 C: psql 直接実行

```bash
# 接続情報
PGPASSWORD='<DBパスワード>' psql \
  "postgresql://postgres.fnqenhcpdmhzndefbvnw@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres" \
  -f /Users/ryohei/projects/patent-revenue/supabase/migrations/001_initial_schema.sql
```

---

## 環境変数の設定

### patent-revenue (.env)

```bash
# 設定済み（.envに追記済み）
SUPABASE_URL=https://fnqenhcpdmhzndefbvnw.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

### patent-catalog (.env.local)

```bash
# 設定済み（.env.localに追記済み）
NEXT_PUBLIC_SUPABASE_URL=https://fnqenhcpdmhzndefbvnw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

---

## テスト接続の確認方法

### Node.js（patent-revenue）

```bash
cd /Users/ryohei/projects/patent-revenue

node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

supabase.from('leads').select('count').then(({ data, error }) => {
  if (error) console.error('接続失敗:', error.message);
  else console.log('接続成功:', data);
});
"
```

### Next.js（patent-catalog）

```bash
cd /Users/ryohei/projects/patent-catalog

node -e "
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

supabase.from('patent_catalog_entries')
  .select('count')
  .eq('catalog_status', 'published')
  .then(({ data, error }) => {
    if (error) console.error('接続失敗:', error.message);
    else console.log('接続成功:', data);
  });
"
```

---

## マイグレーション適用済みテーブルの確認

Supabase Studio の「Table Editor」で以下のテーブルが存在することを確認：

- [ ] leads
- [ ] patents
- [ ] detail_registration_tokens
- [ ] detail_registrations
- [ ] patent_catalog_entries
- [ ] consultation_inquiries

---

## トラブルシューティング

### テーブルが既に存在する場合

`001_initial_schema.sql` はすべて `CREATE TABLE IF NOT EXISTS` を使用しているため、
既存テーブルがあっても安全に実行できます。

### RLS ポリシーのエラー

既存のポリシーと名前が衝突する場合は、`CREATE POLICY` の前に以下を追加：

```sql
DROP POLICY IF EXISTS <policy_name> ON <table_name>;
```

### Supabase CLI のバージョンエラー

```bash
brew upgrade supabase
```
