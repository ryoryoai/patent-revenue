# Patterns

## P1: Supabaseフォールバック
- LP側はSupabase未接続でも動作する設計
- console.warnのみでフォールバック

## P2: トークンベースのプリフィル
- 詳細登録はワンタイムトークンURL
- SHA-256ハッシュでDB保存、24時間有効

## P3: Codexレビュー→修正フロー
- 実装完了後にCodex GPT-5.4でレビュー
- 重大な指摘は即修正してコミット
