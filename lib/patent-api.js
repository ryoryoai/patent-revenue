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

const JPO_USERNAME = (process.env.JPO_USERNAME || "").trim();
const JPO_PASSWORD = (process.env.JPO_PASSWORD || "").trim();
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
      accessToken: String(data.access_token).trim(),
      refreshToken: data.refresh_token ? String(data.refresh_token).trim() : null,
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
 * 登録番号 → 出願番号を変換する
 * エンドポイント: /api/patent/v1/case_number_reference/registration/{registrationNumber}
 * @param {string} registrationNumber - 登録番号 (例: "6992713")
 * @returns {Promise<string|null>} 出願番号
 */
async function resolveApplicationNumber(registrationNumber) {
  const path = `/api/patent/v1/case_number_reference/registration/${encodeURIComponent(registrationNumber)}`;
  const raw = await apiGet(path);
  if (!raw) return null;

  const data = raw.result?.data;
  if (!data) return null;

  // 直接フィールド
  if (data.applicationNumber) return data.applicationNumber;

  // ネストされたリスト
  const items = data.list || data.items || [];
  if (Array.isArray(items) && items.length > 0) {
    return items[0].applicationNumber || null;
  }

  // 全ネストを探索
  for (const val of Object.values(data)) {
    if (val && typeof val === "object" && val.applicationNumber) {
      return val.applicationNumber;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && item.applicationNumber) return item.applicationNumber;
      }
    }
  }
  return null;
}

/**
 * 登録情報を取得する
 * エンドポイント: /api/patent/v1/registration_info/{applicationNumber}
 * @param {string} applicationNumber
 * @returns {Promise<object|null>}
 */
async function fetchRegistrationInfo(applicationNumber) {
  const path = `/api/patent/v1/registration_info/${encodeURIComponent(applicationNumber)}`;
  return apiGet(path);
}

/**
 * 引用文献情報を取得する
 * エンドポイント: /api/patent/v1/cite_doc_info/{applicationNumber}
 * @param {string} applicationNumber
 * @returns {Promise<object|null>}
 */
async function fetchCitations(applicationNumber) {
  const path = `/api/patent/v1/cite_doc_info/${encodeURIComponent(applicationNumber)}`;
  return apiGet(path);
}

/**
 * 簡易経過情報を取得する
 * エンドポイント: /api/patent/v1/app_progress_simple/{applicationNumber}
 * @param {string} applicationNumber
 * @returns {Promise<object|null>}
 */
async function fetchProgressSimple(applicationNumber) {
  const path = `/api/patent/v1/app_progress_simple/${encodeURIComponent(applicationNumber)}`;
  return apiGet(path);
}

/**
 * 特許番号(出願番号 or 登録番号)で包括的な特許データを取得する
 * 登録番号の場合は自動的に出願番号に変換してから各APIを呼ぶ
 * @param {string} patentNumber - 特許番号 or 出願番号
 * @returns {Promise<object|null>}
 */
async function fetchByNumber(patentNumber) {
  if (!isPatentApiAvailable()) return null;

  // まず出願番号として経過情報APIに問い合わせ
  let result = await fetchByApplicationNumber(patentNumber);
  if (result) return result;

  // 失敗したら登録番号として出願番号に変換
  console.log(`[jpo-api] trying as registration number: ${patentNumber}`);
  const appNumber = await resolveApplicationNumber(patentNumber);
  if (!appNumber) {
    console.warn(`[jpo-api] could not resolve registration number: ${patentNumber}`);
    return null;
  }
  console.log(`[jpo-api] resolved: ${patentNumber} → application ${appNumber}`);

  return fetchByApplicationNumber(appNumber);
}

/**
 * 包括的な特許リサーチデータを取得する (1層目: 文献解析層)
 * 登録番号→出願番号変換、経過情報、登録情報、引用情報を一括取得
 * @param {string} patentNumber - 特許番号(登録番号)
 * @returns {Promise<object|null>} 正規化された特許データ + 生データ
 */
async function fetchComprehensiveData(patentNumber, { throwOnInvalid = false } = {}) {
  if (!isPatentApiAvailable()) return null;

  // Step 1: 登録番号→出願番号変換
  const appNumber = await resolveApplicationNumber(patentNumber);
  if (!appNumber) {
    // 出願番号として直接試行
    const direct = await fetchByApplicationNumber(patentNumber);
    if (direct && throwOnInvalid && direct.status !== "登録") {
      const err = new Error(`この特許は有効ではありません（状態: ${direct.status}）。`);
      err.code = "PATENT_INVALID";
      err.patentStatus = direct.status;
      err.patent = direct;
      throw err;
    }
    return direct;
  }
  console.log(`[jpo-api] resolved: ${patentNumber} → ${appNumber}`);

  // Step 2: 経過情報を取得してステータスチェック
  const baseData = await fetchByApplicationNumber(appNumber);
  if (!baseData) return null;

  // 有効性チェック: 「登録」以外は早期リターン
  if (throwOnInvalid && baseData.status !== "登録") {
    console.log(`[jpo-api] patent ${patentNumber} is not active (status: ${baseData.status}), skipping full research`);
    const err = new Error(`この特許は有効ではありません（状態: ${baseData.status}）。`);
    err.code = "PATENT_INVALID";
    err.patentStatus = baseData.status;
    err.patent = baseData;
    throw err;
  }

  // Step 3: 有効な特許のみ残りのAPIを並列呼び出し
  const [registration, citations, fullText] = await Promise.allSettled([
    fetchRegistrationInfo(appNumber),
    fetchCitations(appNumber),
    fetchPatentFullText(patentNumber)
  ]);

  // Step 3: 登録情報からIPC/請求項数/残存年数を補強
  if (registration.status === "fulfilled" && registration.value) {
    const regData = registration.value.result?.data;
    if (regData) {
      baseData._registrationInfo = regData;
      // IPC分類を取得
      if (regData.ipcClassification) {
        baseData.ipcClassification = regData.ipcClassification;
      }
      // 請求項数
      const claimCount = regData.numberOfClaims || regData.claimCount;
      if (claimCount) {
        baseData.metrics.claimCount = Number(claimCount) || 0;
      }
      // FI分類
      if (regData.fiClassification) {
        baseData.fiClassification = regData.fiClassification;
      }
      // 年金情報
      if (regData.lastPaymentYearly) {
        baseData.lastPaymentYear = Number(regData.lastPaymentYearly) || 0;
      }
      if (regData.nextPensionPaymentDate) {
        baseData.nextPensionPaymentDate = formatJpoDate(regData.nextPensionPaymentDate);
      }
      // 権利者情報 (rightPersonInformation)
      if (Array.isArray(regData.rightPersonInformation) && regData.rightPersonInformation.length > 0) {
        baseData.rightHolders = regData.rightPersonInformation.map(p => p.rightPersonName).filter(Boolean);
      }
    }
  }

  // Step 4: 引用情報で被引用数を補強
  if (citations.status === "fulfilled" && citations.value) {
    const citeData = citations.value.result?.data;
    if (citeData) {
      baseData._citations = citeData;
      // patentDoc: 特許文献引用, nonPatentDoc: 非特許文献引用
      const patentDocs = Array.isArray(citeData.patentDoc) ? citeData.patentDoc : [];
      const nonPatentDocs = Array.isArray(citeData.nonPatentDoc) ? citeData.nonPatentDoc : [];
      baseData.metrics.citations = patentDocs.length + nonPatentDocs.length;
      baseData.citationDetails = {
        patentDocCount: patentDocs.length,
        nonPatentDocCount: nonPatentDocs.length,
        patentDocs: patentDocs.map(d => ({
          documentNumber: d.documentNumber,
          citationType: d.citationType,
          draftDate: formatJpoDate(d.draftDate)
        }))
      };
    }
  }

  // Step 4.5: Google Patents全文テキストを補強
  if (fullText.status === "fulfilled" && fullText.value) {
    const ft = fullText.value;
    if (ft.claims) {
      baseData.claimsText = ft.claims;
    }
    if (ft.description) {
      baseData.descriptionText = ft.description;
    }
    // IPC分類のフォールバック (JPO APIから取得できなかった場合)
    if (!baseData.ipcClassification && ft.ipc.length > 0) {
      baseData.ipcClassification = ft.ipc.join(", ");
    }
    // 追加IPC情報 (JPO APIで取得済みでもGoogle Patentsの情報を保持)
    if (ft.ipc.length > 0) {
      baseData.ipcCodes = ft.ipc;
    }
  }

  // Step 5: 残存年数の計算
  if (baseData.expireDate) {
    const expire = new Date(baseData.expireDate);
    const now = new Date();
    const remainingYears = Math.max(0, (expire - now) / (365.25 * 24 * 60 * 60 * 1000));
    baseData.remainingYears = Math.round(remainingYears * 10) / 10;
  }

  // Step 6: データソースフラグ
  baseData.source = "jpo-api";
  baseData.fetchedAt = new Date().toISOString();

  return baseData;
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

/**
 * Google Patentsから公報全文テキストを取得する
 * @param {string} registrationNumber - 登録番号 (例: "6466025")
 * @returns {Promise<{claims: string, description: string, ipc: string[]}|null>}
 */
async function fetchPatentFullText(registrationNumber) {
  const url = `https://patents.google.com/patent/JP${registrationNumber}B2/ja`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PatentResearchBot/1.0)",
        "Accept-Language": "ja,en;q=0.9"
      },
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`[google-patents] HTTP ${res.status} for ${registrationNumber}`);
      return null;
    }

    const html = await res.text();

    // 請求項テキストを抽出
    const claims = extractSection(html, "claims");
    // 発明の詳細な説明を抽出 (先頭2000文字)
    const description = extractSection(html, "description");
    // IPC分類コードを抽出
    const ipc = extractIpcCodes(html);

    if (!claims && !description && ipc.length === 0) {
      console.warn(`[google-patents] no content extracted for ${registrationNumber}`);
      return null;
    }

    console.log(`[google-patents] extracted for ${registrationNumber}: claims=${claims ? claims.length : 0}chars, desc=${description ? description.length : 0}chars, ipc=${ipc.length}codes`);

    return {
      claims: claims || "",
      description: (description || "").slice(0, 2000),
      ipc
    };
  } catch (error) {
    console.warn(`[google-patents] fetch error for ${registrationNumber}:`, error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Patents HTMLからセクションのテキストを抽出する
 * @param {string} html
 * @param {"claims"|"description"} section
 * @returns {string|null}
 */
function extractSection(html, section) {
  // Google Patentsは <section itemprop="claims"> や <section itemprop="description"> を使用
  const sectionRegex = new RegExp(
    `<section[^>]*itemprop="${section}"[^>]*>([\\s\\S]*?)</section>`,
    "i"
  );
  const match = html.match(sectionRegex);
  if (!match) {
    // フォールバック: abstract (description の場合)
    if (section === "description") {
      const abstractRegex = /<section[^>]*itemprop="abstract"[^>]*>([\s\S]*?)<\/section>/i;
      const abstractMatch = html.match(abstractRegex);
      if (abstractMatch) {
        return stripHtml(abstractMatch[1]).trim();
      }
    }
    return null;
  }

  return stripHtml(match[1]).trim();
}

/**
 * HTMLタグを除去してプレーンテキストにする
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Google Patents HTMLからIPC分類コードを抽出する
 */
function extractIpcCodes(html) {
  const codes = new Set();

  // <span itemprop="Code"> や class="patent-result-table-classification" 内のIPC
  const ipcRegex = /itemprop="Code"[^>]*>([A-H]\d{2}[A-Z]\s*\d+\/\d+)/gi;
  let m;
  while ((m = ipcRegex.exec(html)) !== null) {
    codes.add(m[1].replace(/\s+/g, ""));
  }

  // メタ情報内のIPC
  const metaRegex = /class="[^"]*classification[^"]*"[^>]*>([A-H]\d{2}[A-Z]\s*\d+\/\d+)/gi;
  while ((m = metaRegex.exec(html)) !== null) {
    codes.add(m[1].replace(/\s+/g, ""));
  }

  // 汎用パターン: テキスト中のIPC形式
  const generalRegex = /\b([A-H]\d{2}[A-Z]\d+\/\d+)\b/g;
  while ((m = generalRegex.exec(html)) !== null) {
    codes.add(m[1]);
  }

  return [...codes];
}

/**
 * Google Patents ページからリーガルステータスを軽量チェックする
 * 認証不要・1リクエストで完結するため、簡易診断の事前チェックに適する
 * @param {string} registrationNumber - 登録番号
 * @returns {Promise<{ exists: boolean, active: boolean, statusText: string }>}
 */
async function fetchPatentStatus(registrationNumber) {
  const fallback = { exists: false, active: false, statusText: "" };
  if (!registrationNumber) return fallback;

  const url = `https://patents.google.com/patent/JP${registrationNumber}B2/ja`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PatentResearchBot/1.0)",
        "Accept-Language": "ja,en;q=0.9"
      },
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`[google-patents-status] HTTP ${res.status} for ${registrationNumber}`);
      return fallback;
    }

    const html = await res.text();

    // Google Patents の Legal Status を抽出
    // パターン1: <span itemprop="status">Active</span> (legalStatusIfi セクション内)
    const itempropStatusMatch = html.match(/itemprop="status"[^>]*>([^<]+)/i);
    // パターン2: <span itemprop="ifiStatus">Active</span>
    const ifiStatusMatch = html.match(/itemprop="ifiStatus"[^>]*>([^<]+)/i);
    // パターン3: legal-status イベント内の <span itemprop="title">Active</span>
    const legalEventMatch = html.match(/legal-status[\s\S]{0,200}?itemprop="title"[^>]*>([^<]+)/i);

    const rawStatus = (itempropStatusMatch && itempropStatusMatch[1].trim())
      || (ifiStatusMatch && ifiStatusMatch[1].trim())
      || (legalEventMatch && legalEventMatch[1].trim())
      || "";

    if (!rawStatus) {
      // ステータスが抽出できなかった場合、ページは存在するので exists=true だが判定不能
      console.warn(`[google-patents-status] could not extract status for ${registrationNumber}`);
      return { exists: true, active: false, statusText: "" };
    }

    const normalized = rawStatus.toLowerCase();
    const active = /^active/.test(normalized);
    const statusText = active ? "登録"
      : /expired|lapsed/.test(normalized) ? "消滅"
      : /revoked/.test(normalized) ? "消滅"
      : /withdrawn/.test(normalized) ? "取下"
      : /pending/.test(normalized) ? "出願中"
      : rawStatus;

    console.log(`[google-patents-status] ${registrationNumber}: ${rawStatus} → ${statusText}`);
    return { exists: true, active, statusText };
  } catch (error) {
    console.warn(`[google-patents-status] fetch error for ${registrationNumber}:`, error.message);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isPatentApiAvailable,
  fetchByNumber,
  fetchByApplicationNumber,
  resolveApplicationNumber,
  fetchRegistrationInfo,
  fetchCitations,
  fetchProgressSimple,
  fetchComprehensiveData,
  fetchPatentFullText,
  fetchPatentStatus
};
