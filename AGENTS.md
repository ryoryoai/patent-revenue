# AGENTS.md

## Patent Value Checker + Patent Catalog

### 開発フロー（Solo モード）

1. `/plan-with-agent` — 新タスクの計画作成
2. `/work` — Plans.md のタスクを実行
3. `/review` — コードレビュー
4. `/verify` — ビルド・テスト検証
5. `/sync-status` — 進捗確認

### プロジェクト構成

| リポジトリ | 役割 | 技術 |
|-----------|------|------|
| patent-revenue（このリポ） | 簡易診断LP | Vanilla + Node.js + Vercel |
| patent-catalog | 特許カタログ | Next.js + Supabase + Vercel |
| ip-rich-phase2 | 分析エンジン | FastAPI + Python |

### コマンド

```bash
npm start          # 開発サーバー起動
node server.js     # サーバー直接起動
```

### 環境変数

`.env` を参照（`.env.example` にテンプレートあり）
