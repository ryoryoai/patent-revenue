-- 003_leads_user_inputs.sql
-- ユーザーのオプション入力（実施状況・売上レンジ・寄与度）と同意記録を保存

ALTER TABLE leads ADD COLUMN IF NOT EXISTS use_status text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sales_range text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contribution text;

COMMENT ON COLUMN leads.use_status IS 'ユーザー入力: 実施状況 (using/planned/not_using)';
COMMENT ON COLUMN leads.sales_range IS 'ユーザー入力: 年間売上レンジ (under_100m/100m_1b/1b_10b/10b_100b/over_100b)';
COMMENT ON COLUMN leads.contribution IS 'ユーザー入力: 特許寄与度 (0.05-1.00)';

-- 詳細登録に同意記録と経過時間を追加
ALTER TABLE detail_registrations ADD COLUMN IF NOT EXISTS catalog_publish_agreed boolean;
ALTER TABLE detail_registrations ADD COLUMN IF NOT EXISTS privacy_agreed boolean;
ALTER TABLE detail_registrations ADD COLUMN IF NOT EXISTS diagnosis_to_application_seconds integer;

COMMENT ON COLUMN detail_registrations.catalog_publish_agreed IS 'カタログ公開同意チェック';
COMMENT ON COLUMN detail_registrations.privacy_agreed IS 'プライバシーポリシー同意チェック';
COMMENT ON COLUMN detail_registrations.diagnosis_to_application_seconds IS '診断結果表示から申請までの経過秒数';
