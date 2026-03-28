/**
 * ダッシュボード画面ロジック
 */

let leadsOffset = 0;
const LEADS_LIMIT = 50;

// Auth check
(async () => {
  if (!(await checkAuth())) { window.location.href = "/admin/index.html"; return; }
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  document.getElementById("userEmail").textContent = session?.user?.email || "";
  await Promise.all([loadStats(), loadLeads(), loadRegistrations(), loadInquiries()]);
})();

// Tabs
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => (c.style.display = "none"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";
  });
});

// Filters
document.getElementById("leadStatusFilter").addEventListener("change", () => { leadsOffset = 0; loadLeads(); });
document.getElementById("leadSearch").addEventListener("input", debounce(() => { leadsOffset = 0; loadLeads(); }, 400));
document.getElementById("regStatusFilter").addEventListener("change", loadRegistrations);
document.getElementById("inqStatusFilter").addEventListener("change", loadInquiries);

async function loadStats() {
  try {
    const data = await adminFetch("/api/admin/stats");
    document.getElementById("statTotal").textContent = data.totalLeads;
    document.getElementById("statToday").textContent = data.newToday;
    document.getElementById("statPending").textContent = data.pendingRegistrations;
    document.getElementById("statInquiries").textContent = data.newInquiries;
  } catch { /* ignore */ }
}

async function loadLeads() {
  const status = document.getElementById("leadStatusFilter").value;
  const search = document.getElementById("leadSearch").value.trim();
  let url = `/api/admin/leads?limit=${LEADS_LIMIT}&offset=${leadsOffset}`;
  if (status) url += `&status=${encodeURIComponent(status)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const data = await adminFetch(url);
    const tbody = document.getElementById("leadsBody");
    if (leadsOffset === 0) tbody.innerHTML = "";

    for (const lead of data.leads) {
      const tr = document.createElement("tr");
      tr.onclick = () => { window.location.href = `/admin/lead-detail.html?id=${lead.id}`; };
      const patentNums = (lead.patents || []).map(p => p.patent_number).join(", ");
      const regs = lead.detail_registrations || [];
      const regLabel = regs.length > 0 ? `${regs[0].type}(${regs[0].status})` : "-";
      const regClass = regs.length > 0 ? "badge badge-detail_submitted" : "";
      tr.innerHTML = `
        <td>${formatDate(lead.created_at)}</td>
        <td>${escapeHtml(lead.name)}</td>
        <td>${escapeHtml(lead.company_name)}</td>
        <td>${escapeHtml(lead.email)}</td>
        <td>${escapeHtml(lead.query_input || "-")}</td>
        <td>${escapeHtml(patentNums || "-")}</td>
        <td>${escapeHtml(lead.utm_data?.utm_source || lead.source || "-")}</td>
        <td>${regs.length > 0 ? `<span class="${regClass}">${escapeHtml(regLabel)}</span>` : "-"}</td>
        <td>${badgeHtml(lead.status)}</td>
      `;
      tbody.appendChild(tr);
    }

    const btn = document.getElementById("loadMoreLeads");
    btn.style.display = data.leads.length >= LEADS_LIMIT ? "inline-block" : "none";
  } catch { /* ignore */ }
}

function loadMoreLeads() {
  leadsOffset += LEADS_LIMIT;
  loadLeads();
}

async function loadRegistrations() {
  const status = document.getElementById("regStatusFilter").value;
  let url = "/api/admin/detail-registrations?limit=50";
  if (status) url += `&status=${encodeURIComponent(status)}`;

  try {
    const data = await adminFetch(url);
    const tbody = document.getElementById("regsBody");
    tbody.innerHTML = "";
    for (const reg of data.registrations) {
      const tr = document.createElement("tr");
      tr.onclick = () => { window.location.href = `/admin/lead-detail.html?id=${reg.lead_id}`; };
      tr.innerHTML = `
        <td>${formatDate(reg.created_at)}</td>
        <td>${escapeHtml(reg.type)}</td>
        <td>${escapeHtml(reg.contact_name)}</td>
        <td>${escapeHtml(reg.desired_price || "-")}</td>
        <td>${escapeHtml(reg.support_method || "-")}</td>
        <td>${badgeHtml(reg.status)}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch { /* ignore */ }
}

async function loadInquiries() {
  const status = document.getElementById("inqStatusFilter").value;
  let url = "/api/admin/consultation-inquiries?limit=50";
  if (status) url += `&status=${encodeURIComponent(status)}`;

  try {
    const data = await adminFetch(url);
    const tbody = document.getElementById("inqsBody");
    tbody.innerHTML = "";
    for (const inq of data.inquiries) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${formatDate(inq.created_at)}</td>
        <td>${escapeHtml(inq.name)}</td>
        <td>${escapeHtml(inq.company_name || "-")}</td>
        <td>${escapeHtml(inq.email)}</td>
        <td>${escapeHtml(inq.inquiry_type)}</td>
        <td>${badgeHtml(inq.status)}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch { /* ignore */ }
}

async function exportCSV() {
  const token = await getAccessToken();
  const res = await fetch("/api/admin/export-patents", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ format: "csv", limit: 500 })
  });
  if (!res.ok) { alert("エクスポートに失敗しました"); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `patents-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
