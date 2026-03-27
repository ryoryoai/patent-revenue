/**
 * 管理画面共通ロジック（認証・API呼び出し）
 */

const SUPABASE_URL = document.querySelector("meta[name=supabase-url]")?.content || "";
const SUPABASE_ANON_KEY = document.querySelector("meta[name=supabase-anon-key]")?.content || "";

let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient && SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

async function getAccessToken() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || null;
}

async function adminFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    window.location.href = "/admin/index.html";
    throw new Error("Not authenticated");
  }

  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });

  if (res.status === 403) {
    window.location.href = "/admin/index.html";
    throw new Error("Forbidden");
  }

  return res.json();
}

async function checkAuth() {
  const sb = getSupabase();
  if (!sb) return false;
  const { data: { session } } = await sb.auth.getSession();
  return !!session;
}

async function logout() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  window.location.href = "/admin/index.html";
}

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS_LABELS = {
  created: "作成済み", submitted: "診断済み", emailed: "メール送信済み",
  detail_started: "詳細レポート開始", detail_submitted: "詳細レポート送信済み",
  contacted: "連絡済み", converted: "成約", closed: "クローズ",
  pending: "未対応", reviewed: "確認済み", new: "新規", replied: "返信済み",
};
function badgeHtml(status) {
  const label = STATUS_LABELS[status] || status || "-";
  return `<span class="badge badge-${status || "unknown"}">${label}</span>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
