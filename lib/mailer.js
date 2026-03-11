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

function buildResultEmailHtml(data) {
  const { patent, scores, valueRange, route, rank, rankMessage } = data;

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
    <p style="margin:0 0 4px;font-size:11px;font-weight:400;color:#33478e;letter-spacing:0.08em;text-transform:uppercase;">Patent Value Check</p>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#33478e;line-height:1.4;">特許の簡易評価結果をお届けします</h1>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.7;">以下は、ご入力いただいた特許に対する簡易評価の結果です。</p>
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
          </table>
        </div>
      </td>
      <td style="width:50%;padding-left:8px;vertical-align:top;">
        <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:20px;height:100%;">
          <p style="margin:0 0 2px;font-size:11px;color:#6b7a99;letter-spacing:0.04em;">推定価値レンジ</p>
          <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#33478e;line-height:1.3;">${yenLabel(valueRange.low)}<br /><span style="font-size:13px;font-weight:400;color:#6b7a99;">〜</span> ${yenLabel(valueRange.high)}</p>
          <p style="margin:0 0 10px;font-size:12px;color:#6b7a99;">信頼度: <strong style="color:#333;">${valueRange.confidence}</strong></p>
          <div style="border-top:1px solid #e8ecf5;padding-top:10px;margin-top:4px;">
            <p style="margin:0 0 2px;font-size:11px;color:#6b7a99;">推奨手段</p>
            <p style="margin:0;font-size:14px;font-weight:700;color:#33478e;">${route.title}</p>
          </div>
        </div>
      </td>
    </tr>
  </table>

  <!-- Next Steps -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:24px;margin-bottom:16px;">
    <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#33478e;">次のステップ</h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;">
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">1</div>
        </td>
        <td style="padding:0 0 14px 8px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#333;">PatentRevenueに無料登録</p>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7a99;line-height:1.6;">診断結果を引き継いで、詳細分析・買い手探索に進めます。</p>
        </td>
      </tr>
      <tr>
        <td style="width:32px;vertical-align:top;padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#dee7f9;color:#33478e;font-size:13px;font-weight:700;text-align:center;line-height:24px;">2</div>
        </td>
        <td style="padding:0 0 14px 8px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#333;">専門家による精密評価</p>
          <p style="margin:2px 0 0;font-size:13px;color:#6b7a99;line-height:1.6;">知財戦略の専門家が市場調査と合わせて精密な評価を行います。</p>
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

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:16px;">
    <a href="https://patent-revenue.iprich.jp/#licence" style="display:inline-block;padding:16px 48px;background:#33478e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.04em;box-shadow:0 2px 8px rgba(51,71,142,0.3);">無料で登録して詳細を確認する</a>
    <p style="margin:10px 0 0;font-size:12px;color:#6b7a99;">登録・相談無料 / 成約時のみ15%</p>
  </div>

  <!-- Disclaimer -->
  <div style="background:#f5f6fa;border-radius:8px;padding:16px 20px;margin-bottom:16px;border-left:3px solid #33478e;">
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.7;">本診断は公開情報にもとづく概算です。取引価格や成約を保証するものではありません。精密な評価は登録後に専門家が対応します。</p>
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
    このメールは Patent Value Check の診断結果送信リクエストにより送信されました。<br />
    &copy; ${new Date().getFullYear()} iprich Inc.
  </p>
</div>

</body>
</html>`;
}

function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn("[mailer] RESEND_API_KEY not set, skipping email send");
    return Promise.resolve({ id: "dev-skip", message: "No API key configured" });
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject,
      html
    });

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

module.exports = { sendResultEmail };
