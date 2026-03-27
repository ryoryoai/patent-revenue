-- ============================================================
-- 005_leads_traffic_source.sql
-- leads テーブルに流入元情報カラムを追加
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_data jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS landing_page text;

COMMENT ON COLUMN leads.referrer IS 'HTTP Referer (流入元URL)';
COMMENT ON COLUMN leads.utm_data IS 'UTMパラメータ (utm_source, utm_medium, utm_campaign等)';
COMMENT ON COLUMN leads.landing_page IS 'ランディングページパス';
