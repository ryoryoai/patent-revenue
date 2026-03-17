/**
 * V2パイプライン (ip-rich-poc-phase2) APIクライアント
 * 構成要件充足判定 + 売上推定を取得する
 */

function getConfig() {
  return {
    base: process.env.V2_API_BASE || "http://localhost:8000",
    token: process.env.V2_API_TOKEN || "",
    pollInterval: Number(process.env.V2_POLL_INTERVAL_MS || 10_000),
    pollTimeout: Number(process.env.V2_POLL_TIMEOUT_MS || 600_000)
  };
}

async function v2Fetch(path, options = {}) {
  const { base, token } = getConfig();
  const url = `${base}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const timeoutMs = options.timeoutMs || 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || data.message || `V2 API error: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * V2調査を開始する
 * @param {string} patentId - 特許番号 (例: "6684609")
 * @param {object} options
 * @returns {{ job_id: string, status: string }}
 */
async function startInvestigation(patentId, options = {}) {
  const body = {
    patent_id: patentId,
    pipeline: options.pipeline || "C",
    ...(options.claimNos ? { claim_nos: options.claimNos } : {}),
    ...(options.targetProduct ? { target_product: options.targetProduct } : {})
  };

  const { pollTimeout } = getConfig();
  return v2Fetch("/v1/analysis/start", {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: pollTimeout
  });
}

/**
 * ジョブのステータスを取得
 * @param {string} jobId
 * @returns {{ job_id, status, current_stage, error_message, ... }}
 */
async function getJobStatus(jobId) {
  return v2Fetch(`/v1/analysis/${jobId}`);
}

/**
 * ジョブの結果を取得
 * @param {string} jobId
 * @returns {{ job_id, status, results: Array }}
 */
async function getJobResults(jobId) {
  return v2Fetch(`/v1/analysis/${jobId}/results`);
}

/**
 * ジョブの完了をポーリングで待つ
 * @param {string} jobId
 * @param {function} onProgress - 進捗コールバック (stage名)
 * @returns {{ job_id, status, results }}
 */
async function waitForCompletion(jobId, onProgress) {
  const { pollTimeout, pollInterval } = getConfig();
  const start = Date.now();

  while (Date.now() - start < pollTimeout) {
    const status = await getJobStatus(jobId);

    if (onProgress) {
      onProgress(status.current_stage || status.status);
    }

    if (status.status === "completed") {
      return getJobResults(jobId);
    }

    if (status.status === "failed") {
      throw new Error(`V2 investigation failed: ${status.error_message || "unknown error"}`);
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("V2 investigation timed out");
}

/**
 * V2調査結果からランク判定に必要な情報を抽出する
 * @param {Array} results - V2 APIのresults配列
 * @returns {{ judgment, satisfactionRate, salesOkuYen, candidates }}
 */
function extractRankingData(results) {
  let judgment = null;
  let satisfactionRate = null;
  let salesOkuYen = null;
  const candidates = [];

  for (const r of results) {
    // Stage 14: 構成要件充足判定の集約結果
    if (r.stage && r.stage.includes("14_claim_decision_aggregator")) {
      const data = r.output_data;
      if (data) {
        judgment = data.judgment; // "infringed" | "not_infringed" | "potential" | "insufficient_evidence"
        satisfactionRate = data.satisfaction_rate;
      }
    }

    // Stage 24: 売上推定
    if (r.stage && r.stage.includes("24_sales_estimation")) {
      const data = r.output_data;
      if (data && data.total_estimated_revenue_oku_yen) {
        const raw = String(data.total_estimated_revenue_oku_yen).replace(/[^\d.]/g, "");
        salesOkuYen = parseFloat(raw) || null;
      }
    }

    // Stage 13v2: 個別の構成要件判定
    if (r.stage && r.stage.includes("13v2_element_assessment") || r.stage && r.stage.includes("13_element_assessment")) {
      const data = r.output_data;
      if (Array.isArray(data)) {
        candidates.push(...data);
      }
    }
  }

  return { judgment, satisfactionRate, salesOkuYen, candidates };
}

/**
 * V2結果からA〜Dランクを判定する
 *
 * A: 全構成要件充足 + 被疑侵害製品の売上100億円以上
 * B: 全構成要件充足 + 被疑侵害製品の売上1億円以上100億円未満
 * C: 構成要件の少なくとも一部を充足
 * D: 構成要件を一つも充足していない
 *
 * @param {{ judgment, satisfactionRate, salesOkuYen }} data
 * @returns {{ rank, reason }}
 */
function determineRank(data) {
  const { judgment, satisfactionRate, salesOkuYen } = data;

  const allSatisfied = judgment === "infringed" || satisfactionRate === 100;
  const partialSatisfied = judgment === "potential" || (satisfactionRate != null && satisfactionRate > 0);

  // 売上: oku_yen (億円) → 100億 = 100, 1億 = 1
  const salesOver100b = salesOkuYen != null && salesOkuYen >= 100;
  const salesOver1b = salesOkuYen != null && salesOkuYen >= 1;

  if (allSatisfied && salesOver100b) {
    return { rank: "A", reason: "全構成要件を充足しており、被疑侵害製品の売上が100億円以上" };
  }
  if (allSatisfied && salesOver1b) {
    return { rank: "B", reason: "全構成要件を充足しており、被疑侵害製品の売上が1億円以上" };
  }
  if (allSatisfied) {
    return { rank: "B", reason: "全構成要件を充足（売上情報なしのためBランク）" };
  }
  if (partialSatisfied) {
    return { rank: "C", reason: "構成要件の一部を充足" };
  }
  return { rank: "D", reason: "構成要件を充足していない" };
}

/**
 * V2パイプラインで調査→ランク判定まで一括実行
 * @param {string} patentId
 * @param {object} options
 * @returns {{ rank, reason, jobId, judgment, satisfactionRate, salesOkuYen }}
 */
async function investigateAndRank(patentId, options = {}) {
  const job = await startInvestigation(patentId, options);
  console.log(`[v2-client] Investigation started: job_id=${job.job_id}`);

  const results = await waitForCompletion(job.job_id, (stage) => {
    console.log(`[v2-client] Progress: ${stage}`);
  });

  const rankingData = extractRankingData(results.results || []);
  const { rank, reason } = determineRank(rankingData);

  return {
    rank,
    reason,
    jobId: job.job_id,
    judgment: rankingData.judgment,
    satisfactionRate: rankingData.satisfactionRate,
    salesOkuYen: rankingData.salesOkuYen
  };
}

/**
 * V2 APIが利用可能かチェック
 */
async function isV2Available() {
  try {
    const { base } = getConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base}/docs`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = {
  startInvestigation,
  getJobStatus,
  getJobResults,
  waitForCompletion,
  extractRankingData,
  determineRank,
  investigateAndRank,
  isV2Available
};
