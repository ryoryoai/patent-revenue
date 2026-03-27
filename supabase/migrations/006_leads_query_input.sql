-- ============================================================
-- 006_leads_query_input.sql
-- leads テーブルにフォーム入力値カラムを追加
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS query_input text;

COMMENT ON COLUMN leads.query_input IS 'ユーザーが特許番号フィールドに入力した生の値';
