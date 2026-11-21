/*
 * 심평원 '개인진료정보내역' PDF(기본/세부/처방조제) → 정리된 표 → 주상병·약품·수술 요약
 *
 * PDF의 표 테두리 선으로 칸을 나누고, 글자는 한 자씩 중심점이 들어가는 칸에 넣습니다.
 * 브라우저(index.html)와 Node(테스트)에서 같이 씁니다. pdf.js 3.x가 필요합니다.
 */
(function (root) {
"use strict";

/* ------------------------------------------------------------ 표 읽기 */

// 머리글(줄바꿈·공백 제거 후) → 필드 이름
const HEADER_KEYS = {
  "순번": "no", "진료시작일": "date", "병·의원&약국": "hosp", "진단과": "dept", "입원/외래": "io",
  "주상병코드": "code", "주상병명": "name", "내원일수": "days", "총진료비(건강보험적용분)": "total",
  "건강보험등혜택받은금액": "benefit", "내가낸의료비(진료비)": "self", "진료내역": "cat", "코드명": "item",
  "처방/조제": "type", "약품명": "drug", "성분명": "ing", "1회투약량": "dose", "1일투여횟수": "per_day",
  "총투약일수": "rx_days",
};
const INT_FIELDS = new Set(["no", "days", "total", "benefit", "self", "per_day", "rx_days"]);
const KINDS = {"기본진료정보": "basic", "세부진료정보": "detail", "처방조제정보": "rx"};
const KIND_LABEL = {basic: "기본진료정보", detail: "세부진료정보", rx: "처방조제정보"};

function kindOf(fileName) {
  for (const [label, kind] of Object.entries(KINDS)) if (fileName.includes(label)) return kind;
  return null;
}

/*
 * 페이지의 그리기 명령을 따라가며 글자와 선을 모읍니다. 좌표는 PDF 좌표(아래가 0).
 * 글자는 getTextContent() 대신 글자 출력 명령에서 직접 읽습니다. getTextContent()는 글자 간격이
 * 조금만 넓어도 가짜 공백을 넣어서 '기타편두통'이 '기타 편두통'이 되기 때문입니다.
 * 선은 채우기 사각형의 테두리까지 가로선·세로선으로 모아 표 칸을 나누는 데 씁니다.
 */
function pageContent(opList, OPS) {
  const h = [], v = [], chars = [], stack = [];
  const I = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [a[0]*b[0] + a[2]*b[1], a[1]*b[0] + a[3]*b[1], a[0]*b[2] + a[2]*b[3],
                         a[1]*b[2] + a[3]*b[3], a[0]*b[4] + a[2]*b[5] + a[4], a[1]*b[4] + a[3]*b[5] + a[5]];
  const apply = (mm, x, y) => [mm[0]*x + mm[2]*y + mm[4], mm[1]*x + mm[3]*y + mm[5]];
  let m = I, gs = {size: 10, cs: 0, ws: 0, hs: 1, lead: 0}, tm = I, tlm = I;
  const pt = (x, y) => apply(m, x, y);
  const seg = (a, b) => {
    if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 2) h.push({y: a[1], x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0])});
    else if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 2) v.push({x: a[0], y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1])});
  };
  const moveLine = (tx, ty) => { tlm = mul(tlm, [1, 0, 0, 1, tx, ty]); tm = tlm; };
  const show = glyphs => {
    // pdf.js는 공백 글리프를 빼고 빈 목록만 남기므로, 빈 출력 명령은 그 자리의 공백 한 칸으로 봅니다.
    if (!glyphs.some(g => g && typeof g === "object")) {
      const [x, y] = apply(mul(m, tm), gs.size * 0.14, gs.size * 0.3);
      chars.push({x, y, c: " "});
      return;
    }
    for (const g of glyphs) {
      if (typeof g === "number") { tm = mul(tm, [1, 0, 0, 1, -g / 1000 * gs.size * gs.hs, 0]); continue; }
      if (!g) continue;
      const w = (g.width || 0) / 1000 * gs.size;
      const adv = (w + gs.cs + (g.isSpace ? gs.ws : 0)) * gs.hs;
      if (g.unicode) {
        const [x, y] = apply(mul(m, tm), w * gs.hs / 2, gs.size * 0.3);
        chars.push({x, y, c: g.unicode});
      }
      tm = mul(tm, [1, 0, 0, 1, adv, 0]);
    }
  };
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], args = opList.argsArray[i];
    if (fn === OPS.save) stack.push([m, {...gs}]);
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) [m, gs] = s; }
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.beginText) tm = tlm = I;
    else if (fn === OPS.setFont) gs.size = args[1];
    else if (fn === OPS.setCharSpacing) gs.cs = args[0];
    else if (fn === OPS.setWordSpacing) gs.ws = args[0];
    else if (fn === OPS.setHScale) gs.hs = args[0] / 100;
    else if (fn === OPS.setLeading) gs.lead = args[0];
    else if (fn === OPS.setTextMatrix) tm = tlm = args.slice(0, 6);
    else if (fn === OPS.moveText) moveLine(args[0], args[1]);
    else if (fn === OPS.setLeadingMoveText) { gs.lead = -args[1]; moveLine(args[0], args[1]); }
    else if (fn === OPS.nextLine) moveLine(0, -gs.lead);
    else if (fn === OPS.showText || fn === OPS.showSpacedText) show(args[0]);
    else if (fn === OPS.nextLineShowText) { moveLine(0, -gs.lead); show(args[0]); }
    else if (fn === OPS.nextLineSetSpacingShowText) { gs.ws = args[0]; gs.cs = args[1]; moveLine(0, -gs.lead); show(args[2]); }
    else if (fn === OPS.constructPath) {
      const [ops, c] = args;
      let k = 0, cur = null, start = null;
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = start = pt(c[k], c[k + 1]); k += 2; }
        else if (op === OPS.lineTo) { const p = pt(c[k], c[k + 1]); k += 2; if (cur) seg(cur, p); cur = p; }
        else if (op === OPS.curveTo) { cur = pt(c[k + 4], c[k + 5]); k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = pt(c[k + 2], c[k + 3]); k += 4; }
        else if (op === OPS.closePath) { if (cur && start) seg(cur, start); cur = start; }
        else if (op === OPS.rectangle) {
          const [x, y, w, hh] = c.slice(k, k + 4); k += 4;
          const p = [pt(x, y), pt(x + w, y), pt(x + w, y + hh), pt(x, y + hh)];
          for (let j = 0; j < 4; j++) seg(p[j], p[(j + 1) % 4]);
          cur = start = p[0];
        }
      }
    }
  }
  return {h, v, chars};
}

// 가까운 좌표를 하나로 합칩니다.
function uniq(values, tol = 1) {
  const out = [];
  for (const x of [...values].sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
  return out;
}

// 칸 안의 글자를 줄 단위 문자열로 묶습니다. (PDF 좌표는 위로 갈수록 y가 큽니다)
function cellLines(chars, x0, x1, y0, y1, tol = 2) {
  const inside = chars.filter(c => c.x >= x0 && c.x < x1 && c.y > y0 && c.y <= y1).sort((a, b) => b.y - a.y);
  const lines = [];
  let cur = [], curY = null;
  for (const c of inside) {
    if (cur.length && Math.abs(c.y - curY) > tol) { lines.push(cur); cur = []; }
    if (!cur.length) curY = c.y;
    cur.push(c);
  }
  if (cur.length) lines.push(cur);
  return lines.map(l => l.sort((a, b) => a.x - b.x).map(c => c.c).join("").trim()).filter(Boolean);
}

function clean(field, lines) {
  // 칸 폭 때문에 줄바꿈된 글자는 이어 붙이고, 영문끼리 이어지면 띄어쓰기를 넣습니다 (예: 성분명).
  let text = "";
  for (const line of lines) {
    if (text && /[A-Za-z)]$/.test(text) && /^[A-Za-z(]/.test(line)) text += " ";
    text += line;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (INT_FIELDS.has(field)) { const d = text.replace(/,/g, ""); return /^\d+$/.test(d) ? +d : null; }
  if (field === "date") { const mm = text.match(/\d{4}-\d{2}-\d{2}/); return mm ? mm[0] : null; }
  if (field === "code" && text === "$") return "";
  return text;
}

function pageRows(chars, lines, pageNo) {
  const ys = uniq(lines.h.filter(s => s.x1 - s.x0 > 5).map(s => s.y)).reverse();   // 위 → 아래
  const xs = uniq(lines.v.map(s => s.x));
  if (ys.length < 2 || xs.length < 3) return [];
  // '순번' 글자가 들어 있는 줄이 머리글
  const head = ys.findIndex((y, i) => i + 1 < ys.length &&
    cellLines(chars, xs[0], xs[xs.length - 1], ys[i + 1], y).join("").replace(/\s/g, "").includes("순번"));
  if (head < 0) return [];
  const fields = xs.slice(0, -1).map((x, j) =>
    HEADER_KEYS[cellLines(chars, x, xs[j + 1], ys[head + 1], ys[head]).join("").replace(/\s/g, "")] || null);
  const rows = [];
  for (let i = head + 1; i + 1 < ys.length; i++) {
    const rec = {};
    fields.forEach((f, j) => { if (f) rec[f] = clean(f, cellLines(chars, xs[j], xs[j + 1], ys[i + 1], ys[i])); });
    if (rec.no != null && rec.date) { rec.page = pageNo; rows.push(rec); }
  }
  return rows;
}

async function readPdf(pdfjsLib, data, password, onPage) {
  let doc;
  try {
    doc = await pdfjsLib.getDocument({data, password: password || undefined}).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error(e.code === 2 ? "비밀번호가 맞지 않습니다" : "비밀번호가 필요한 파일입니다");
    throw e;
  }
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = pageContent(await page.getOperatorList(), pdfjsLib.OPS);
    rows.push(...pageRows(content.chars, content, p));
    if (onPage) onPage(p, doc.numPages);
  }
  const pages = doc.numPages;
  await doc.destroy();
  return {rows, pages};
}

function missingNumbers(rows) {
  const nos = new Set(rows.map(r => r.no)), max = Math.max(0, ...nos), out = [];
  for (let n = 1; n <= max; n++) if (!nos.has(n)) out.push(n);
  return out;
}

/* ------------------------------------------------------------ 요약 */

// 표기 기준 (예시 화면과 같음)
const DX_OUT_DAYS = 7, DX_IN_DAYS = 1, DRUG_DAYS = 30;
const SURGERY_RE = /수술|절제|적출|봉합술|성형술|재건술|치환술|고정술|이식술|결찰술|절개|배농술|정복술|관절경|제거술|천공술|박리술|소파술|감압술|유합술|교정술/;
const NOT_SURGERY_RE = /처치|차단술|주사|마취|검사|NEEDLE|FORCEPS|SNARE/i;

const noSpace = s => String(s || "").replace(/\s/g, "");
const isPharmacy = r => (r.hosp || "").includes("약국");
const isDental = r => (r.hosp || "").includes("치과") || (r.dept || "").includes("치과");
const sameHosp = (a, b) => !!(a && b) && (a.includes(b) || b.includes(a));
const byDateNo = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no;

// (진료시작일 → 병원 진료 행) 색인. 처방·수술 행에 주상병을 붙일 때 씁니다.
function visitIndex(basic) {
  const idx = new Map();
  for (const r of basic) if (!isPharmacy(r)) { if (!idx.has(r.date)) idx.set(r.date, []); idx.get(r.date).push(r); }
  return idx;
}
function dxOf(idx, date, hosp) {
  const sameDay = idx.get(date) || [];
  const hit = sameDay.find(r => sameHosp(r.hosp, hosp)) || (sameDay.length === 1 ? sameDay[0] : null);
  return hit ? [hit.code, hit.name] : ["", "확인필요"];
}

/* 주상병명별 요약. 약국 행은 같은 날 병원 진료와 겹치므로 뺍니다. 상병명이 같으면 코드가 달라도 한 줄로 묶습니다. */
function diseaseSummary(basic) {
  const groups = new Map();
  for (const r of [...basic].sort(byDateNo)) {
    if (isPharmacy(r) || (!r.code && (r.name === "" || r.name === "해당없음"))) continue;
    const key = noSpace(r.name) || r.code;
    if (!groups.has(key)) groups.set(key, {codes: [], name: r.name, hosps: [], out_days: 0, in_days: 0,
      first: r.date, last: r.date, in_dates: [], self: 0, total: 0, visits: []});
    const g = groups.get(key), days = r.days || 0;
    if (r.code && !g.codes.includes(r.code)) g.codes.push(r.code);
    if (!g.hosps.includes(r.hosp)) g.hosps.push(r.hosp);
    if (r.io.includes("입원")) { g.in_days += days; g.in_dates.push(`${r.date}(${days}일)`); } else g.out_days += days;
    g.last = r.date; g.self += r.self || 0; g.total += r.total || 0; g.visits.push(r.no);
  }
  const out = [...groups.values()].map(g => ({
    code: g.codes.join(", "), name: g.name, hosps: g.hosps.join(", "), out_days: g.out_days, in_days: g.in_days,
    visit_days: g.out_days + g.in_days, first: g.first, last: g.last, in_dates: g.in_dates.join(", "),
    total: g.total, self: g.self, visits: g.visits, flag: g.out_days >= DX_OUT_DAYS || g.in_days >= DX_IN_DAYS,
  }));
  return out.sort((a, b) => b.visit_days - a.visit_days || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/* (주상병, 약품명)별 요약. 약국 조제(처방조제)는 병원 처방(외래)과 겹치므로 외래 행만 셉니다. */
function drugSummary(rx, basic) {
  const idx = visitIndex(basic), groups = new Map();
  for (const r of [...rx].sort(byDateNo)) {
    if (r.type !== "외래") continue;
    const [code, name] = dxOf(idx, r.date, r.hosp), key = code + "\u0000" + name + "\u0000" + r.drug;
    if (!groups.has(key)) groups.set(key, {code, name, drug: r.drug, ing: r.ing, hosps: [], count: 0, rx_days: 0,
      first: r.date, last: r.date, rows: []});
    const g = groups.get(key);
    g.count++; g.rx_days += r.rx_days || 0; g.last = r.date; g.rows.push(r.no);
    if (!g.hosps.includes(r.hosp)) g.hosps.push(r.hosp);
  }
  const out = [...groups.values()].map(g => ({...g, hosps: g.hosps.join(", "), flag: g.rx_days >= DRUG_DAYS}));
  return out.sort((a, b) => b.rx_days - a.rx_days || (a.drug < b.drug ? -1 : a.drug > b.drug ? 1 : 0));
}

/* 세부진료정보의 '처치및수술' 행 전체에 수술 여부·치과 여부·주상병을 붙입니다. */
function surgeryRows(detail, basic) {
  const idx = visitIndex(basic);
  return detail.filter(r => noSpace(r.cat).includes("처치및수술")).map(r => {
    const [code, name] = dxOf(idx, r.date, r.hosp);
    const surgery = SURGERY_RE.test(r.item) && !NOT_SURGERY_RE.test(r.item), dental = isDental(r);
    return {...r, code, name, surgery, dental, flag: surgery && !dental};
  });
}

/* (주상병코드, 수술명, 병원)별 수술 건수. 수술로 판정된 행만 묶습니다. */
function surgerySummary(surgeries) {
  const groups = new Map();
  for (const r of surgeries.filter(s => s.surgery).sort(byDateNo)) {
    const key = r.code + "\u0000" + r.item + "\u0000" + r.hosp;
    if (!groups.has(key)) groups.set(key, {code: r.code, name: r.name, item: r.item, hosp: r.hosp, count: 0,
      first: r.date, last: r.date, dental: r.dental, rows: []});
    const g = groups.get(key);
    g.count++; g.last = r.date; g.rows.push(r.no);
  }
  return [...groups.values()].map(g => ({...g, flag: !g.dental}));
}

function analyze(data) {
  const surgeries = surgeryRows(data.detail, data.basic);
  const diseases = diseaseSummary(data.basic), drugs = drugSummary(data.rx, data.basic);
  return {
    ...data, diseases, drugs, surgeries, surgery_groups: surgerySummary(surgeries),
    check: {
      dx_summary: diseases.reduce((s, g) => s + g.visit_days, 0),
      dx_raw: data.basic.filter(r => !isPharmacy(r)).reduce((s, r) => s + (r.days || 0), 0),
      drug_summary: drugs.reduce((s, g) => s + g.rx_days, 0),
      drug_raw: data.rx.filter(r => r.type === "외래").reduce((s, r) => s + (r.rx_days || 0), 0),
    },
  };
}

/* ------------------------------------------------------------ 내보내기 */

const CSV_COLUMNS = {
  basic: [["no", "순번"], ["date", "진료시작일"], ["hosp", "병·의원&약국"], ["dept", "진단과"], ["io", "입원/외래"],
          ["code", "주상병코드"], ["name", "주상병명"], ["days", "내원일수"], ["total", "총진료비(건강보험적용분)"],
          ["benefit", "건강보험등 혜택받은금액"], ["self", "내가낸의료비(진료비)"]],
  detail: [["no", "순번"], ["date", "진료시작일"], ["hosp", "병·의원&약국"], ["cat", "진료내역"], ["item", "코드명"],
           ["dose", "1회 투약량"], ["per_day", "1일 투여횟수"], ["rx_days", "총 투약일수"]],
  rx: [["no", "순번"], ["date", "진료시작일"], ["hosp", "병·의원&약국"], ["type", "처방/조제"], ["drug", "약품명"],
       ["ing", "성분명"], ["dose", "1회 투약량"], ["per_day", "1일 투여횟수"], ["rx_days", "총 투약일수"]],
};

function toCsv(kind, rows) {
  const q = v => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = CSV_COLUMNS[kind];
  // 맨 앞 BOM: 엑셀에서 더블클릭해도 한글이 깨지지 않음
  return "﻿" + [cols.map(c => q(c[1])).join(","), ...rows.map(r => cols.map(c => q(r[c[0]])).join(","))].join("\r\n") + "\r\n";
}

/* 엑셀 9개 시트 정의: {name, header, rows, flags, summaries} */
function workbookSheets(report) {
  const basic = new Map(report.basic.map(r => [r.no, r])), rx = new Map(report.rx.map(r => [r.no, r]));
  const surgByNo = new Map(report.surgeries.map(s => [s.no, s]));
  const {diseases, drugs, surgeries, surgery_groups} = report;
  const OX = b => b ? "O" : "";
  const sheet = (name, header, rows, flags, summaries) => ({name, header, rows, flags: flags || [], summaries: summaries || []});

  const dxHead = ["주상병코드", "주상병명", "외래일수", "입원일수", "총내원일수", "최초진료시작일", "마지막진료시작일", "입원 상세일자"];
  const dxRow = g => [g.code, g.name, g.out_days, g.in_days, g.visit_days, g.first, g.last, g.in_dates];
  const drugHead = ["주상병코드", "주상병명", "약품명", "총투약일수", "최초진료시작일", "마지막진료시작일"];
  const drugRow = g => [g.code, g.name, g.drug, g.rx_days, g.first, g.last];
  const sheets = [
    // 1~3. 표기 기준에 해당하는 항목만
    sheet("주상병명_요약", dxHead, diseases.filter(g => g.flag).map(dxRow)),
    sheet("약품명_요약", drugHead, drugs.filter(g => g.flag).map(drugRow)),
    sheet("수술_내역", ["날짜", "주상병코드", "주상병명", "병원", "수술명"],
          surgeries.filter(s => s.flag).map(s => [s.date, s.code, s.name, s.hosp, s.item])),
    // 4~6. 기준과 관계없이 전체
    sheet("주상병명 요약 원본", [...dxHead, "총진료비", "내가낸의료비", "기준해당"],
          diseases.map(g => [...dxRow(g), g.total, g.self, OX(g.flag)]), diseases.map(g => g.flag)),
    sheet("약품명 요약 원본", [...drugHead, "성분명", "처방횟수", "병원명", "기준해당"],
          drugs.map(g => [...drugRow(g), g.ing, g.count, g.hosps, OX(g.flag)]), drugs.map(g => g.flag)),
    sheet("수술내역 원본", ["날짜", "병원", "진료내역", "코드명", "주상병코드", "주상병명", "수술판정", "치과", "기준해당"],
          surgeries.map(s => [s.date, s.hosp, s.cat, s.item, s.code, s.name, OX(s.surgery), OX(s.dental), OX(s.flag)]),
          surgeries.map(s => s.flag)),
  ];

  // 7~9. 요약 줄 아래에 그 요약을 이루는 원본 행을 펼쳐 둡니다.
  const nested = (name, header, groups, summaryRow, details) => {
    const rows = [], flags = [], sums = [];
    for (const g of groups) {
      rows.push(summaryRow(g)); flags.push(g.flag); sums.push(true);
      for (const d of details(g)) { rows.push(d); flags.push(false); sums.push(false); }
    }
    return sheet(name, header, rows, flags, sums);
  };
  sheets.push(nested("주상병명_세부항목",
    ["구분", "주상병코드", "병원명", "주상병명", "외래일수", "입원일수", "총내원일수", "최초진료시작일", "마지막진료시작일", "입원 상세일자", "기준해당"],
    diseases,
    g => ["요약", g.code, g.hosps, g.name, g.out_days, g.in_days, g.visit_days, g.first, g.last, g.in_dates, OX(g.flag)],
    g => g.visits.map(n => basic.get(n)).sort(byDateNo).map(v => {
      const inp = v.io.includes("입원");
      return ["상세", v.code, v.hosp, v.name, inp ? 0 : v.days, inp ? v.days : 0, v.days, v.date, v.date, inp ? `${v.date}(${v.days}일)` : "", ""];
    })));
  sheets.push(nested("약품명_세부항목",
    ["구분", "주상병코드", "병원명", "주상병명", "약품명", "총투약일수", "최초진료시작일", "마지막진료시작일", "기준해당"],
    drugs,
    g => ["요약", g.code, g.hosps, g.name, g.drug, g.rx_days, g.first, g.last, OX(g.flag)],
    g => g.rows.map(n => rx.get(n)).map(r => ["상세", g.code, r.hosp, g.name, r.drug, r.rx_days, r.date, r.date, ""])));
  sheets.push(nested("수술_세부항목",
    ["구분", "주상병코드", "수술명", "병원명", "수술건수", "최초수술일", "최근수술일", "치과", "기준해당"],
    surgery_groups,
    g => ["요약", g.code, g.item, g.hosp, g.count, g.first, g.last, OX(g.dental), OX(g.flag)],
    g => g.rows.map(n => surgByNo.get(n)).map(s => ["상세", s.code, s.item, s.hosp, 1, s.date, s.date, OX(s.dental), ""])));
  return sheets;
}

/* ExcelJS로 시트를 꾸며 xlsx 바이트를 만듭니다. */
async function buildXlsx(ExcelJS, report) {
  const wb = new ExcelJS.Workbook();
  const fill = argb => ({type: "pattern", pattern: "solid", fgColor: {argb}});
  for (const s of workbookSheets(report)) {
    const ws = wb.addWorksheet(s.name, {views: [{state: "frozen", ySplit: 1}]});
    ws.addRow(s.header).eachCell(c => {
      c.font = {bold: true, color: {argb: "FFFFFFFF"}};
      c.fill = fill("FF2F4FA8");
      c.alignment = {horizontal: "center", vertical: "middle", wrapText: true};
    });
    s.rows.forEach((r, i) => {
      const row = ws.addRow(r.map(v => v == null ? "" : v));
      for (let c = 1; c <= s.header.length; c++) {
        const cell = row.getCell(c);
        cell.alignment = {vertical: "top", wrapText: true};
        cell.border = {bottom: {style: "thin", color: {argb: "FFDDE2EA"}}};
        if (s.summaries[i]) { cell.fill = fill("FFEEF2FB"); cell.font = {bold: true}; }
        if (s.flags[i]) { cell.fill = fill("FFFDECEC"); cell.font = {bold: true, color: {argb: "FFB42C2C"}}; }
      }
    });
    ws.autoFilter = {from: {row: 1, column: 1}, to: {row: 1, column: s.header.length}};
    s.header.forEach((h, i) => {
      const longest = Math.max(h.length, ...s.rows.map(r => r[i] == null ? 0 : String(r[i]).length));
      ws.getColumn(i + 1).width = Math.min(Math.max(longest * 1.6, 8), 50);
    });
  }
  return wb.xlsx.writeBuffer();
}

const API = {KIND_LABEL, kindOf, readPdf, missingNumbers, analyze, toCsv, workbookSheets, buildXlsx};
if (typeof module !== "undefined" && module.exports) module.exports = API; else root.MedCore = API;
})(typeof self !== "undefined" ? self : this);
