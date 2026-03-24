-- ============================================================
-- 001_initial_schema.sql
-- patent-revenue / patent-catalog / ip-rich-phase2 共有DB
-- ============================================================

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Tables
-- ============================================================

-- ----------------------------------------------------------
-- 1. leads（顧客リスト）
-- LP簡易調査フォームからの入力
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text        NOT NULL,
    company_name text        NOT NULL,
    email        text        NOT NULL,
    status       text        NOT NULL DEFAULT 'created'
                                CHECK (status IN ('created', 'emailed', 'detail_started', 'detail_submitted')),
    source       text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  leads IS 'LP簡易調査フォームからの顧客リード';
COMMENT ON COLUMN leads.status IS 'created / emailed / detail_started / detail_submitted';
COMMENT ON COLUMN leads.source IS '流入元（utm_source等）';

-- ----------------------------------------------------------
-- 2. patents（特許元データ）
-- JPO API + LLM から取得した特許データ
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS patents (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id             uuid        REFERENCES leads (id) ON DELETE SET NULL,
    patent_number       text        NOT NULL,
    normalized_number   text,
    title               text,
    applicant           text,
    applicant_type      text
                            CHECK (applicant_type IN ('企業', '大学', '個人', NULL)),
    filing_date         date,
    registration_date   date,
    expire_date         date,
    status              text
                            CHECK (status IN ('登録', '消滅', '出願中', NULL)),
    category            text,
    ipc_codes           text[],
    metrics             jsonb,
    jpo_raw             jsonb,
    llm_summary         jsonb,
    diagnosis_result    jsonb,
    source              text
                            CHECK (source IN ('jpo-api', 'llm', 'mock', NULL)),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  patents IS 'JPO API + LLM から取得した特許元データ';
COMMENT ON COLUMN patents.metrics         IS 'citations, claimCount, familySize 等の定量指標';
COMMENT ON COLUMN patents.jpo_raw         IS 'JPO API レスポンス生データ';
COMMENT ON COLUMN patents.llm_summary     IS 'LLM生成の概要・強み・分野';
COMMENT ON COLUMN patents.diagnosis_result IS '2層評価結果（スコア、価値レンジ、ランク等）';

-- ----------------------------------------------------------
-- 3. detail_registration_tokens（詳細登録用トークン）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS detail_registration_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id    uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    token_hash text        NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  detail_registration_tokens IS '詳細登録フォームへの認証トークン管理';
COMMENT ON COLUMN detail_registration_tokens.token_hash IS 'SHA-256 等でハッシュ化されたトークン';

-- ----------------------------------------------------------
-- 4. detail_registrations（詳細登録）
-- 売却・ライセンスプラットフォーム登録情報
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS detail_registrations (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id                 uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    patent_id               uuid        REFERENCES patents (id) ON DELETE SET NULL,
    type                    text        CHECK (type IN ('listing', 'consulting')),
    department              text,
    contact_name            text,
    phone                   text,
    desired_price           text,
    support_method          text        CHECK (support_method IN ('ライセンス', '売却', '両方', NULL)),
    tech_support_available  boolean,
    infringement_exists     boolean,
    business_sale_desired   boolean,
    message                 text,
    status                  text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'reviewed', 'contacted', 'converted', 'closed')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  detail_registrations IS '特許の売却・ライセンス登録詳細情報';
COMMENT ON COLUMN detail_registrations.type           IS 'listing（登録）/ consulting（相談）';
COMMENT ON COLUMN detail_registrations.support_method IS 'ライセンス / 売却 / 両方';
COMMENT ON COLUMN detail_registrations.status         IS 'pending / reviewed / contacted / converted / closed';

-- ----------------------------------------------------------
-- 5. patent_catalog_entries（公開用カタログデータ）
-- SEO向けに編集した公開表現（patents とは別管理）
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS patent_catalog_entries (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    patent_id           uuid        NOT NULL UNIQUE REFERENCES patents (id) ON DELETE CASCADE,
    slug                text        NOT NULL UNIQUE,
    display_title       text,
    display_summary     text,
    usecases            text[],
    target_industries   text[],
    differentiation     text,
    rights_status_text  text,
    seo_title           text,
    seo_description     text,
    og_image_url        text,
    is_featured         boolean     NOT NULL DEFAULT false,
    catalog_status      text        NOT NULL DEFAULT 'draft'
                            CHECK (catalog_status IN ('draft', 'review', 'published', 'hidden', 'archived')),
    published_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  patent_catalog_entries IS 'SEO向け公開カタログデータ（patent-catalogサイト用）';
COMMENT ON COLUMN patent_catalog_entries.slug           IS 'URL用スラッグ（英数字+ハイフン）';
COMMENT ON COLUMN patent_catalog_entries.catalog_status IS 'draft / review / published / hidden / archived';

-- ----------------------------------------------------------
-- 6. consultation_inquiries（カタログ経由の問い合わせ）
-- 買い手・ライセンシー候補からの問い合わせ
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultation_inquiries (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_entry_id  uuid        REFERENCES patent_catalog_entries (id) ON DELETE SET NULL,
    name              text        NOT NULL,
    company_name      text,
    email             text        NOT NULL,
    phone             text,
    message           text        NOT NULL,
    inquiry_type      text        NOT NULL DEFAULT 'other'
                          CHECK (inquiry_type IN ('license', 'purchase', 'consultation', 'other')),
    status            text        NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new', 'replied', 'closed')),
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  consultation_inquiries IS 'カタログ経由の買い手・ライセンシー候補からの問い合わせ';
COMMENT ON COLUMN consultation_inquiries.catalog_entry_id IS 'NULL の場合はカタログ外からの問い合わせ';
COMMENT ON COLUMN consultation_inquiries.inquiry_type     IS 'license / purchase / consultation / other';

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_patents_updated_at
    BEFORE UPDATE ON patents
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_detail_registrations_updated_at
    BEFORE UPDATE ON detail_registrations
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_patent_catalog_entries_updated_at
    BEFORE UPDATE ON patent_catalog_entries
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- Indexes
-- ============================================================

-- leads
CREATE INDEX idx_leads_email        ON leads (email);
CREATE INDEX idx_leads_status       ON leads (status);
CREATE INDEX idx_leads_created_at   ON leads (created_at DESC);

-- patents
CREATE INDEX idx_patents_patent_number      ON patents (patent_number);
CREATE INDEX idx_patents_normalized_number  ON patents (normalized_number);
CREATE INDEX idx_patents_lead_id            ON patents (lead_id);
CREATE INDEX idx_patents_status             ON patents (status);
CREATE INDEX idx_patents_category           ON patents (category);
CREATE INDEX idx_patents_applicant_type     ON patents (applicant_type);
CREATE INDEX idx_patents_filing_date        ON patents (filing_date DESC);

-- detail_registration_tokens
CREATE INDEX idx_drt_lead_id    ON detail_registration_tokens (lead_id);
CREATE INDEX idx_drt_expires_at ON detail_registration_tokens (expires_at);

-- detail_registrations
CREATE INDEX idx_dr_lead_id   ON detail_registrations (lead_id);
CREATE INDEX idx_dr_patent_id ON detail_registrations (patent_id);
CREATE INDEX idx_dr_status    ON detail_registrations (status);

-- patent_catalog_entries
CREATE INDEX idx_pce_catalog_status_published_at
    ON patent_catalog_entries (catalog_status, published_at DESC)
    WHERE catalog_status = 'published';
CREATE INDEX idx_pce_is_featured
    ON patent_catalog_entries (is_featured)
    WHERE is_featured = true;
CREATE INDEX idx_pce_patent_id ON patent_catalog_entries (patent_id);

-- consultation_inquiries
CREATE INDEX idx_ci_catalog_entry_id ON consultation_inquiries (catalog_entry_id);
CREATE INDEX idx_ci_status           ON consultation_inquiries (status);
CREATE INDEX idx_ci_created_at       ON consultation_inquiries (created_at DESC);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE leads                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE patents                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE detail_registration_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE detail_registrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE patent_catalog_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_inquiries      ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------
-- leads: service_role のみ全操作可
-- ----------------------------------------------------------
CREATE POLICY leads_service_role_all ON leads
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------
-- patents: service_role のみ全操作可
-- ----------------------------------------------------------
CREATE POLICY patents_service_role_all ON patents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------
-- detail_registration_tokens: service_role のみ全操作可
-- ----------------------------------------------------------
CREATE POLICY drt_service_role_all ON detail_registration_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------
-- detail_registrations: service_role のみ全操作可
-- ----------------------------------------------------------
CREATE POLICY dr_service_role_all ON detail_registrations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------
-- patent_catalog_entries:
--   anon: published レコードのみ SELECT 可
--   service_role: 全操作可
-- ----------------------------------------------------------
CREATE POLICY pce_anon_read_published ON patent_catalog_entries
    FOR SELECT
    TO anon
    USING (catalog_status = 'published');

CREATE POLICY pce_service_role_all ON patent_catalog_entries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ----------------------------------------------------------
-- consultation_inquiries:
--   anon: INSERT のみ可（SELECT 不可）
--   service_role: 全操作可
-- ----------------------------------------------------------
CREATE POLICY ci_anon_insert ON consultation_inquiries
    FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY ci_service_role_all ON consultation_inquiries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
