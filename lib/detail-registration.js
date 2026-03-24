const crypto = require("crypto");

/**
 * トークン生成: 32バイトのランダムな16進数文字列
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * トークンをSHA-256でハッシュ化
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * トークンを検証してリード情報を返す
 * Supabaseが利用可能な場合はSupabase経由、なければフォールバック
 */
async function verifyToken(tokenHash) {
  try {
    const supabase = requireSupabase();
    if (!supabase) {
      console.warn("[detail-registration] Supabase not available, cannot verify token");
      return null;
    }

    const { data, error } = await supabase
      .from("detail_registration_tokens")
      .select("id, lead_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .single();

    if (error || !data) {
      console.warn("[detail-registration] token not found:", tokenHash.slice(0, 8));
      return null;
    }

    if (data.used_at) {
      console.warn("[detail-registration] token already used:", tokenHash.slice(0, 8));
      return null;
    }

    if (new Date(data.expires_at) < new Date()) {
      console.warn("[detail-registration] token expired:", tokenHash.slice(0, 8));
      return null;
    }

    return { tokenId: data.id, leadId: data.lead_id };
  } catch (err) {
    console.warn("[detail-registration] verifyToken error:", err.message);
    return null;
  }
}

/**
 * リードIDからプリフィルデータを取得
 */
async function getPrefilledData(leadId) {
  try {
    const supabase = requireSupabase();
    if (!supabase) {
      console.warn("[detail-registration] Supabase not available, cannot get prefill data");
      return null;
    }

    const { data, error } = await supabase
      .from("leads")
      .select("id, name, company_name, email, patent_number, title, category, summary")
      .eq("id", leadId)
      .single();

    if (error || !data) {
      console.warn("[detail-registration] lead not found:", leadId);
      return null;
    }

    return {
      name: data.name || "",
      company_name: data.company_name || "",
      email: data.email || "",
      patent_number: data.patent_number || "",
      title: data.title || "",
      category: data.category || "",
      summary: data.summary || ""
    };
  } catch (err) {
    console.warn("[detail-registration] getPrefilledData error:", err.message);
    return null;
  }
}

/**
 * 詳細登録データを保存し、トークンを使用済みにする
 */
async function saveDetailRegistration(data) {
  const { tokenId, leadId, type, fields } = data;

  try {
    const supabase = requireSupabase();
    if (!supabase) {
      console.warn("[detail-registration] Supabase not available, cannot save detail registration");
      return { success: false, message: "データベース未設定のため保存できませんでした" };
    }

    // 詳細登録データを保存
    const { error: insertError } = await supabase
      .from("detail_registrations")
      .insert({
        lead_id: leadId,
        type,
        fields,
        created_at: new Date().toISOString()
      });

    if (insertError) {
      console.error("[detail-registration] insert error:", insertError.message);
      return { success: false, message: "登録データの保存に失敗しました" };
    }

    // トークンを使用済みに更新
    const { error: tokenError } = await supabase
      .from("detail_registration_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenId);

    if (tokenError) {
      console.error("[detail-registration] token update error:", tokenError.message);
    }

    // リードのステータスを更新
    const { error: leadError } = await supabase
      .from("leads")
      .update({ status: "detail_submitted", updated_at: new Date().toISOString() })
      .eq("id", leadId);

    if (leadError) {
      console.error("[detail-registration] lead status update error:", leadError.message);
    }

    return { success: true };
  } catch (err) {
    console.error("[detail-registration] saveDetailRegistration error:", err.message);
    return { success: false, message: "登録処理中にエラーが発生しました" };
  }
}

/**
 * Supabaseクライアントを取得（利用不可の場合はnullを返す）
 */
function requireSupabase() {
  try {
    const { getSupabaseClient } = require("./supabase");
    return getSupabaseClient();
  } catch (err) {
    return null;
  }
}

module.exports = {
  generateToken,
  hashToken,
  verifyToken,
  getPrefilledData,
  saveDetailRegistration
};
