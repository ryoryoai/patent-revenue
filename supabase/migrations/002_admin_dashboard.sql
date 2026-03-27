-- ============================================================
-- 002_admin_dashboard.sql
-- 管理画面用スキーマ拡張
-- ============================================================

-- leads: admin_notes 追加 + ステータス拡張
ALTER TABLE leads ADD COLUMN IF NOT EXISTS admin_notes text;
COMMENT ON COLUMN leads.admin_notes IS '管理者メモ';

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
    CHECK (status IN ('created', 'submitted', 'emailed', 'detail_started', 'detail_submitted', 'contacted', 'converted', 'closed'));

-- detail_registrations: admin_notes 追加
ALTER TABLE detail_registrations ADD COLUMN IF NOT EXISTS admin_notes text;
COMMENT ON COLUMN detail_registrations.admin_notes IS '管理者メモ';

-- consultation_inquiries: admin_notes 追加
ALTER TABLE consultation_inquiries ADD COLUMN IF NOT EXISTS admin_notes text;
COMMENT ON COLUMN consultation_inquiries.admin_notes IS '管理者メモ';
