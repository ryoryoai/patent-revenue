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
async function saveLead({ name, companyName, email, source = "patent-value-check" }) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("leads")
      .insert({
        name: name || "",
        company_name: companyName || "",
        email: email || "",
        source,
        status: "submitted",
        created_at: new Date().toISOString()
      })
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
async function savePatent({ leadId, patentNumber, normalizedNumber, title, category, status, filingDate, registrationDate }) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("patents")
      .insert({
        lead_id: leadId || null,
        patent_number: patentNumber || "",
        normalized_number: normalizedNumber || "",
        title: title || "",
        category: category || "",
        status: status || "",
        filing_date: filingDate || null,
        registration_date: registrationDate || null,
        created_at: new Date().toISOString()
      })
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
 * Supabaseクライアントを返す（外部モジュールから利用可能）
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
function getSupabase() {
  return getClient();
}

module.exports = { saveLead, savePatent, updateLeadStatus, getSupabase };
