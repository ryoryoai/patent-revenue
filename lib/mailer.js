const https = require("https");

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "noreply@patent-revenue.iprich.jp";

function yenLabel(value) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億円`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ja-JP")}万円`;
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function scoreBar(value) {
  const pct = Math.max(0, Math.min(100, value));
  return `<div style="background:#e8ecf5;border-radius:4px;height:8px;width:100%;margin-top:4px;">
    <div style="background:#33478e;border-radius:4px;height:8px;width:${pct}%;"></div>
  </div>`;
}

function rankDefinition(rank) {
  const defs = {
    S: "市場インパクトが極めて高く、即座にライセンス交渉や売却が見込める最上位特許です。",
    A: "高い収益化ポテンシャルを持ち、戦略的に活用すれば大きな価値を生む特許です。",
    B: "一定の市場価値があり、適切な戦略で収益化が期待できる特許です。",
    C: "市場ニーズとのマッチング次第で価値が変わる特許です。活用方法の見直しが推奨されます。",
    D: "現状では収益化が難しいですが、技術動向の変化により価値が上がる可能性があります。"
  };
  return defs[rank] || defs.C;
}

function buildResultEmailHtml(data) {
  const { rank, name } = data;

  const rankLabels = {
    A: "ライセンス・売却できる可能性がとても高い",
    B: "ライセンス・売却できる可能性が高い",
    C: "ライセンス・売却できる可能性がある",
    D: "ライセンス・売却できる可能性が低い"
  };

  const currentRankLabel = rankLabels[rank] || rankLabels.C;

  const rankListHtml = Object.entries(rankLabels).map(([r, label]) => {
    const isCurrent = r === rank;
    return `<tr>
      <td style="padding:6px 12px;font-size:14px;font-weight:700;color:${isCurrent ? "#ffffff" : "#33478e"};background:${isCurrent ? "#33478e" : "transparent"};border-radius:4px;width:60px;text-align:center;">ランク${r}</td>
      <td style="padding:6px 12px;font-size:14px;color:${isCurrent ? "#33478e" : "#555"};font-weight:${isCurrent ? "700" : "400"};">${label}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>特許の簡易評価結果</title>
</head>
<body style="margin:0;padding:0;background:#dee7f9;font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;-webkit-font-smoothing:antialiased;">

<!-- Header -->
<div style="background:#33478e;padding:20px 0;text-align:center;">
  <table align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    <tr>
      <td style="padding:0 24px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">PatentRevenue</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.04em;">知財を収益に変える</p>
      </td>
    </tr>
  </table>
</div>

<!-- Main Content -->
<div style="max-width:600px;margin:0 auto;padding:24px 16px 40px;">

  <!-- Greeting -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.8;">${name ? `${name} 様` : "お客様"}</p>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.8;">特許売買・ライセンスプラットフォーム「PatentRevenue」をご利用いただき、誠にありがとうございます。</p>
    <p style="margin:8px 0 0;font-size:14px;color:#555;line-height:1.8;">ご入力いただいた情報に基づき、特許の簡易評価を行いました。結果は以下の通りです。</p>
  </div>

  <!-- Evaluation Result -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <h2 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#33478e;">簡易評価結果</h2>

    <div style="background:linear-gradient(155deg,#ffffff 0%,#e8f0fe 50%,#d8ffff 100%);border-radius:8px;border:1px solid rgba(51,71,142,0.2);padding:24px;margin-bottom:20px;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7a99;">評価</p>
      <p style="margin:0 0 8px;font-size:36px;font-weight:700;color:#33478e;letter-spacing:2px;">ランク ${rank}</p>
      <p style="margin:0;font-size:15px;color:#33478e;font-weight:500;">${currentRankLabel}</p>
    </div>

    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${rankListHtml}
    </table>
  </div>

  <!-- Next Steps -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#33478e;">次のステップのご案内</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.8;">現在、より詳細な分析を行った「詳細評価レポート」を提供しております。</p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.8;">詳細評価レポートの作成をご希望の場合は、以下の手順にてお手続きをお願いいたします。</p>

    <div style="background:#f5f6fa;border-radius:6px;padding:14px 16px;margin-bottom:20px;">
      <p style="margin:0;font-size:13px;color:#6b7a99;line-height:1.7;">※詳細評価レポートの申請には、PatentRevenueへの特許の登録（特許情報の公開）が必須となります。あらかじめご了承ください。</p>
    </div>

    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">1</div>
        </td>
        <td style="padding:0 0 16px 8px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#333;">特許の登録はこちら</p>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7a99;line-height:1.6;">PatentRevenueに特許情報を登録してください。</p>
          <a href="https://patent-revenue.iprich.jp/#licence" style="display:inline-block;padding:10px 24px;background:#33478e;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;">特許を登録する</a>
        </td>
      </tr>
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">2</div>
        </td>
        <td style="padding:0 0 0 8px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#333;">詳細評価レポートの申請はこちら</p>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7a99;line-height:1.6;">特許登録が完了しましたら、詳細レポートをお申し込みください。</p>
          <a href="https://patent-revenue.iprich.jp/request-report.html" style="display:inline-block;padding:10px 24px;background:#33478e;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700;">詳細レポートを申請する</a>
        </td>
      </tr>
    </table>
  </div>

  <!-- Disclaimer -->
  <div style="background:#f5f6fa;border-radius:8px;padding:16px 20px;margin-bottom:16px;border-left:3px solid #33478e;">
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.7;">本診断は公開情報にもとづく概算です。取引価格や成約を保証するものではありません。</p>
  </div>

</div>

<!-- Footer -->
<div style="background:#1f266b;padding:28px 16px;text-align:center;">
  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">PatentRevenue</p>
  <p style="margin:0 0 12px;font-size:11px;color:rgba(255,255,255,0.6);">知財を収益に変える</p>
  <table align="center" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:0 10px;"><a href="https://patent-revenue.iprich.jp/" style="font-size:12px;color:rgba(255,255,255,0.7);text-decoration:none;">サービス概要</a></td>
      <td style="padding:0 10px;border-left:1px solid rgba(255,255,255,0.2);"><a href="https://patent-revenue.iprich.jp/privacy" style="font-size:12px;color:rgba(255,255,255,0.7);text-decoration:none;">プライバシーポリシー</a></td>
    </tr>
  </table>
  <p style="margin:16px 0 0;font-size:11px;color:rgba(255,255,255,0.4);">
    このメールは PatentRevenue の簡易評価結果送信リクエストにより送信されました。<br />
    &copy; ${new Date().getFullYear()} iprich Inc.
  </p>
</div>

</body>
</html>`;
}

function buildDetailedReportEmailHtml(data, senderName) {
  const { patent, scores, valueRange, route, rank, rankMessage, report } = data;

  // monetizationMethods / nextSteps がobject型の場合はフラット化
  const formatMethods = (m) => {
    if (typeof m === "string") return m;
    if (!m || typeof m !== "object") return "-";
    return [
      m.license && `【ライセンス】${m.license}`,
      m.sale && `【売却】${m.sale}`,
      m.litigation && `【訴訟】${m.litigation}`,
      m.productization && `【製品・サービス化】${m.productization}`,
      m.jointDevelopment && `【共同開発・事業】${m.jointDevelopment}`
    ].filter(Boolean).join("\n");
  };
  const formatSteps = (s) => {
    if (typeof s === "string") return s;
    if (!s || typeof s !== "object") return "-";
    return [
      s.candidateSearch && `1. ライセンス・売却候補先の探索: ${s.candidateSearch}`,
      s.offerLetter && `2. オファーレターの送付: ${s.offerLetter}`,
      s.legalConsultation && `3. 弁理士/弁護士への相談: ${s.legalConsultation}`,
      s.developerConsultation && `4. 開発業者への相談: ${s.developerConsultation}`,
      s.openInnovation && `5. オープンイノベーション: ${s.openInnovation}`
    ].filter(Boolean).join("\n");
  };

  const reportSections = [
    { label: "発明の概要", value: report.summary },
    { label: "発明の強み・優位性", value: report.strengths },
    { label: "ライセンス可能な産業・技術分野", value: report.licensableFields },
    { label: "想定されるライセンス料率", value: report.royaltyRate },
    { label: "ライセンス可能額の目安", value: report.valueBracket + (report.valueBracketReason ? `\n${report.valueBracketReason}` : "") },
    { label: "収益化手段", value: formatMethods(report.monetizationMethods) },
    { label: "次の一手（推奨アクション）", value: formatSteps(report.nextSteps) }
  ];

  const scoreItems = [
    { label: "影響度", value: scores.impact },
    { label: "権利の広さ", value: scores.breadth },
    { label: "実務上の強さ", value: scores.strength },
    { label: "収益化の近さ", value: scores.monetization }
  ];

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>特許の詳細評価レポート</title>
</head>
<body style="margin:0;padding:0;background:#dee7f9;font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;-webkit-font-smoothing:antialiased;">

<!-- Header -->
<div style="background:#33478e;padding:20px 0;text-align:center;">
  <table align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    <tr>
      <td style="padding:0 24px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">PatentRevenue</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.04em;">知財を収益に変える</p>
      </td>
    </tr>
  </table>
</div>

<!-- Main Content -->
<div style="max-width:600px;margin:0 auto;padding:24px 16px 40px;">

  <!-- Greeting -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.8;">${data.name ? `${data.name} 様` : "お客様"}</p>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.8;">PatentRevenueへの特許登録、および詳細評価へのお申し込みをいただき、誠にありがとうございます。</p>
    <p style="margin:8px 0 0;font-size:14px;color:#555;line-height:1.8;">ご依頼いただいておりました詳細評価レポートが完成いたしましたので、以下にてお届けいたします。</p>
  </div>

  <!-- Score Card -->
  <div style="background:linear-gradient(155deg,#ffffff 0%,#e8f0fe 50%,#d8ffff 100%);border-radius:8px;border:1px solid rgba(51,71,142,0.2);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#6b7a99;letter-spacing:0.06em;text-transform:uppercase;">総合スコア</p>
    <p style="margin:8px 0 4px;font-size:56px;font-weight:700;color:#33478e;line-height:1;letter-spacing:-2px;">${scores.total}</p>
    <table align="center" cellpadding="0" cellspacing="0" style="margin:8px auto 0;">
      <tr>
        <td style="background:#33478e;color:#fff;font-size:14px;font-weight:700;padding:5px 16px;border-radius:4px;letter-spacing:0.05em;">ランク ${rank}</td>
      </tr>
    </table>
    <p style="margin:10px 0 0;font-size:14px;color:#33478e;font-weight:400;">${rankMessage}</p>
    <p style="margin:12px 0 0;font-size:13px;color:#555;line-height:1.6;text-align:left;background:#f5f6fa;border-radius:6px;padding:12px 16px;">${rankDefinition(rank)}</p>
  </div>

  <!-- 4-Axis Scores -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:24px;margin-bottom:16px;">
    <h2 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#33478e;">評価の4軸スコア</h2>
    ${scoreItems.map((item) => `
    <div style="margin-bottom:14px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        <tr>
          <td style="font-size:13px;color:#555;font-weight:400;">${item.label}</td>
          <td style="text-align:right;font-size:14px;font-weight:700;color:#33478e;">${item.value}<span style="font-size:11px;color:#6b7a99;font-weight:400;"> / 100</span></td>
        </tr>
      </table>
      ${scoreBar(item.value)}
    </div>`).join("")}
  </div>

  <!-- Patent Info + Value Range -->
  <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
    <tr>
      <td style="width:50%;padding-right:8px;vertical-align:top;">
        <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:20px;height:100%;">
          <p style="margin:0 0 2px;font-size:11px;color:#6b7a99;letter-spacing:0.04em;">対象特許</p>
          <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#333;line-height:1.4;">${patent.title}</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:12px;color:#6b7a99;">
            <tr><td style="padding:3px 0;">特許番号</td><td style="text-align:right;color:#333;">${patent.id}</td></tr>
            <tr><td style="padding:3px 0;">カテゴリ</td><td style="text-align:right;color:#333;">${patent.category}</td></tr>
            <tr><td style="padding:3px 0;">出願日</td><td style="text-align:right;color:#333;">${patent.filingDate}</td></tr>
            <tr><td style="padding:3px 0;">出願人</td><td style="text-align:right;color:#333;">${patent.applicant}</td></tr>
          </table>
        </div>
      </td>
      <td style="width:50%;padding-left:8px;vertical-align:top;">
        <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:20px;height:100%;">
          <p style="margin:0 0 2px;font-size:11px;color:#6b7a99;letter-spacing:0.04em;">推定価値レンジ</p>
          <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#33478e;line-height:1.3;">${yenLabel(valueRange.low)}<br /><span style="font-size:13px;font-weight:400;color:#6b7a99;">〜</span> ${yenLabel(valueRange.high)}</p>
          <p style="margin:0 0 10px;font-size:12px;color:#6b7a99;">信頼度: <strong style="color:#333;">${valueRange.confidence || "中"}</strong></p>
          <div style="border-top:1px solid #e8ecf5;padding-top:10px;margin-top:4px;">
            <p style="margin:0 0 2px;font-size:11px;color:#6b7a99;">推奨手段</p>
            <p style="margin:0;font-size:14px;font-weight:700;color:#33478e;">${route.title}</p>
          </div>
        </div>
      </td>
    </tr>
  </table>

  <!-- Detailed Report Sections -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:24px;margin-bottom:16px;">
    <h2 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#33478e;">詳細評価レポート</h2>
    ${reportSections.map((section) => `
    <div style="margin-bottom:20px;border-bottom:1px solid #e8ecf5;padding-bottom:16px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#33478e;letter-spacing:0.04em;">${section.label}</p>
      <p style="margin:0;font-size:14px;color:#333;line-height:1.8;">${String(section.value || "").replace(/\n/g, "<br />")}</p>
    </div>`).join("")}
  </div>

  <!-- Next Steps -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:24px;margin-bottom:16px;">
    <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#33478e;">収益化に向けた次のステップ</h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">1</div>
        </td>
        <td style="padding:0 0 14px 8px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#333;">専門家による精密評価</p>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7a99;line-height:1.6;">知財戦略の専門家が市場調査と合わせて精密な評価を行います。</p>
        </td>
      </tr>
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">2</div>
        </td>
        <td style="padding:0 0 14px 8px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#333;">買い手・ライセンシー候補のマッチング</p>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7a99;line-height:1.6;">レポートに基づき、最適な相手先を探索・提案します。</p>
        </td>
      </tr>
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">3</div>
        </td>
        <td style="padding:0 0 0 8px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#333;">交渉・成約サポート</p>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7a99;line-height:1.6;">買い手候補への打診から契約締結まで、専門チームが伴走します。</p>
        </td>
      </tr>
    </table>
  </div>

  <!-- Closing -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <p style="margin:0 0 12px;font-size:14px;color:#555;line-height:1.8;">本レポートが、${data.name ? `${data.name} 様` : "お客様"}の保有される特許資産の有効活用の一助となれば幸いです。</p>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.8;">今後ともPatentRevenueをよろしくお願い申し上げます。</p>
  </div>

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:16px;">
    <a href="https://patent-revenue.iprich.jp/dashboard" style="display:inline-block;padding:16px 48px;background:#33478e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.04em;box-shadow:0 2px 8px rgba(51,71,142,0.3);">ダッシュボードで詳細を確認する</a>
  </div>

  <!-- Disclaimer -->
  <div style="background:#f5f6fa;border-radius:8px;padding:16px 20px;margin-bottom:16px;border-left:3px solid #33478e;">
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.7;">本レポートはAIによる推定を含む概算評価です。取引価格や成約を保証するものではありません。本レポートの内容についての具体的なご質問やご相談には対応できない場合がございます。精密な評価は専門家が別途対応いたします。</p>
  </div>

</div>

<!-- Footer -->
<div style="background:#1f266b;padding:28px 16px;text-align:center;">
  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">PatentRevenue</p>
  <p style="margin:0 0 12px;font-size:11px;color:rgba(255,255,255,0.6);">知財を収益に変える</p>
  <table align="center" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:0 10px;"><a href="https://patent-revenue.iprich.jp/" style="font-size:12px;color:rgba(255,255,255,0.7);text-decoration:none;">サービス概要</a></td>
      <td style="padding:0 10px;border-left:1px solid rgba(255,255,255,0.2);"><a href="https://patent-revenue.iprich.jp/privacy" style="font-size:12px;color:rgba(255,255,255,0.7);text-decoration:none;">プライバシーポリシー</a></td>
    </tr>
  </table>
  <p style="margin:16px 0 0;font-size:11px;color:rgba(255,255,255,0.4);">
    このメールは PatentRevenue の詳細評価レポート送付リクエストにより送信されました。<br />
    &copy; ${new Date().getFullYear()} iprich Inc.
  </p>
</div>

</body>
</html>`;
}

function sendEmail({ to, subject, html, attachments }) {
  if (!RESEND_API_KEY) {
    console.warn("[mailer] RESEND_API_KEY not set, skipping email send");
    return Promise.resolve({ id: "dev-skip", message: "No API key configured" });
  }

  return new Promise((resolve, reject) => {
    const payload = {
      from: MAIL_FROM,
      to: [to],
      subject,
      html
    };
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }
    const body = JSON.stringify(payload);

    const options = {
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("email_timeout"));
    }, 10000);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || `Resend API error: ${res.statusCode}`));
          }
        } catch (error) {
          reject(new Error("email_parse_error"));
        }
      });
    });

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    req.write(body);
    req.end();
  });
}

async function sendResultEmail({ email, name, reportData }) {
  const html = buildResultEmailHtml(reportData);
  const subject = "【PatentRevenue】特許の簡易評価結果のお知らせ";
  return sendEmail({ to: email, subject, html });
}

async function sendDetailedReportEmail({ email, name, reportData }) {
  const dataWithName = { ...reportData, name };
  const html = buildDetailedReportEmailHtml(dataWithName);
  const subject = "【PatentRevenue】特許の詳細評価レポートのご送付";

  // PDF生成・添付
  let attachments;
  try {
    const { generateReportPdf } = require("./pdf-report");
    const pdfBuffer = await generateReportPdf(dataWithName);
    const patentId = reportData.patent?.id || "report";
    attachments = [{
      filename: `PatentRevenue_詳細評価レポート_${patentId}.pdf`,
      content: pdfBuffer.toString("base64")
    }];
    console.log(`[mailer] PDF generated: ${pdfBuffer.length} bytes`);
  } catch (err) {
    console.warn("[mailer] PDF generation failed, sending without attachment:", err.message);
  }

  return sendEmail({ to: email, subject, html, attachments });
}

module.exports = { sendResultEmail, sendDetailedReportEmail };
