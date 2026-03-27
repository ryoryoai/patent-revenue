/**
 * 管理画面の認証ミドルウェア
 * Supabase Auth に登録済みユーザーなら全機能アクセス可
 * x-metrics-key はAPI用フォールバック
 */

const { getSupabase } = require("./supabase");

const METRICS_API_KEY = process.env.METRICS_API_KEY || "";

/**
 * リクエストの管理者認証を検証する
 * @param {http.IncomingMessage} req
 * @returns {Promise<{ ok: boolean, user?: object, method?: string }>}
 */
async function verifyAdminAuth(req) {
  // 1. Supabase Auth JWT — 登録ユーザーなら誰でもOK
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user && user.email) {
          return { ok: true, user, method: "jwt" };
        }
      } catch (err) {
        console.warn("[admin-auth] JWT verification failed:", err.message);
      }
    }
  }

  // 2. x-metrics-key フォールバック
  if (METRICS_API_KEY && req.headers["x-metrics-key"] === METRICS_API_KEY) {
    return { ok: true, method: "api_key" };
  }

  return { ok: false };
}

module.exports = { verifyAdminAuth };
