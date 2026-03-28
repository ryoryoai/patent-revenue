const { createClient } = require("@supabase/supabase-js");

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return _client;
}

/**
 * リード情報をDBに保存する
 * @param {{ name: string, companyName: string, email: string, source?: string }} params
 * @returns {Promise<{ id: string } | null>} 保存されたレコードのID、失敗時はnull
 */
async function saveLead({ name, companyName, email, source = "patent-value-analyzer", referrer = null, utmData = null, landingPage = null, queryInput = null }) {
  const client = getClient();
  if (!client) return null;

  try {
    const row = {
      name: name || "",
      company_name: companyName || "",
      email: email || "",
      source,
      status: "submitted",
      created_at: new Date().toISOString()
    };
    if (referrer) row.referrer = referrer;
    if (utmData) row.utm_data = utmData;
    if (landingPage) row.landing_page = landingPage;
    if (queryInput) row.query_input = queryInput;

    const { data, error } = await client
      .from("leads")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.warn("[supabase] saveLead error:", error.message);
      return null;
    }

    return { id: data.id };
  } catch (err) {
    console.warn("[supabase] saveLead exception:", err.message);
    return null;
  }
}

/**
 * 特許情報をDBに保存する
 * @param {{ leadId: string, patentNumber: string, normalizedNumber: string, title?: string, category?: string, status?: string, filingDate?: string, registrationDate?: string }} params
 * @returns {Promise<{ id: string } | null>}
 */
async function savePatent({ leadId, patentNumber, normalizedNumber, title, category, status, filingDate, registrationDate, expireDate, applicant, applicantType, ipcCodes, metrics, jpoRaw, llmSummary, diagnosisResult, source }) {
  const client = getClient();
  if (!client) return null;

  try {
    const row = {
      lead_id: leadId || null,
      patent_number: patentNumber || "",
      normalized_number: normalizedNumber || "",
      title: title || "",
      category: category || "",
      status: status || "",
      filing_date: filingDate || null,
      registration_date: registrationDate || null,
      created_at: new Date().toISOString()
    };
    if (expireDate) row.expire_date = expireDate;
    if (applicant) row.applicant = applicant;
    if (applicantType) row.applicant_type = applicantType;
    if (ipcCodes) row.ipc_codes = ipcCodes;
    if (metrics) row.metrics = metrics;
    if (jpoRaw) row.jpo_raw = jpoRaw;
    if (llmSummary) row.llm_summary = llmSummary;
    if (diagnosisResult) row.diagnosis_result = diagnosisResult;
    if (source) row.source = source;

    // 同じ lead_id + patent_number の既存レコードがあれば更新
    if (leadId && patentNumber) {
      const { data: existing } = await client
        .from("patents")
        .select("id")
        .eq("lead_id", leadId)
        .eq("patent_number", patentNumber)
        .limit(1)
        .single();
      if (existing) {
        delete row.created_at;
        row.updated_at = new Date().toISOString();
        await client.from("patents").update(row).eq("id", existing.id);
        return { id: existing.id };
      }
    }

    const { data, error } = await client
      .from("patents")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.warn("[supabase] savePatent error:", error.message);
      return null;
    }

    return { id: data.id };
  } catch (err) {
    console.warn("[supabase] savePatent exception:", err.message);
    return null;
  }
}

/**
 * リードのステータスを更新する
 * @param {string} leadId
 * @param {string} status
 * @returns {Promise<boolean>}
 */
async function updateLeadStatus(leadId, status) {
  const client = getClient();
  if (!client || !leadId) return false;

  try {
    const { error } = await client
      .from("leads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", leadId);

    if (error) {
      console.warn("[supabase] updateLeadStatus error:", error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.warn("[supabase] updateLeadStatus exception:", err.message);
    return false;
  }
}

/**
 * メールアドレスからリードを検索（最新1件）
 */
async function findLeadByEmail(email) {
  const client = getClient();
  if (!client || !email) return null;

  try {
    const { data, error } = await client
      .from("leads")
      .select("id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 詳細レポート申請をDB保存
 */
async function findPatentByNumber(patentNumber) {
  const client = getClient();
  if (!client || !patentNumber) return null;
  try {
    const { data, error } = await client
      .from("patents")
      .select("id")
      .or(`patent_number.eq.${patentNumber},normalized_number.eq.${patentNumber}`)
      .limit(1)
      .single();
    if (error) return null;
    return data;
  } catch { return null; }
}

async function saveDetailedReportRequest({ leadId, patentId, rank, source }) {
  const client = getClient();
  if (!client) return null;

  try {
    // 特許番号から patents テーブルのUUIDを取得
    const patentRecord = await findPatentByNumber(patentId);

    const { data, error } = await client
      .from("detail_registrations")
      .insert({
        lead_id: leadId,
        patent_id: patentRecord?.id || null,
        type: "listing",
        status: "pending",
        department: null,
        support_method: null,
        message: `詳細レポート申請 (特許: ${patentId}, ランク: ${rank}, source: ${source})`,
        created_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[supabase] saveDetailedReportRequest error:", error.message);
      return null;
    }
    return { id: data.id };
  } catch (err) {
    console.warn("[supabase] saveDetailedReportRequest exception:", err.message);
    return null;
  }
}

async function updateDetailRegistrationStatus(registrationId, status) {
  const client = getClient();
  if (!client || !registrationId) return null;
  try {
    const { error } = await client
      .from("detail_registrations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", registrationId);
    if (error) console.warn("[supabase] updateDetailRegistrationStatus error:", error.message);
  } catch (err) {
    console.warn("[supabase] updateDetailRegistrationStatus exception:", err.message);
  }
}

/**
 * Supabaseクライアントを返す（外部モジュールから利用可能）
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
function getSupabase() {
  return getClient();
}

module.exports = { saveLead, savePatent, updateLeadStatus, findLeadByEmail, saveDetailedReportRequest, updateDetailRegistrationStatus, getSupabase };
