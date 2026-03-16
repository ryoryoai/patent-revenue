/**
 * JPO (特許庁) 特許情報取得API クライアント
 * https://ip-data.jpo.go.jp
 *
 * 認証フロー:
 *   1. username/password で POST → access_token + refresh_token 取得
 *   2. access_token (有効期限1時間) を Bearer ヘッダーに付けて GET
 *   3. 期限切れ時は refresh_token で再取得 (8時間以内)
 */

const { URL, URLSearchParams } = require("url");

const JPO_USERNAME = process.env.JPO_USERNAME || "";
const JPO_PASSWORD = process.env.JPO_PASSWORD || "";
const JPO_API_TIMEOUT_MS = Number(process.env.JPO_API_TIMEOUT_MS || 10_000);

const TOKEN_URL = "https://ip-data.jpo.go.jp/auth/token";
const API_BASE = "https://ip-data.jpo.go.jp/api/patent/v1";

// トークンのインメモリキャッシュ
let tokenState = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,          // access_token の有効期限 (epoch ms)
  refreshExpiresAt: 0    // refresh_token の有効期限 (epoch ms)
};

/**
 * JPO APIが利用可能か (認証情報が設定されているか)
 */
function isPatentApiAvailable() {
  return Boolean(JPO_USERNAME && JPO_PASSWORD);
}

/**
 * アクセストークンを取得 (キャッシュ・自動更新対応)
 */
async function getAccessToken() {
  const now = Date.now();
  const margin = 60_000; // 1分の余裕を持って更新

  // 有効なトークンがあればそのまま返す
  if (tokenState.accessToken && now < tokenState.expiresAt - margin) {
    return tokenState.accessToken;
  }

  // refresh_token が有効ならリフレッシュ
  if (tokenState.refreshToken && now < tokenState.refreshExpiresAt - margin) {
    const result = await requestToken({
      grant_type: "refresh_token",
      refresh_token: tokenState.refreshToken
    });
    if (result) return result.accessToken;
  }

  // 初回取得 or リフレッシュ失敗 → パスワード認証
  const result = await requestToken({
    grant_type: "password",
    username: JPO_USERNAME,
    password: JPO_PASSWORD
  });

  if (!result) {
    throw new Error("JPO token acquisition failed");
  }
  return result.accessToken;
}

/**
 * トークンエンドポイントへリクエスト
 */
async function requestToken(params) {
  const body = new URLSearchParams(params).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JPO_API_TIMEOUT_MS);

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });

    const data = await res.json();

    // JPO APIのエラーレスポンス形式をチェック
    if (data.result && data.result.statusCode !== "100") {
      console.warn("[jpo-api] token error:", data.result.statusCode, data.result.errorMessage);
      return null;
    }

    if (!data.access_token) {
      console.warn("[jpo-api] token request failed: no access_token in response");
      return null;
    }

    const now = Date.now();
    tokenState = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + (data.expires_in || 3600) * 1000,
      refreshExpiresAt: now + (data.refresh_expires_in || 28800) * 1000
    };

    console.log("[jpo-api] token acquired, expires in", data.expires_in, "s");
    return { accessToken: data.access_token };
  } catch (error) {
    console.warn("[jpo-api] token request error:", error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 特許出願番号で経過情報を取得する
 * エンドポイント: /api/patent/v1/app_progress/{出願番号}
 * @param {string} applicationNumber - 出願番号 (例: "2020008423")
 * @returns {Promise<object|null>}
 */
async function fetchByApplicationNumber(applicationNumber) {
  if (!isPatentApiAvailable()) return null;

  const path = `/api/patent/v1/app_progress/${encodeURIComponent(applicationNumber)}`;
  const raw = await apiGet(path);
  if (!raw) return null;

  return normalizeAppProgressResponse(raw, applicationNumber);
}

/**
 * 特許番号(出願番号 or 登録番号)で経過情報を取得する
 * JPO APIの app_progress は出願番号で引くため、そのまま試行する。
 * @param {string} patentNumber - 特許番号 or 出願番号
 * @returns {Promise<object|null>}
 */
async function fetchByNumber(patentNumber) {
  if (!isPatentApiAvailable()) return null;

  // まず出願番号として経過情報APIに問い合わせ
  return fetchByApplicationNumber(patentNumber);
}

/**
 * 認証済みGETリクエストを実行
 */
async function apiGet(path) {
  let token;
  try {
    token = await getAccessToken();
  } catch (error) {
    console.warn("[jpo-api] auth failed:", error.message);
    return null;
  }

  const url = `${API_BASE.replace(/\/api\/patent\/v1$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JPO_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
      signal: controller.signal
    });

    const data = await res.json();
    if (!data || !data.result) return null;

    const { statusCode, errorMessage } = data.result;
    if (statusCode !== "100") {
      console.warn(`[jpo-api] ${path} statusCode=${statusCode} error=${errorMessage}`);
      return null;
    }

    if (data.result.remainAccessCount != null) {
      console.log(`[jpo-api] remaining API calls: ${data.result.remainAccessCount}`);
    }

    return data;
  } catch (error) {
    console.warn(`[jpo-api] GET ${path} error:`, error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JPO APIレスポンスを内部フォーマットに変換する
 *
 * 実APIの主要フィールド:
 *   applicationNumber, inventionTitle, filingDate, registrationDate,
 *   registrationNumber, publicationNumber, expireDate, erasureIdentifier,
 *   applicantAttorney[]: { name, applicantAttorneyClass (1=出願人, 2=代理人) }
 *   bibliographyInformation[]: 書誌・経過情報
 *   priorityRightInformation[]: 優先権情報
 */
function normalizeAppProgressResponse(raw, queryNumber) {
  const d = raw.result && raw.result.data ? raw.result.data : {};

  // 出願人を抽出 (applicantAttorneyClass "1" が出願人)
  const applicants = (d.applicantAttorney || [])
    .filter((a) => a.applicantAttorneyClass === "1")
    .map((a) => a.name);
  const applicantName = applicants.join("、") || "";

  // 日付を YYYY-MM-DD 形式に変換 (JPOは YYYYMMDD)
  const filingDate = formatJpoDate(d.filingDate);
  const registrationDate = formatJpoDate(d.registrationDate);
  const expireDate = formatJpoDate(d.expireDate);

  // 登録番号があれば登録済み、消滅識別子で判定
  const status = d.registrationNumber
    ? (d.erasureIdentifier === "00" ? "登録" : "消滅")
    : "出願中";

  return {
    id: String(d.registrationNumber || d.applicationNumber || queryNumber),
    title: d.inventionTitle || "",
    applicant: applicantName,
    applicantType: classifyApplicantType(applicantName),
    registrationDate,
    filingDate,
    category: "",
    status,
    officialUrl: `https://www.j-platpat.inpit.go.jp/c1800/PU/JP-${d.applicationNumber || queryNumber}/`,
    expireDate,
    applicationNumber: d.applicationNumber || "",
    registrationNumber: d.registrationNumber || "",
    publicationNumber: d.ADPublicationNumber || d.publicationNumber || "",
    metrics: {
      citations: 0,
      citationGrowth: 0,
      claimCount: 0,
      familySize: (d.priorityRightInformation || []).length || 0,
      classRank: 50,
      marketPlayers: 0,
      filingDensity: 50,
      prosecutionMonths: computeProsecutionMonths(filingDate, registrationDate)
    },
    // JPO APIの生データ (サーバー内部用、クライアントには送信しない)
    _jpoRaw: d
  };
}

/**
 * JPO日付形式 (YYYYMMDD) を YYYY-MM-DD に変換
 */
function formatJpoDate(dateStr) {
  if (!dateStr || dateStr.length < 8) return "";
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

/**
 * 出願日→登録日の月数を計算
 */
function computeProsecutionMonths(filingDate, registrationDate) {
  if (!filingDate || !registrationDate) return 0;
  const filing = new Date(filingDate);
  const reg = new Date(registrationDate);
  if (isNaN(filing) || isNaN(reg)) return 0;
  return Math.max(0, Math.round((reg - filing) / (30.44 * 24 * 60 * 60 * 1000)));
}

/**
 * JPOステータスを内部ステータスに変換
 */
function mapStatus(status) {
  if (!status) return "不明";
  if (/登録/.test(status)) return "登録";
  if (/拒絶/.test(status)) return "拒絶";
  if (/取下|放棄/.test(status)) return "取下";
  if (/審査|出願/.test(status)) return "出願中";
  return status;
}

/**
 * 出願人名から種別を推定
 */
function classifyApplicantType(name) {
  if (/大学|学校法人|研究所|機構/.test(name)) return "大学";
  if (/株式会社|合同会社|有限会社|Inc\.|Corp\.|Ltd\./.test(name)) return "企業";
  return "個人";
}

module.exports = {
  isPatentApiAvailable,
  fetchByNumber,
  fetchByApplicationNumber
};
