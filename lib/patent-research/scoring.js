const {
  INDUSTRY_BASE_RANGE,
  INDUSTRY_MARKET_DATA,
  CATEGORY_FIELDS,
  STRENGTH_AXES,
  IPC_CATEGORY_MAP_ORDERED
} = require("./constants");

/**
 * 特許番号からIPC分類を使ってカテゴリを推定する
 * 全IPCコードを走査し、優先度付きマッチングで最適なカテゴリを選択
 */
function inferCategory(patent) {
  if (patent.category) return patent.category;

  // 全IPCコードを収集
  const ipcCodes = [];
  if (patent.ipcCodes && patent.ipcCodes.length > 0) {
    ipcCodes.push(...patent.ipcCodes);
  } else {
    const ipc = patent.ipcClassification || patent._jpoRaw?.ipcClassification || "";
    if (ipc) ipcCodes.push(ipc);
  }

  // 各IPCコードに対し、最も具体的(prefix長い)なマッチを探す
  const categoryVotes = {};
  for (const ipc of ipcCodes) {
    const upper = ipc.replace(/\s/g, "").toUpperCase();
    let bestMatch = null;
    let bestLen = 0;
    for (const entry of IPC_CATEGORY_MAP_ORDERED) {
      if (upper.startsWith(entry.prefix) && entry.prefix.length > bestLen) {
        bestMatch = entry.category;
        bestLen = entry.prefix.length;
      }
    }
    if (bestMatch) {
      categoryVotes[bestMatch] = (categoryVotes[bestMatch] || 0) + bestLen;
    }
  }

  // 重み付き投票で最も適切なカテゴリを選択
  if (Object.keys(categoryVotes).length > 0) {
    const sorted = Object.entries(categoryVotes).sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  // IPCで判定できない場合はタイトルからフォールバック
  const title = (patent.title || "").toLowerCase();
  if (/車両|エンジン|内燃|ハイブリッド|トランスミッション|ブレーキ|車載/.test(title)) return "車載 / パワートレイン";
  if (/ai|機械学習|深層学習|ニューラル|推論/.test(title)) return "製造DX / AI";
  if (/通信|ネットワーク|無線|iot|センサ/.test(title)) return "通信 / IoT";
  if (/医療|診断|画像|mri|ct/.test(title)) return "医療機器 / 画像解析";
  if (/電池|太陽|材料|触媒|エネルギー/.test(title)) return "エネルギー / 材料";
  if (/プログラム|ソフト|アプリ|処理装置|情報処理/.test(title)) return "ソフトウェア";

  return "ソフトウェア";
}

function scoreLegalStatus(patent) {
  if (patent.status === "登録") return 1.0;
  if (patent.status === "出願中") return 0.5;
  if (patent.status === "消滅") return 0.1;
  return 0.3;
}

function scoreRemainingTerm(patent) {
  const years = patent.remainingYears || 0;
  if (years >= 15) return 1.0;
  if (years >= 10) return 0.8;
  if (years >= 5) return 0.5;
  if (years >= 2) return 0.3;
  return 0.1;
}

function scoreClaimStrength(patent) {
  const claims = patent.metrics?.claimCount || 0;
  if (claims >= 15) return 1.0;
  if (claims >= 10) return 0.8;
  if (claims >= 5) return 0.6;
  if (claims >= 1) return 0.4;
  return 0.2;
}

function scoreExperimentalEvidence(patent) {
  const citations = patent.metrics?.citations || 0;
  if (citations >= 10) return 1.0;
  if (citations >= 5) return 0.7;
  if (citations >= 2) return 0.5;
  if (citations >= 1) return 0.3;
  return 0.2;
}

function scoreDesignAroundDifficulty(patent) {
  const claims = patent.metrics?.claimCount || 0;
  const family = patent.metrics?.familySize || 0;
  const combined = claims * 0.6 + family * 4;
  if (combined >= 20) return 1.0;
  if (combined >= 12) return 0.7;
  if (combined >= 5) return 0.5;
  return 0.3;
}

function scoreMarketFit(patent) {
  const players = patent.metrics?.marketPlayers || 0;
  const density = patent.metrics?.filingDensity || 50;
  if (players >= 20 && density >= 60) return 1.0;
  if (players >= 10) return 0.7;
  if (players >= 5) return 0.5;
  return 0.3;
}

/**
 * 実施立証の容易さ (negotiability / provability)
 * 侵害の発見・立証が容易か？ 権利者側の交渉負担は？
 */
function scoreProvability(patent) {
  const claims = patent.metrics?.claimCount || 0;
  const category = patent.category || "";

  // ソフトウェア/制御ロジック系はブラックボックス化されやすく立証困難
  let base = 0.6;
  if (/ソフトウェア|制御|アルゴリズム/.test(patent.title || "")) base = 0.4;
  if (/車載|ECU/.test(category) || /制御回路|制御装置/.test(patent.title || "")) base = 0.45;
  // 構造物・機械的構成は外観から侵害判定しやすい
  if (/装置|構造|機構|デバイス/.test(patent.title || "")) base = Math.max(base, 0.6);
  // 化学/材料は分析で立証可能
  if (/材料|組成|化合物/.test(patent.title || "")) base = Math.max(base, 0.65);

  // 請求項が多いほど立証ポイントが増える
  const claimBonus = Math.min(0.2, claims * 0.015);

  return Math.min(1.0, base + claimBonus);
}

/**
 * 単独特許 vs ポートフォリオの割引係数
 * 単独特許はポートフォリオに比べて交渉力が弱い
 */
function scorePortfolioStrength(patent) {
  const family = patent.metrics?.familySize || 0;
  // family=0-1: 単独特許 (割引), 2-3: 小規模, 4+: ポートフォリオ
  if (family >= 6) return 1.0;
  if (family >= 4) return 0.85;
  if (family >= 2) return 0.70;
  return 0.55; // 単独特許は0.55に割引
}

/**
 * 品質補正係数
 * quality_multiplier = 0.6 + 0.8 × (weighted sum of 8 factors)
 */
function computeQualityMultiplier(patent) {
  const legal = scoreLegalStatus(patent);
  const term = scoreRemainingTerm(patent);
  const claim = scoreClaimStrength(patent);
  const evidence = scoreExperimentalEvidence(patent);
  const designAround = scoreDesignAroundDifficulty(patent);
  const market = scoreMarketFit(patent);
  const provability = scoreProvability(patent);
  const portfolio = scorePortfolioStrength(patent);

  const weightedSum =
    0.20 * legal +
    0.15 * term +
    0.15 * claim +
    0.10 * evidence +
    0.10 * designAround +
    0.10 * market +
    0.10 * provability +
    0.10 * portfolio;

  return {
    multiplier: 0.6 + 0.8 * weightedSum,
    factors: { legal, term, claim, evidence, designAround, market, provability, portfolio }
  };
}

function computeRoyaltyRange(patent) {
  const category = inferCategory(patent);
  const baseRange = INDUSTRY_BASE_RANGE[category] || INDUSTRY_BASE_RANGE.default;
  const { multiplier, factors } = computeQualityMultiplier(patent);

  return {
    low: baseRange[0] * multiplier,
    high: baseRange[1] * multiplier,
    category,
    multiplier,
    factors
  };
}

/**
 * 収益法 (relief-from-royalty) で可能額を推定し4区分に分類する
 *
 * license_value = target_sales × addressable_ratio × adoption_prob
 *                 × midpoint(royalty_rate) × exclusivity × enforceability
 *                 × remaining_years_factor
 */
function computeValueBracketRevenue(royaltyRange, patent) {
  const category = royaltyRange.category;
  const marketData = INDUSTRY_MARKET_DATA[category] || INDUSTRY_MARKET_DATA["ソフトウェア"];
  const midRate = (royaltyRange.low + royaltyRange.high) / 2;
  const remaining = patent.remainingYears || 0;

  // 独占性係数: ファミリーサイズと設計回避困難度に基づく
  const family = patent.metrics?.familySize || 0;
  const claims = patent.metrics?.claimCount || 0;
  const exclusivityFactor = Math.min(1.5, 0.5 + family * 0.08 + claims * 0.03);

  // 権利執行可能性: 法的状態と請求項の強さに基づく
  const legalScore = scoreLegalStatus(patent);
  const claimScore = scoreClaimStrength(patent);
  const enforceabilityFactor = 0.3 + 0.7 * (legalScore * 0.6 + claimScore * 0.4);

  // 残存年数ファクター: 将来収益の現在価値的な補正 (割引率5%)
  const discountRate = 0.05;
  const yearsToUse = Math.min(remaining, 15);
  const remainingYearsFactor = yearsToUse > 0
    ? (1 - Math.pow(1 + discountRate, -yearsToUse)) / discountRate / yearsToUse * yearsToUse
    : 0;

  const annualValue =
    marketData.marketSizeJpy *
    marketData.addressableRatio *
    marketData.adoptionProbability *
    midRate *
    exclusivityFactor *
    enforceabilityFactor;

  const totalValue = annualValue * remainingYearsFactor;

  let bracket, reason;
  if (totalValue >= 1_000_000_000) {
    bracket = "10億円以上";
    reason = `${category}分野の市場規模（約${Math.round(marketData.marketSizeJpy / 1_000_000_000_000)}兆円）に対し、技術的優位性が高く広い権利範囲を持つため、大規模なライセンス収益が見込まれます。推定ライセンス総額は約${Math.round(totalValue / 100_000_000)}億円です。`;
  } else if (totalValue >= 100_000_000) {
    bracket = "1億円以上 10億円未満";
    reason = `${category}分野において一定の技術的強みと市場適合性があり、複数のライセンス先からの収益が見込まれます。推定ライセンス総額は約${Math.round(totalValue / 10_000_000) / 10}億円です。`;
  } else if (totalValue >= 10_000_000) {
    bracket = "1,000万円以上 1億円未満";
    reason = `限定的な市場セグメントでの活用可能性があり、特定企業へのライセンスによる収益が期待できます。推定ライセンス総額は約${Math.round(totalValue / 1_000_000)}百万円です。`;
  } else {
    bracket = "1,000万円未満";
    reason = "権利範囲や残存年数に課題があり、収益化には追加的な戦略が必要です。";
  }

  return {
    bracket,
    reason,
    estimatedValue: Math.round(totalValue),
    method: "revenue",
    components: {
      marketSizeJpy: marketData.marketSizeJpy,
      addressableRatio: marketData.addressableRatio,
      adoptionProbability: marketData.adoptionProbability,
      midRoyaltyRate: midRate,
      exclusivityFactor: Math.round(exclusivityFactor * 1000) / 1000,
      enforceabilityFactor: Math.round(enforceabilityFactor * 1000) / 1000,
      remainingYearsFactor: Math.round(remainingYearsFactor * 100) / 100,
      annualValue: Math.round(annualValue),
      yearsUsed: yearsToUse
    }
  };
}

/**
 * カテゴリ + タイトル/請求項キーワードでフィールド別スコアを算出
 */
function scoreLicenseableFields(patent, royaltyRange) {
  const category = royaltyRange.category;
  const fields = CATEGORY_FIELDS[category] || CATEGORY_FIELDS["ソフトウェア"];
  const text = [
    patent.title || "",
    patent.claimsText || "",
    patent.descriptionText || "",
    patent.ipcClassification || ""
  ].join(" ");

  return fields.map(({ field, baseScore, keywords }) => {
    let score = baseScore;
    // キーワードマッチでスコア加算
    if (keywords.test(text)) {
      score = Math.min(0.95, score + 0.15);
    }
    // IPC分類が複数ある場合にスコア加算
    if (patent.ipcCodes && patent.ipcCodes.length > 2) {
      score = Math.min(0.95, score + 0.05);
    }

    const reason = keywords.test(text)
      ? `${field}に関連する技術用語が明細書に含まれ、IPC分類${patent.ipcClassification || "-"}と整合`
      : `${category}分野の関連領域として推定`;

    return {
      field,
      score: Math.round(score * 100) / 100,
      reason
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * 明細書テキストからルールベースで強みの軸を判定する
 * LLMの回答がある場合はそちらで上書きされる
 */
function evaluateStrengthAxes(patent) {
  const text = [
    patent.title || "",
    patent.claimsText || "",
    patent.descriptionText || ""
  ].join(" ");

  return STRENGTH_AXES.map(({ key, label, keywords }) => {
    const hasMatch = keywords.test(text);
    // 数値表現の有無をチェック (比較例・実施例の根拠)
    const hasNumericEvidence = hasMatch && /\d+[%％倍]|比較例|実施例\d/.test(text);

    let level, confidence;
    if (hasNumericEvidence) {
      level = "高";
      confidence = 0.80;
    } else if (hasMatch) {
      level = "中";
      confidence = 0.55;
    } else {
      level = null;
      confidence = 0;
    }

    return level ? {
      axis: label,
      level,
      basis: hasNumericEvidence
        ? `明細書に数値的根拠あり（比較例/実施例）`
        : `明細書に関連する記述あり（推測）`,
      confidence: Math.round(confidence * 100) / 100,
      hasEvidence: hasNumericEvidence
    } : null;
  }).filter(Boolean);
}

/**
 * 各収益化手段を0-1のスコアで評価する
 */
function scoreMonetizationMethods(patent, royaltyRange) {
  const legal = scoreLegalStatus(patent);
  const claims = patent.metrics?.claimCount || 0;
  const remaining = patent.remainingYears || 0;
  const citations = patent.metrics?.citations || 0;
  const family = patent.metrics?.familySize || 0;
  const players = patent.metrics?.marketPlayers || 0;
  const provability = scoreProvability(patent);

  const methods = [
    {
      type: "ライセンス",
      score: Math.min(0.95, legal * 0.25 + Math.min(1, remaining / 15) * 0.20 + Math.min(1, players / 20) * 0.20 + Math.min(1, claims / 10) * 0.15 + provability * 0.20),
      reason: legal >= 0.8 && remaining >= 5
        ? `権利が有効（残存${remaining.toFixed(1)}年）で市場プレイヤーも${players}社あり、ライセンス付与が最も有望です。`
        : `ライセンス付与の可能性を検討する価値があります。`
    },
    {
      type: "売却",
      score: Math.min(0.95, legal * 0.35 + Math.min(1, claims / 15) * 0.3 + Math.min(1, family / 5) * 0.2 + Math.min(1, citations / 10) * 0.15),
      reason: legal >= 0.8 && claims >= 5
        ? `請求項${claims}件と有効な権利状態により、売却も有力な選択肢です。`
        : `売却よりもライセンスを優先することを推奨します。`
    },
    {
      type: "製品・サービス化",
      score: Math.min(0.95, Math.min(1, remaining / 15) * 0.35 + Math.min(1, claims / 10) * 0.25 + legal * 0.2 + Math.min(1, players / 20) * 0.2),
      reason: remaining >= 10
        ? `残存年数が長く、製品・サービス化による直接的な収益化も検討できます。`
        : `製品化の検討にあたっては市場調査が必要です。`
    },
    {
      type: "共同開発・事業",
      score: Math.min(0.95, Math.min(1, claims / 10) * 0.3 + Math.min(1, remaining / 15) * 0.25 + Math.min(1, players / 20) * 0.25 + Math.min(1, family / 5) * 0.2),
      reason: claims >= 5
        ? `請求項の広さを活かした共同開発が有望です。`
        : `共同開発パートナーの探索から始めることを推奨します。`
    },
    {
      type: "訴訟",
      // 訴訟は条件が揃わない限り低く抑える。実施立証容易さが大きく効く。
      score: Math.min(0.75,
        (citations >= 5 ? 0.12 : 0) +
        (claims >= 10 ? 0.12 : 0) +
        (legal >= 1.0 ? 0.12 : 0) +
        (family >= 3 ? 0.08 : 0) +
        (players >= 15 ? 0.08 : 0) +
        provability * 0.25
      ),
      reason: provability >= 0.6 && citations >= 5 && claims >= 10 && legal >= 1.0
        ? `一定の条件が揃っていますが、訴訟による権利行使はコストとリスクを慎重に評価する必要があります。`
        : provability < 0.5
          ? `制御ロジック・アルゴリズム系の発明であり、侵害立証にはリバースエンジニアリングが必要なため訴訟難度が高く、他の手段を優先することを推奨します。`
          : `訴訟リスクとコストを慎重に評価する必要があります。専門家への相談を推奨します。`
    }
  ];

  // スコア順にソート
  return methods
    .map(m => ({ ...m, score: Math.round(m.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 上位の収益化手段に連動して推奨アクションを生成する
 */
function computeNextActions(monetizationMethods, patent) {
  const topMethod = monetizationMethods[0]?.type;
  const category = patent.category || "ソフトウェア";

  // アクション候補プール
  const actionPool = {
    "ライセンス": [
      { action: "ライセンス候補先の探索", priority: 1, reason: `${category}分野で${patent.title || "当該技術"}に関連する技術を利用している企業のリストアップから始める。` },
      { action: "ライセンスオファーレターの送付", priority: 2, reason: "候補先が特定できたら、特許の概要と提案条件をまとめたオファーレターを作成・送付する。" },
      { action: "弁理士・弁護士への相談", priority: 3, reason: "権利範囲の確認と交渉戦略の策定について、特許に詳しい弁理士または弁護士に相談する。" }
    ],
    "売却": [
      { action: "譲渡候補先の探索", priority: 1, reason: "特許売買プラットフォームや知財取引業者を通じて、買い手候補を探索する。" },
      { action: "知財取引業者・弁理士への相談", priority: 2, reason: "譲渡価格の査定と交渉について専門家に相談する。" },
      { action: "特許ポートフォリオの整理", priority: 3, reason: "関連特許がある場合はパッケージ化して売却することで価値を高める。" }
    ],
    "製品・サービス化": [
      { action: "市場調査・事業計画の策定", priority: 1, reason: "製品・サービス化の事業性を検討するため、市場調査と事業計画を策定する。" },
      { action: "開発業者への相談", priority: 2, reason: "技術的な実現可能性と開発コストについて開発業者に相談する。" },
      { action: "資金調達・パートナー探索", priority: 3, reason: "事業化に必要な資金やパートナーの獲得を検討する。" }
    ],
    "共同開発・事業": [
      { action: "共同開発パートナーの探索", priority: 1, reason: "オープンイノベーションプログラムや技術展示会を通じてパートナーを探索する。" },
      { action: "オープンイノベーションの提案", priority: 2, reason: "技術の応用範囲を広げるため、複数企業とのオープンイノベーションを提案する。" },
      { action: "弁理士・弁護士への相談", priority: 3, reason: "共同開発契約の条件設計について専門家に相談する。" }
    ],
    "訴訟": [
      { action: "侵害調査の実施", priority: 1, reason: "クレームチャートを作成し、侵害の蓋然性を確認する。" },
      { action: "弁護士（知財訴訟専門）への相談", priority: 2, reason: "訴訟のコスト・リスク・期待利益について知財訴訟専門の弁護士に相談する。" },
      { action: "和解・ライセンス交渉の検討", priority: 3, reason: "訴訟前に和解やライセンス交渉で解決できないか検討する。" }
    ]
  };

  const primary = actionPool[topMethod] || actionPool["ライセンス"];

  // 上位2つの方法のアクションを組み合わせ (重複除去)
  const secondMethod = monetizationMethods[1]?.type;
  const secondary = secondMethod && secondMethod !== topMethod
    ? (actionPool[secondMethod] || []).slice(0, 1)
    : [];

  const allActions = [...primary];
  for (const act of secondary) {
    if (!allActions.find(a => a.action === act.action)) {
      allActions.push({ ...act, priority: allActions.length + 1 });
    }
  }

  return allActions.slice(0, 4);
}

function computeScoresAndRank(patent, royaltyRange) {
  const { factors } = computeQualityMultiplier(patent);

  const scores = {
    impact: Math.round(factors.evidence * 100),
    breadth: Math.round((factors.claim * 0.6 + factors.designAround * 0.4) * 100),
    strength: Math.round(factors.legal * 100),
    monetization: Math.round((factors.market * 0.5 + factors.term * 0.5) * 100)
  };
  scores.total = Math.round((scores.impact + scores.breadth + scores.strength + scores.monetization) / 4);

  let rank;
  if (scores.total >= 75) rank = "A";
  else if (scores.total >= 55) rank = "B";
  else if (scores.total >= 35) rank = "C";
  else rank = "D";

  return { scores, rank };
}

module.exports = {
  inferCategory,
  scoreLegalStatus,
  scoreRemainingTerm,
  scoreClaimStrength,
  scoreExperimentalEvidence,
  scoreDesignAroundDifficulty,
  scoreMarketFit,
  scoreProvability,
  scorePortfolioStrength,
  computeQualityMultiplier,
  computeRoyaltyRange,
  computeValueBracketRevenue,
  scoreLicenseableFields,
  evaluateStrengthAxes,
  scoreMonetizationMethods,
  computeNextActions,
  computeScoresAndRank
};
