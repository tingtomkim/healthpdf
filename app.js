/* 화면: PDF 넣기 → 분석(core.js) → 표·내려받기 */
(function () {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const won = n => n == null ? "" : n.toLocaleString("ko-KR");
const {KIND_LABEL} = MedCore;

pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";

/* ------------------------------------------------------------ 파일 넣기 */
const picked = {basic: null, detail: null, rx: null};

function setFile(kind, file) {
  picked[kind] = file;
  const slot = document.querySelector(`.slot[data-kind="${kind}"]`);
  slot.classList.toggle("ready", !!file);
  slot.querySelector(".f").textContent = file ? `✓ ${file.name} (${Math.round(file.size / 1024)} KB)` : "클릭하거나 파일을 끌어다 놓으세요";
  const any = Object.values(picked).some(Boolean);
  $("#run").disabled = !any;
  setMsg(any ? "준비됐습니다. 비밀번호를 넣고 분석하기를 누르세요." : "파일을 1개 이상 넣으면 분석할 수 있습니다.");
}

// 여러 파일을 한 번에 넣으면 파일 이름으로 칸을 정합니다. 이름으로 모르면 놓은 칸에 넣습니다.
function placeFiles(files, fallbackKind) {
  const pdfs = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  const unknown = [];
  for (const f of pdfs) {
    const kind = MedCore.kindOf(f.name) || (pdfs.length === 1 ? fallbackKind : null);
    if (kind) setFile(kind, f); else unknown.push(f.name);
  }
  if (!pdfs.length) setMsg("PDF 파일만 넣을 수 있습니다.", true);
  else if (unknown.length) setMsg(`파일 이름으로 종류를 알 수 없습니다: ${unknown.join(", ")} — 알맞은 칸에 하나씩 넣어주세요.`, true);
}

document.querySelectorAll(".slot").forEach(slot => {
  const kind = slot.dataset.kind, input = slot.querySelector("input");
  input.addEventListener("change", () => { placeFiles(input.files, kind); input.value = ""; });
  slot.addEventListener("dragover", e => { e.preventDefault(); slot.classList.add("drag"); });
  slot.addEventListener("dragleave", () => slot.classList.remove("drag"));
  slot.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); slot.classList.remove("drag"); placeFiles(e.dataTransfer.files, kind); });
});
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => { e.preventDefault(); placeFiles(e.dataTransfer.files, null); });

$("#reset").addEventListener("click", () => {
  Object.keys(picked).forEach(k => setFile(k, null));
  $("#pw").value = ""; REPORT = null; $("#result").classList.add("hide");
});

function setMsg(text, err) { $("#msg").textContent = text; $("#msg").className = "msg" + (err ? " err" : ""); }
function setBar(ratio) { $("#bar").classList.toggle("hide", ratio == null); $("#bar i").style.width = ((ratio || 0) * 100) + "%"; }

/* ------------------------------------------------------------ 분석 */
let REPORT = null;

async function analyzeFiles(files, password) {
  const data = {basic: [], detail: [], rx: []}, info = [];
  const kinds = Object.keys(files).filter(k => files[k]);
  for (const [i, kind] of kinds.entries()) {
    const f = files[kind];
    try {
      const {rows, pages} = await MedCore.readPdf(pdfjsLib, new Uint8Array(await f.arrayBuffer()), password,
        (p, n) => { setMsg(`${KIND_LABEL[kind]} 읽는 중… ${p}/${n}쪽`); setBar((i + p / n) / kinds.length); });
      if (!rows.length) throw new Error("표를 찾지 못했습니다. 심평원에서 받은 원본 PDF인지 확인하세요");
      data[kind] = rows;
      info.push({kind, name: f.name, pages, rows: rows.length, missing: MedCore.missingNumbers(rows)});
    } catch (e) {
      throw new Error(`${f.name}: ${e.message || e}`);
    }
  }
  return {...MedCore.analyze(data), files: info};
}

$("#run").addEventListener("click", async () => {
  $("#run").disabled = true;
  try {
    REPORT = await analyzeFiles(picked, $("#pw").value.trim());
    setBar(null);
    setMsg(`분석을 마쳤습니다. (${REPORT.files.map(f => `${KIND_LABEL[f.kind]} ${f.rows}행`).join(", ")})`);
    renderResult();
  } catch (e) {
    setBar(null);
    setMsg(e.message || String(e), true);
  } finally {
    $("#run").disabled = !Object.values(picked).some(Boolean);
  }
});

/* ------------------------------------------------------------ 내려받기 */
function save(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {href: url, download: name});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderDownloads() {
  const csvs = REPORT.files.map(f => `<button class="dlbtn" data-csv="${f.kind}">${KIND_LABEL[f.kind]} CSV ⭳</button>`).join("");
  $("#downloads").innerHTML = `<h2>파일 내려받기</h2>
    <div class="dl-row"><span class="lbl">정리 결과</span><button class="dlbtn main" id="dl-xlsx">진료정보_정리.xlsx (9개 시트) ⭳</button></div>
    <div class="dl-row"><span class="lbl">PDF별 CSV</span>${csvs}</div>`;
  $("#dl-xlsx").addEventListener("click", async e => {
    const b = e.currentTarget, label = b.textContent;
    b.disabled = true; b.textContent = "엑셀 만드는 중…";
    try {
      const buf = await MedCore.buildXlsx(ExcelJS, REPORT);
      save("진료정보_정리.xlsx", new Blob([buf], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    } finally { b.disabled = false; b.textContent = label; }
  });
  $("#downloads").querySelectorAll("[data-csv]").forEach(b => b.addEventListener("click", () => {
    const kind = b.dataset.csv, f = REPORT.files.find(x => x.kind === kind);
    save(f.name.replace(/\.pdf$/i, "") + ".csv", new Blob([MedCore.toCsv(kind, REPORT[kind])], {type: "text/csv;charset=utf-8"}));
  }));
}

/* ------------------------------------------------------------ 결과 표 */
// 탭별 칸 정의: [필드, 제목, 형식(n=숫자, d=날짜, c=코드)]
const COLS = {
  dx: [["code", "주상병코드", "c"], ["name", "주상병명"], ["out_days", "외래일수", "n"], ["in_days", "입원일수", "n"], ["visit_days", "총내원일수", "n"],
       ["first", "최초진료시작일", "d"], ["last", "마지막진료시작일", "d"], ["in_dates", "입원 상세일자"], ["self", "내가낸의료비", "n"]],
  basic: [["no", "순번", "n"], ["date", "진료시작일", "d"], ["hosp", "병·의원&약국"], ["dept", "진단과"], ["io", "입원/외래"], ["code", "주상병코드", "c"],
          ["name", "주상병명"], ["days", "내원일수", "n"], ["total", "총진료비", "n"], ["benefit", "건강보험 혜택", "n"], ["self", "내가낸의료비", "n"]],
  drug: [["code", "주상병코드", "c"], ["name", "주상병명"], ["drug", "약품명"], ["ing", "성분명"], ["count", "처방횟수", "n"], ["rx_days", "총투약일수", "n"],
         ["first", "최초진료시작일", "d"], ["last", "마지막진료시작일", "d"], ["hosps", "병원명"]],
  surg: [["date", "날짜", "d"], ["hosp", "병원"], ["code", "주상병코드", "c"], ["name", "주상병명"], ["cat", "진료내역"], ["item", "코드명(수술명)"], ["surgery", "수술판정"], ["dental", "치과"]],
  rx: [["no", "순번", "n"], ["date", "진료시작일", "d"], ["hosp", "병·의원&약국"], ["type", "처방/조제"], ["drug", "약품명"], ["ing", "성분명"],
       ["dose", "1회 투약량", "n"], ["per_day", "1일 투여횟수", "n"], ["rx_days", "총 투약일수", "n"]],
  detail: [["no", "순번", "n"], ["date", "진료시작일", "d"], ["hosp", "병·의원&약국"], ["cat", "진료내역"], ["item", "코드명"],
           ["dose", "1회 투약량", "n"], ["per_day", "1일 투여횟수", "n"], ["rx_days", "총 투약일수", "n"]],
};
const SOURCE = {dx: "diseases", basic: "basic", drug: "drugs", surg: "surgeries", rx: "rx", detail: "detail"};
const DEFAULT_SORT = {dx: ["visit_days", "desc"], basic: ["no", "asc"], drug: ["rx_days", "desc"], surg: ["date", "desc"], rx: ["no", "asc"], detail: ["no", "asc"]};
const state = {tab: "dx", q: "", sort: {...DEFAULT_SORT}, filter: {dxFlag: false, drug30: false, surgOnly: true, cat: "", io: "", noPharm: false}, open: new Set()};

function renderResult() {
  const R = REPORT;
  $("#result").classList.remove("hide");
  $("#files").innerHTML = R.files.map(f => `<span class="file${f.missing.length ? " bad" : ""}"><b>${KIND_LABEL[f.kind]}</b> ${f.pages}쪽 · ${f.rows}행${f.missing.length ? ` · 빠진 순번 ${f.missing.length}개` : " · 순번 누락 없음"}</span>`).join("");
  const ck = R.check, pct = (a, b) => b ? a / b * 100 : 0;
  const dxRate = pct(ck.dx_summary, ck.dx_raw), drugRate = pct(ck.drug_summary, ck.drug_raw);
  const surg = R.surgeries.filter(s => s.flag);
  $("#cards").innerHTML = `
    <div class="card${dxRate < 100 && ck.dx_raw ? " bad" : ""}"><div class="lbl">내원일수 (요약 / 원본)</div><div class="val">${ck.dx_summary}<small>일</small> / ${ck.dx_raw}<small>일</small></div><div class="sub">자체검증 일치율 ${dxRate.toFixed(1)}%</div></div>
    <div class="card${drugRate < 100 && ck.drug_raw ? " bad" : ""}"><div class="lbl">투약일수 (요약 / 원본)</div><div class="val">${ck.drug_summary}<small>일</small> / ${ck.drug_raw}<small>일</small></div><div class="sub">자체검증 일치율 ${drugRate.toFixed(1)}%</div></div>
    <div class="card"><div class="lbl">기준해당 주상병 / 약품</div><div class="val">${R.diseases.filter(g => g.flag).length}<small>개</small> / ${R.drugs.filter(g => g.flag).length}<small>개</small></div><div class="sub">전체 ${R.diseases.length}개 / ${R.drugs.length}개</div></div>
    <div class="card"><div class="lbl">수술 (치과 제외)</div><div class="val">${surg.length}<small>건</small></div><div class="sub">${surg.length ? "최근 " + surg.map(s => s.date).sort().pop() : R.detail.length ? "수술 기록 없음" : "세부진료정보 필요"}</div></div>`;
  renderDownloads();
  state.open.clear();
  renderTools(); renderTable();
}

document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
  state.tab = b.dataset.tab; state.q = "";
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t === b ? "true" : "false"));
  renderTools(); renderTable();
}));

function renderTools() {
  const t = state.tab, f = state.filter;
  let extra = "";
  if (t === "dx") extra = `<label><input type="checkbox" id="f-dxFlag" ${f.dxFlag ? "checked" : ""}> 기준해당만 (외래 7일↑ 또는 입원)</label>`;
  if (t === "drug") extra = `<label><input type="checkbox" id="f-drug30" ${f.drug30 ? "checked" : ""}> 총투약일수 30일 이상만</label>`;
  if (t === "surg") extra = `<label><input type="checkbox" id="f-surgOnly" ${f.surgOnly ? "checked" : ""}> 치과 제외 수술만 (해제하면 처치 전체)</label>`;
  if (t === "basic") extra = `<select id="f-io"><option value="">입원·외래 전체</option><option ${f.io === "입원" ? "selected" : ""}>입원</option><option ${f.io === "외래" ? "selected" : ""}>외래</option></select>
    <label><input type="checkbox" id="f-noPharm" ${f.noPharm ? "checked" : ""}> 약국 제외</label>`;
  if (t === "detail") {
    const cats = [...new Set(REPORT.detail.map(r => r.cat))].sort();
    extra = `<select id="f-cat"><option value="">진료내역 전체</option>${cats.map(c => `<option ${c === f.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  }
  $("#tools").innerHTML = `<input type="search" id="q" placeholder="검색 (병원, 상병, 약품, 코드…)" value="${esc(state.q)}">${extra}<span class="cnt" id="cnt"></span>`;
  $("#q").addEventListener("input", e => { state.q = e.target.value; renderTable(); });
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("change", e => { fn(e.target); renderTable(); }); };
  on("#f-dxFlag", el => f.dxFlag = el.checked);
  on("#f-drug30", el => f.drug30 = el.checked);
  on("#f-surgOnly", el => f.surgOnly = el.checked);
  on("#f-noPharm", el => f.noPharm = el.checked);
  on("#f-io", el => f.io = el.value);
  on("#f-cat", el => f.cat = el.value);
}

function rowsFor(t) {
  const f = state.filter, q = state.q.trim().toLowerCase(), cols = COLS[t];
  let rows = REPORT[SOURCE[t]];
  if (t === "dx" && f.dxFlag) rows = rows.filter(r => r.flag);
  if (t === "drug" && f.drug30) rows = rows.filter(r => r.flag);
  if (t === "surg" && f.surgOnly) rows = rows.filter(r => r.flag);
  if (t === "basic" && f.io) rows = rows.filter(r => r.io.includes(f.io));
  if (t === "basic" && f.noPharm) rows = rows.filter(r => !r.hosp.includes("약국"));
  if (t === "detail" && f.cat) rows = rows.filter(r => r.cat === f.cat);
  if (q) rows = rows.filter(r => cols.some(([k]) => String(r[k] ?? "").toLowerCase().includes(q)));
  const [key, dir] = state.sort[t], type = (cols.find(c => c[0] === key) || [])[2];
  const val = r => type === "n" ? (+r[key] || 0) : String(r[key] ?? "");
  return [...rows].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return dir === "asc" ? c : -c; });
}

function cell(r, [k, , type]) {
  let v = r[k];
  if (type === "n" && typeof v === "number" && k !== "no") v = won(v);
  if (typeof v === "boolean") v = v ? "O" : "";
  let html = esc(v);
  if (k === "io" && String(r.io).includes("입원")) html = `<span class="in">${html}</span>`;
  return `<td class="${type || ""}">${html}</td>`;
}

function visitsTable(g) {
  const set = new Set(g.visits);
  const cols = COLS.basic.filter(([k]) => !["code", "name"].includes(k));
  const rows = REPORT.basic.filter(r => set.has(r.no)).sort((a, b) => a.date < b.date ? 1 : -1);
  return `<table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => cell(r, c)).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderTable() {
  const t = state.tab, cols = COLS[t], rows = rowsFor(t), [sk, sd] = state.sort[t];
  $("#cnt").textContent = `${rows.length}건`;
  if (!rows.length) {
    $("#table").innerHTML = `<div class="empty">${REPORT[SOURCE[t]].length ? "조건에 맞는 내용이 없습니다." : "이 내용을 보려면 해당 PDF를 넣고 다시 분석하세요."}</div>`;
    return;
  }
  const head = `<tr>${cols.map(([k, label]) => `<th data-k="${k}"${k === sk ? ` data-dir="${sd}"` : ""}>${label}</th>`).join("")}</tr>`;
  const body = rows.map(r => {
    const fl = r.flag ? " flag" : "";
    if (t !== "dx") return `<tr class="${fl}">${cols.map(c => cell(r, c)).join("")}</tr>`;
    const key = r.name + "|" + r.code, open = state.open.has(key);
    return `<tr class="grp${fl}${open ? " open" : ""}" data-key="${esc(key)}">${cols.map(c => cell(r, c)).join("")}</tr>` +
      (open ? `<tr class="visits"><td colspan="${cols.length}">${visitsTable(r)}</td></tr>` : "");
  }).join("");
  $("#table").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  $("#table").querySelectorAll("thead th[data-k]").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k, [k0, d0] = state.sort[t];
    const numeric = (cols.find(c => c[0] === k) || [])[2] === "n";
    state.sort[t] = [k, k0 === k ? (d0 === "asc" ? "desc" : "asc") : (numeric ? "desc" : "asc")];
    renderTable();
  }));
  $("#table").querySelectorAll("tr.grp").forEach(tr => tr.addEventListener("click", () => {
    const k = tr.dataset.key; state.open.has(k) ? state.open.delete(k) : state.open.add(k); renderTable();
  }));
}
})();
