/**
 * リード詳細画面ロジック
 */

const leadId = new URLSearchParams(window.location.search).get("id");
let currentLead = null;

(async () => {
  if (!(await checkAuth())) { window.location.href = "/admin/index.html"; return; }
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  document.getElementById("userEmail").textContent = session?.user?.email || "";

  if (!leadId) { document.getElementById("leadInfo").textContent = "IDが指定されていません"; return; }
  await loadDetail();
})();

async function loadDetail() {
  try {
    const data = await adminFetch(`/api/admin/leads/${leadId}`);
    currentLead = data.lead;
    renderLead(data.lead);
    renderPatents(data.patents);
    renderRegistrations(data.registrations);
  } catch (err) {
    document.getElementById("leadInfo").textContent = "読み込みに失敗しました";
  }
}

function renderLead(lead) {
  document.getElementById("leadInfo").innerHTML = `
    <div class="field"><div class="label">氏名</div><div class="value">${escapeHtml(lead.name)}</div></div>
    <div class="field"><div class="label">企業</div><div class="value">${escapeHtml(lead.company_name)}</div></div>
    <div class="field"><div class="label">メール</div><div class="value"><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></div></div>
    <div class="field"><div class="label">ステータス</div><div class="value">${badgeHtml(lead.status)}</div></div>
    <div class="field"><div class="label">流入元</div><div class="value">${escapeHtml(lead.source || "-")}</div></div>
    <div class="field"><div class="label">登録日時</div><div class="value">${formatDate(lead.created_at)}</div></div>
  `;
  document.getElementById("statusSelect").value = lead.status || "created";
  document.getElementById("adminNotes").value = lead.admin_notes || "";
}

function renderPatents(patents) {
  if (!patents || patents.length === 0) {
    document.getElementById("patentInfo").textContent = "特許情報なし";
    return;
  }

  let html = "";
  for (const p of patents) {
    const diag = p.diagnosis_result || {};
    const score = diag.scores?.total;
    const scoreClass = score >= 70 ? "score-high" : score >= 40 ? "score-mid" : "score-low";
    const valueRange = diag.valueRange || "";

    html += `
      <div style="margin-bottom:16px; padding-bottom:16px; border-bottom: 1px solid var(--line);">
        <div class="field"><div class="label">特許番号</div><div class="value"><strong>${escapeHtml(p.patent_number)}</strong></div></div>
        <div class="field"><div class="label">タイトル</div><div class="value">${escapeHtml(p.title || "-")}</div></div>
        <div class="field"><div class="label">出願人</div><div class="value">${escapeHtml(p.applicant || "-")}</div></div>
        <div class="field"><div class="label">カテゴリ</div><div class="value">${escapeHtml(p.category || "-")}</div></div>
        <div class="field"><div class="label">権利状態</div><div class="value">${escapeHtml(p.status || "-")}</div></div>
        ${score != null ? `<div class="field"><div class="label">スコア</div><div class="value"><span class="score-badge ${scoreClass}">${score}点</span></div></div>` : ""}
        ${valueRange ? `<div class="field"><div class="label">価値レンジ</div><div class="value">${escapeHtml(valueRange)}</div></div>` : ""}
      </div>
    `;
  }
  document.getElementById("patentInfo").innerHTML = html;
}

function renderRegistrations(regs) {
  if (!regs || regs.length === 0) {
    document.getElementById("regInfo").textContent = "詳細登録なし";
    return;
  }

  let html = "";
  for (const r of regs) {
    html += `
      <div style="margin-bottom:12px; padding-bottom:12px; border-bottom: 1px solid var(--line);">
        <div class="field"><div class="label">種別</div><div class="value">${escapeHtml(r.type)}</div></div>
        <div class="field"><div class="label">ステータス</div><div class="value">${badgeHtml(r.status)}</div></div>
        ${r.contact_name ? `<div class="field"><div class="label">担当者</div><div class="value">${escapeHtml(r.contact_name)}</div></div>` : ""}
        ${r.phone ? `<div class="field"><div class="label">電話</div><div class="value">${escapeHtml(r.phone)}</div></div>` : ""}
        ${r.desired_price ? `<div class="field"><div class="label">希望価格</div><div class="value">${escapeHtml(r.desired_price)}</div></div>` : ""}
        ${r.support_method ? `<div class="field"><div class="label">サポート方法</div><div class="value">${escapeHtml(r.support_method)}</div></div>` : ""}
        ${r.message ? `<div class="field"><div class="label">メッセージ</div><div class="value">${escapeHtml(r.message)}</div></div>` : ""}
        <div class="field"><div class="label">登録日時</div><div class="value">${formatDate(r.created_at)}</div></div>
      </div>
    `;
  }
  document.getElementById("regInfo").innerHTML = html;
}

async function updateStatus() {
  const status = document.getElementById("statusSelect").value;
  try {
    await adminFetch(`/api/admin/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadDetail();
  } catch (err) {
    alert("更新に失敗しました");
  }
}

async function saveNotes() {
  const notes = document.getElementById("adminNotes").value;
  try {
    await adminFetch(`/api/admin/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ admin_notes: notes })
    });
    alert("メモを保存しました");
  } catch (err) {
    alert("保存に失敗しました");
  }
}
