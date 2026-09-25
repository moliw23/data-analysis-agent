// src/engine.js
import * as XLSX from "xlsx";

// raw-stub:echarts/dist/echarts.min.js?raw
var echarts_min_default = "";

// src/engine.js
var SAMPLE_ANALYZE_THRESHOLD = 5e4;
function isNumeric(v) {
  if (v === null || v === void 0 || v === "") return false;
  const s = String(v).replace(/,/g, "").replace(/%/g, "").trim();
  return s !== "" && !isNaN(Number(s));
}
function toNum(v) {
  if (v === null || v === void 0 || v === "") return NaN;
  return Number(String(v).replace(/,/g, "").replace(/%/g, "").trim());
}
function isDate(v) {
  if (v === null || v === void 0 || v === "") return false;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) {
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  }
  if (!/[-\/年]/.test(s)) return false;
  const t = Date.parse(s.replace(/年|月/g, "-").replace("\u65E5", ""));
  return !isNaN(t);
}
function normDate(v) {
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}
function fmt(n) {
  if (n === null || n === void 0 || isNaN(n)) return "-";
  return Math.round(n).toLocaleString("zh-CN");
}
function uniq(arr) {
  return Array.from(new Set(arr));
}
function isEmpty(v) {
  return v === null || v === void 0 || String(v).trim() === "";
}
function genderLabel(colName, v) {
  if (!/(gender|性别)/i.test(colName)) return v;
  const map = { 0: "\u672A\u77E5", 1: "\u7537", 2: "\u5973" };
  const s = String(v);
  return map[s] != null ? map[s] : v;
}
function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift().map((h) => h.trim());
  const data = rows.filter((r) => r.length > 1 || r.length === 1 && r[0].trim() !== "").map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
  return { columns: headers.map((h) => ({ name: h })), rows: data };
}
function parseJSON(text) {
  const obj = JSON.parse(text);
  let arr = Array.isArray(obj) ? obj : obj.data && Array.isArray(obj.data) ? obj.data : null;
  if (!arr || !arr.length) throw new Error("JSON \u9700\u4E3A\u5BF9\u8C61\u6570\u7EC4");
  const headers = Object.keys(arr[0]);
  return { columns: headers.map((h) => ({ name: h })), rows: arr.map((o) => {
    const r = {};
    headers.forEach((h) => {
      r[h] = o[h] == null ? "" : typeof o[h] === "object" ? JSON.stringify(o[h]) : String(o[h]);
    });
    return r;
  }) };
}
function decodeText(buf) {
  let text = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
  }
  if (text != null && !text.includes("\uFFFD")) return text;
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch (e2) {
    return text != null ? text : new TextDecoder("utf-8").decode(buf);
  }
}
async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const buf = await file.arrayBuffer();
    const text = decodeText(buf);
    return parseCSV(text);
  }
  if (name.endsWith(".json")) {
    const text = await file.text();
    return parseJSON(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const headers = Object.keys(data[0] || {});
    return { columns: headers.map((h) => ({ name: h })), rows: data.map((o) => {
      const r = {};
      headers.forEach((h) => {
        r[h] = o[h] == null ? "" : String(o[h]);
      });
      return r;
    }) };
  }
  throw new Error("\u4E0D\u652F\u6301\u7684\u683C\u5F0F\uFF1A" + file.name);
}
function parseCSVText(text) {
  return parseCSV(text);
}
var ID_NAME_PATTERN = /(身份证|证件号|证件|手机号|手机|电话|账号|账户|工号|卡号|会员号|工号|email|邮箱|ID|编号)$/i;
var CODE_NAME_PATTERN = /(category|cat_|类目|分类|code|编码|性别|gender|标志|flag|type_id|group_id)/i;
function looksLikeId(colName, nonEmpty, total) {
  if (ID_NAME_PATTERN.test(colName)) return true;
  if (!nonEmpty.length) return false;
  const card = uniq(nonEmpty).length;
  const longDigitRatio = nonEmpty.filter((v) => {
    const s = String(v).replace(/[^\d]/g, "");
    return s.length >= 8 && /^\d+$/.test(s);
  }).length / nonEmpty.length;
  return longDigitRatio > 0.85 && card / total > 0.9;
}
function inferSchema(table) {
  const { columns, rows } = table;
  const typed = columns.map((col) => {
    const vals = rows.map((r) => r[col.name]);
    const nonEmpty = vals.filter((v) => !isEmpty(v));
    const total = nonEmpty.length || 1;
    const numRatio = nonEmpty.filter(isNumeric).length / total;
    const dateRatio = nonEmpty.filter(isDate).length / total;
    let type = "text", semantic = "text";
    if (looksLikeId(col.name, nonEmpty, total)) {
      type = numRatio > 0.8 ? "number" : "text";
      semantic = "dimension";
    } else if (dateRatio > 0.6) {
      type = "date";
      semantic = "time";
    } else if (numRatio > 0.8) {
      type = "number";
      semantic = "measure";
      const card = uniq(nonEmpty).length;
      if (CODE_NAME_PATTERN.test(col.name) || card >= 2 && card <= 6 && nonEmpty.every((v) => Number.isInteger(toNum(v)))) {
        semantic = "dimension";
      }
    } else {
      const card = uniq(nonEmpty).length;
      if (card <= Math.max(2, Math.floor(rows.length * 0.5)) && card <= 30) semantic = "dimension";
    }
    return { ...col, type, semantic, missing: vals.filter(isEmpty).length, cardinality: uniq(nonEmpty).length };
  });
  return { ...table, columns: typed };
}
var OPTIONAL_COL = /^(备注|说明|附言|留言|备注信息|评论|comment|note|remark)/i;
function findFillRule(rows, colName, columns) {
  const mask = rows.map((r) => !isEmpty(r[colName]));
  const filled = mask.filter(Boolean).length;
  if (filled < 2) return null;
  for (const d of columns) {
    if (d.name === colName) continue;
    const dvals = rows.map((r) => r[d.name]);
    const uniqD = uniq(dvals.filter((v) => !isEmpty(v)));
    if (uniqD.length < 2 || uniqD.length > 8) continue;
    for (const dv of uniqD) {
      const g = dvals.map((v) => v === dv);
      const gSize = g.filter(Boolean).length;
      if (gSize < 2 || gSize >= rows.length) continue;
      let inF = 0, outF = 0;
      for (let i = 0; i < rows.length; i++) {
        if (mask[i]) {
          if (g[i]) inF++;
          else outF++;
        }
      }
      if (inF / gSize >= 0.85 && outF / (rows.length - gSize) <= 0.15) {
        return { dim: d.name, value: dv };
      }
    }
  }
  return null;
}
function qualityCheck(table) {
  const { columns, rows } = table;
  const issues = [];
  let penalty = 0;
  columns.forEach((col) => {
    const vals = rows.map((r) => r[col.name]);
    const total = vals.length || 1;
    const miss = vals.filter(isEmpty).length;
    if (miss > 0) {
      const rate = miss / total;
      if (miss === total) {
        issues.push({ col: col.name, severity: "medium", type: "\u6574\u5217\u7F3A\u5931", detail: `\u8BE5\u5217 ${miss} \u884C\u5168\u90E8\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u53C2\u4E0E\u4EFB\u4F55\u5206\u6790\uFF08\u53EF\u80FD\u662F\u6E05\u6D17/\u5BFC\u51FA\u65F6\u4E22\u5931\uFF09`, suggestion: "\u82E5\u8BE5\u5217\u4E0D\u91CD\u8981\u53EF\u5728\u5206\u6790\u4E2D\u5FFD\u7565" });
        penalty += Math.min(20, rate * 30);
      } else if (OPTIONAL_COL.test(col.name)) {
        issues.push({ col: col.name, severity: "info", type: "\u53EF\u9009\u5B57\u6BB5", detail: `${miss} \u884C\u672A\u586B\uFF08${Math.round(rate * 100)}%\uFF09\uFF0C\u5907\u6CE8\u7C7B\u5B57\u6BB5\u5141\u8BB8\u7559\u7A7A\uFF0C\u4E0D\u8BA1\u4E3A\u8D28\u91CF\u95EE\u9898`, suggestion: "\u65E0\u9700\u5904\u7406" });
      } else if (rate > 0.2 && rows.length >= 4) {
        const rule = findFillRule(rows, col.name, columns);
        if (rule) {
          issues.push({ col: col.name, severity: "info", type: "\u7ED3\u6784\u6027\u7F3A\u5931", detail: `${miss} \u884C\u4E3A\u7A7A\uFF08${Math.round(rate * 100)}%\uFF09\u2014\u2014\u8BE5\u5217\u4EC5\u5F53\u300C${rule.dim} = ${rule.value}\u300D\u65F6\u586B\u5199\uFF0C\u5C5E\u4E92\u65A5\u6761\u4EF6\u5B57\u6BB5\uFF0C\u6570\u636E\u672C\u8EAB\u5B8C\u6574`, suggestion: `\u65E0\u9700\u5904\u7406\uFF0C\u5206\u6790\u65F6\u4F1A\u6309\u300C${rule.dim}\u300D\u5206\u7EC4\u89E3\u8BFB` });
        } else {
          issues.push({ col: col.name, severity: "high", type: "\u7F3A\u5931\u503C", detail: `\u5171 ${miss} \u884C\u7F3A\u5931\uFF08${Math.round(rate * 100)}%\uFF09`, suggestion: "\u5EFA\u8BAE\u586B\u5145\u5747\u503C/\u4E2D\u4F4D\u6570\u6216\u5254\u9664\u8BE5\u884C\u540E\u518D\u5206\u6790" });
          penalty += Math.min(40, rate * 60);
        }
      } else {
        issues.push({ col: col.name, severity: rate > 0.2 ? "high" : "medium", type: "\u7F3A\u5931\u503C", detail: `\u5171 ${miss} \u884C\u7F3A\u5931\uFF08${Math.round(rate * 100)}%\uFF09`, suggestion: "\u5EFA\u8BAE\u586B\u5145\u5747\u503C/\u4E2D\u4F4D\u6570\u6216\u5254\u9664\u8BE5\u884C\u540E\u518D\u5206\u6790" });
        penalty += Math.min(40, rate * 60);
      }
    }
    if (col.type === "number") {
      const nums = vals.filter(isNumeric).map(toNum);
      const bad = vals.filter((v) => !isEmpty(v) && !isNumeric(v)).length;
      if (bad > 0) {
        issues.push({ col: col.name, severity: "high", type: "\u7C7B\u578B\u51B2\u7A81", detail: `${bad} \u4E2A\u503C\u975E\u6570\u503C\uFF0C\u65E0\u6CD5\u53C2\u4E0E\u8BA1\u7B97`, suggestion: "\u6E05\u6D17\u4E3A\u6570\u503C\u6216\u6807\u8BB0\u4E3A\u5F02\u5E38" });
        penalty += Math.min(50, bad / total * 80);
      }
      if (nums.length >= 4) {
        const sorted = [...nums].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const out = nums.filter((n) => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length;
        if (out > 0) {
          issues.push({ col: col.name, severity: out > nums.length * 0.1 ? "medium" : "low", type: "\u5F02\u5E38\u503C", detail: `\u68C0\u51FA ${out} \u4E2A\u53EF\u80FD\u7684\u79BB\u7FA4\u70B9\uFF08IQR \u6CD5\uFF09`, suggestion: "\u786E\u8BA4\u662F\u5426\u4E3A\u5F55\u5165\u9519\u8BEF\u6216\u771F\u5B9E\u6781\u503C" });
          penalty += Math.min(10, out / nums.length * 20);
        }
      }
      if (uniq(nums).length === 1) {
        issues.push({ col: col.name, severity: "low", type: "\u5E38\u91CF\u5217", detail: "\u8BE5\u5217\u6240\u6709\u503C\u76F8\u540C\uFF0C\u65E0\u5206\u6790\u4EF7\u503C", suggestion: "\u53EF\u4ECE\u5206\u6790\u4E2D\u79FB\u9664" });
        penalty += 5;
      }
    }
  });
  const seen = /* @__PURE__ */ new Set();
  let dups = 0;
  rows.forEach((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) dups++;
    else seen.add(k);
  });
  if (dups > 0) {
    issues.push({ col: "\u6574\u884C", severity: dups > 1 ? "medium" : "low", type: "\u91CD\u590D\u884C", detail: `\u53D1\u73B0 ${dups} \u884C\u5B8C\u5168\u91CD\u590D`, suggestion: "\u5EFA\u8BAE\u53BB\u91CD" });
    penalty += Math.min(20, dups / (rows.length || 1) * 30);
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, issues };
}
function copyRows(rows) {
  return rows.map((r) => ({ ...r }));
}
function cleanFillMissing(rows, colMap, { strategy = "mean", constValue } = {}) {
  const cols = colMap == null ? [] : Array.isArray(colMap) ? colMap : [colMap];
  const out = copyRows(rows);
  const stats = [];
  for (const col of cols) {
    const missIdx = [];
    rows.forEach((r, i) => {
      if (isEmpty(r[col])) missIdx.push(i);
    });
    const filled = missIdx.length;
    if (!filled) {
      stats.push({ col, filled: 0 });
      continue;
    }
    const nonEmpty = rows.map((r) => r[col]).filter((v) => !isEmpty(v));
    const numeric = nonEmpty.length > 0 && nonEmpty.every(isNumeric);
    const strat = numeric || strategy === "mode" || strategy === "const" ? strategy : "mode";
    let fillValue = constValue == null ? "" : constValue;
    if (strat === "mean") {
      const nums = nonEmpty.map(toNum);
      fillValue = String(nums.reduce((a, b) => a + b, 0) / nums.length);
    } else if (strat === "median") {
      const nums = nonEmpty.map(toNum).sort((a, b) => a - b);
      const mid = Math.floor(nums.length / 2);
      fillValue = String(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2);
    } else if (strat === "mode") {
      if (nonEmpty.length) {
        const freq = {};
        nonEmpty.forEach((v) => {
          const k = String(v);
          freq[k] = (freq[k] || 0) + 1;
        });
        let best = null, bestN = 0;
        for (const k of Object.keys(freq)) {
          if (freq[k] > bestN) {
            bestN = freq[k];
            best = k;
          }
        }
        fillValue = best;
      }
    }
    missIdx.forEach((i) => {
      out[i][col] = String(fillValue);
    });
    stats.push({ col, filled });
  }
  return { rows: out, stats };
}
function cleanTrim(rows, cols = null) {
  const allCols = [];
  rows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (!allCols.includes(k)) allCols.push(k);
    });
  });
  const targets = cols && cols.length ? cols : allCols;
  const out = copyRows(rows);
  const stats = [];
  for (const col of targets) {
    let trimmed = 0;
    out.forEach((r) => {
      const v = r[col];
      if (typeof v === "string") {
        const t = v.trim();
        if (t !== v) {
          r[col] = t;
          trimmed++;
        }
      }
    });
    stats.push({ col, trimmed });
  }
  return { rows: out, stats };
}
function cleanDedupe(rows, cols = null) {
  const keyCols = cols && cols.length ? cols : Object.keys(rows[0] || {});
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  let dupsRemoved = 0;
  for (const r of rows) {
    const key = JSON.stringify(keyCols.map((c) => r[c]));
    if (seen.has(key)) {
      dupsRemoved++;
      continue;
    }
    seen.add(key);
    out.push({ ...r });
  }
  return { rows: out, stats: { dupsRemoved, keyCols } };
}
function cleanOutliers(rows, col, { method = "IQR", action = "dropRow" } = {}) {
  const nums = rows.map((r) => toNum(r[col])).filter((v) => !isNaN(v));
  const badValues = /* @__PURE__ */ new Set();
  if (nums.length >= 4) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (method === "3sigma") {
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const sd = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length);
      sorted.forEach((v) => {
        if (Math.abs(v - mean) > 3 * sd) badValues.add(v);
      });
    } else {
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      sorted.forEach((v) => {
        if (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) badValues.add(v);
      });
    }
  }
  const out = [];
  let count = 0;
  for (const r of rows) {
    const v = toNum(r[col]);
    const isBad = !isNaN(v) && badValues.has(v);
    if (isBad) count++;
    if (isBad && action === "dropRow") continue;
    const nr = { ...r };
    if (isBad && action === "mask") nr[col] = "";
    out.push(nr);
  }
  return { rows: out, stats: { col, count, method } };
}
function pickGranularity(rows, timeCol) {
  const ts = [];
  for (const r of rows) {
    const raw = r[timeCol];
    if (isEmpty(raw) || !isDate(raw)) continue;
    ts.push(Date.parse(normDate(raw)));
  }
  if (!ts.length) return "day";
  const tmin = Math.min(...ts), tmax = Math.max(...ts);
  const days = (tmax - tmin) / 864e5;
  if (days <= 31) return "day";
  const a = new Date(tmin), b = new Date(tmax);
  const monthDiff = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return monthDiff <= 18 ? "month" : "year";
}
function timeSeries(table, timeCol, measureCol, { granularity = "auto", op = "sum" } = {}) {
  const rows = table && table.rows || [];
  const OP_SET = ["sum", "avg", "count", "max", "min"];
  const op2 = OP_SET.includes(op) ? op : "sum";
  const pts = [];
  for (const r of rows) {
    const raw = r[timeCol];
    if (isEmpty(raw) || !isDate(raw)) continue;
    const v = toNum(r[measureCol]);
    if (isNaN(v)) continue;
    const d = new Date(Date.parse(normDate(raw)));
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    pts.push({ ymd, v });
  }
  if (!pts.length) return [];
  const gr = granularity === "auto" ? pickGranularity(rows, timeCol) : ["day", "month", "year"].includes(granularity) ? granularity : "day";
  const bucketOf = (p) => gr === "day" ? p.ymd : gr === "month" ? p.ymd.slice(0, 7) : p.ymd.slice(0, 4);
  const map = {};
  pts.forEach((p) => {
    const k = bucketOf(p);
    (map[k] = map[k] || []).push(p.v);
  });
  return Object.entries(map).map(([bucket, vs]) => {
    let value;
    if (op2 === "avg") value = vs.reduce((a, b) => a + b, 0) / vs.length;
    else if (op2 === "count") value = vs.length;
    else if (op2 === "max") value = Math.max(...vs);
    else if (op2 === "min") value = Math.min(...vs);
    else value = vs.reduce((a, b) => a + b, 0);
    return { bucket, value };
  }).sort((a, b) => a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0);
}
function topN(table, dimCol, measureCol, { n = 10, op = "sum" } = {}) {
  return groupAgg(table && table.rows || [], dimCol, measureCol, op).slice(0, n).map((a) => ({ name: a.name, value: a.value }));
}
function groupAgg(rows, dimKey, measureKey, op = "sum") {
  const map = {};
  rows.forEach((r) => {
    const k = r[dimKey];
    const v = toNum(r[measureKey]);
    if (isEmpty(k) || isNaN(v)) return;
    if (!map[k]) map[k] = [];
    map[k].push(v);
  });
  return Object.entries(map).map(([name, vs]) => {
    let value;
    if (op === "avg") value = vs.reduce((a, b) => a + b, 0) / vs.length;
    else if (op === "count") value = vs.length;
    else if (op === "max") value = Math.max(...vs);
    else if (op === "min") value = Math.min(...vs);
    else value = vs.reduce((a, b) => a + b, 0);
    return { name, value };
  }).sort((a, b) => b.value - a.value);
}
function avg(arr) {
  const n = arr.filter((v) => !isNaN(v));
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : NaN;
}
function histogram(rows, key, bins = 10) {
  const nums = rows.map((r) => toNum(r[key])).filter((v) => !isNaN(v));
  if (!nums.length) return [];
  const min = Math.min(...nums), max = Math.max(...nums);
  const width = (max - min) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ label: `${Math.round(min + i * width)}-${Math.round(min + (i + 1) * width)}`, value: 0 }));
  nums.forEach((v) => {
    let idx = Math.min(bins - 1, Math.floor((v - min) / width));
    out[idx].value++;
  });
  return out;
}
var ACCENT = "#8B7EC8";
var PALETTE = ["#8B7EC8", "#8b5cf6", "#A99BD9", "#6B6577", "#C9B8EC", "#B0A4DD"];
function axisBase() {
  return {
    axisLabel: { color: "#6B6577", fontSize: 11 },
    axisLine: { lineStyle: { color: "#E8E5F0" } },
    splitLine: { lineStyle: { color: "#E8E5F0" } }
  };
}
function barOption(cats, vals, name) {
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: "#2A2733", fontWeight: 600 } },
    xAxis: { type: "category", data: cats, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: 0, rotate: cats.length > 6 ? 32 : 0 } },
    yAxis: { type: "value", ...axisBase() },
    series: [{ type: "bar", data: vals, itemStyle: { color: ACCENT, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 30 }]
  };
}
function lineOption(cats, vals, name) {
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: "#2A2733", fontWeight: 600 } },
    xAxis: { type: "category", data: cats, boundaryGap: false, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: "auto", rotate: cats.length > 8 ? 32 : 0 } },
    yAxis: { type: "value", ...axisBase() },
    series: [{ type: "line", data: vals, smooth: true, symbol: "circle", symbolSize: 5, itemStyle: { color: ACCENT }, lineStyle: { width: 2, color: ACCENT }, areaStyle: { color: "rgba(139,126,200,.10)" } }]
  };
}
function pieOption(items, name) {
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: "#2A2733", fontWeight: 600 } },
    legend: { bottom: 0, textStyle: { color: "#6B6577", fontSize: 11 }, type: "scroll" },
    color: PALETTE,
    series: [{ type: "pie", radius: ["42%", "66%"], center: ["50%", "46%"], data: items, label: { color: "#2A2733", fontSize: 11 }, itemStyle: { borderColor: "#fff", borderWidth: 2 } }]
  };
}
function histOption(bins, name) {
  return barOption(bins.map((b) => b.label), bins.map((b) => b.value), name);
}
function scatterOption(points, name) {
  return {
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: "item" },
    title: { text: name, left: 0, top: 0, textStyle: { fontSize: 13, color: "#2A2733", fontWeight: 600 } },
    xAxis: { ...axisBase() },
    yAxis: { ...axisBase() },
    series: [{ type: "scatter", data: points, symbolSize: 8, itemStyle: { color: "rgba(139,126,200,.7)" } }]
  };
}
function analyze(table) {
  const t = inferSchema(table);
  const { columns, rows } = t;
  const sampled = rows.length > SAMPLE_ANALYZE_THRESHOLD ? { enabled: true, total: rows.length, used: SAMPLE_ANALYZE_THRESHOLD, note: "\u7B49\u8DDD\u62BD\u6837" } : { enabled: false };
  const workRows = sampled.enabled ? sampleRows(rows, SAMPLE_ANALYZE_THRESHOLD) : rows;
  const workTable = { columns, rows: workRows };
  const totalRows = sampled.enabled ? sampled.total : rows.length;
  const sp = () => sampled.enabled ? `\u91C7\u6837\u53E3\u5F84\uFF1A${fmt(sampled.used)}/${fmt(sampled.total)} \u884C\uFF08\u7B49\u8DDD\u62BD\u6837\uFF09\uFF1B` : "";
  const measures = columns.filter((c) => c.semantic === "measure").filter((mm) => uniq(workRows.map((r) => r[mm.name]).filter((v) => !isEmpty(v))).length > 1);
  const dims = columns.filter((c) => c.semantic === "dimension");
  const times = columns.filter((c) => c.semantic === "time");
  const charts = [];
  const insights = [];
  measures.slice(0, 3).forEach((m) => {
    if (times.length) {
      const timeCol = times[0].name;
      const gr = pickGranularity(workRows, timeCol);
      const grLabel = gr === "day" ? "\u65E5" : gr === "month" ? "\u6708" : "\u5E74";
      const ts = timeSeries(workTable, timeCol, m.name, { granularity: gr, op: "sum" });
      const cats = ts.map((x) => x.bucket);
      const vals = ts.map((x) => x.value);
      if (cats.length) {
        charts.push({ id: `line_${m.name}`, title: `${m.name} \u8D8B\u52BF`, type: "line", option: lineOption(cats, vals, `${m.name}\u8D8B\u52BF`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${timeCol} ${grLabel}\u805A\u5408 \xB7 \u5408\u8BA1\uFF0C\u5171 ${cats.length} \u4E2A${grLabel}\u5EA6\u70B9\u3002` });
      }
      if (vals.length >= 2) {
        const half = Math.floor(vals.length / 2);
        const first = avg(vals.slice(0, half)), last = avg(vals.slice(half));
        const pct = first ? (last - first) / first * 100 : 0;
        const txt = `\u300C${m.name}\u300D\u6574\u4F53\u5448${pct >= 0 ? "\u4E0A\u5347" : "\u4E0B\u964D"}\u8D8B\u52BF\uFF0C${grLabel}\u5EA6\u540E\u534A\u6BB5\u5747\u503C ${fmt(last)}\uFF0C\u8F83\u524D\u534A\u6BB5\uFF08${fmt(first)}\uFF09\u53D8\u5316 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%\u3002`;
        insights.push({ icon: "trend", text: txt, caliber: sp() + `\u53E3\u5F84\uFF1A\u805A\u5408\u5E8F\u5217\u524D\u534A\u6BB5 vs \u540E\u534A\u6BB5\u5747\u503C\u5BF9\u6BD4\uFF08\u771F\u5B9E\u8BA1\u7B97\uFF09\u3002` });
      }
    } else if (dims.length) {
      const dim = dims[0].name;
      const agg = groupAgg(workRows, dim, m.name, "sum").slice(0, 12);
      charts.push({ id: `bar_${m.name}`, title: `${dim} \u7684${m.name}\u5408\u8BA1`, type: "bar", option: barOption(agg.map((a) => a.name), agg.map((a) => a.value), `${dim}\xB7${m.name}\u5408\u8BA1`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${dim} \u5206\u7EC4\uFF0C\u5BF9 ${m.name} \u53D6\u5408\u8BA1\uFF0C\u53D6\u524D 12 \u9879\u3002` });
      if (agg.length) {
        const top = agg[0], bottom = agg[agg.length - 1];
        insights.push({ icon: "rank", text: `\u300C${m.name}\u300D\u6700\u9AD8\u7684 ${dim} \u662F ${top.name}\uFF08${fmt(top.value)}\uFF09\uFF0C\u6700\u4F4E\u662F ${bottom.name}\uFF08${fmt(bottom.value)}\uFF09\uFF0C\u76F8\u5DEE ${fmt(top.value - bottom.value)}\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${dim} \u5206\u7EC4\u5408\u8BA1\u540E\u53D6\u6781\u503C\u3002` });
      }
    } else {
      const bins = histogram(workRows, m.name, 10);
      charts.push({ id: `hist_${m.name}`, title: `${m.name} \u5206\u5E03`, type: "bar", option: histOption(bins, `${m.name}\u5206\u5E03`), caliber: sp() + `\u53E3\u5F84\uFF1A\u7B49\u5206 10 \u7BB1\u7EDF\u8BA1\u9891\u6570\u3002` });
      const vals = workRows.map((r) => toNum(r[m.name])).filter((v) => !isNaN(v));
      insights.push({ icon: "dist", text: `\u300C${m.name}\u300D\u5747\u503C ${fmt(avg(vals))}\uFF0C\u533A\u95F4 ${fmt(Math.min(...vals))} ~ ${fmt(Math.max(...vals))}\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u6781\u503C\u4E0E\u5747\u503C\u5747\u4E3A\u771F\u5B9E\u8BA1\u7B97\u3002` });
    }
  });
  const pieDims = dims.filter((d) => d.cardinality >= 2 && d.cardinality <= 12);
  const pieDone = /* @__PURE__ */ new Set();
  pieDims.slice(0, 3).forEach((dim) => {
    if (charts.length >= 6) return;
    const freq = workRows.reduce((acc, r) => {
      const k = r[dim.name];
      if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    const items = Object.entries(freq).map(([name, value]) => ({ name: genderLabel(dim.name, name), value })).sort((a, b) => b.value - a.value);
    if (!items.length) return;
    charts.push({ id: `pie_${dim.name}`, title: `${dim.name} \u6784\u6210`, type: "pie", option: pieOption(items, `${dim.name}\u6784\u6210`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${dim.name} \u7EDF\u8BA1\u884C\u9891\u3002` });
    pieDone.add(dim.name);
    const top = items[0];
    insights.push({ icon: "share", text: `\u300C${dim.name}\u300D\u4E2D ${top.name} \u5360\u6BD4\u6700\u9AD8\uFF0C\u5171 ${top.value} \u6761\uFF08${Math.round(top.value / totalRows * 100)}%\uFF09\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u884C\u9891\u5360\u6BD4\u3002` });
  });
  if (measures.length && dims.length && charts.length < 6) {
    const isCodeName = (n) => /(category|cat_|类目|分类|code|编码|type_id|group_id)/i.test(n);
    const readableDims = dims.filter((d) => d.cardinality >= 2 && d.cardinality <= 8 && !isCodeName(d.name) && !looksLikeId(d.name, workRows.map((r) => r[d.name]).filter((v) => !isEmpty(v)), workRows.length));
    const xDim = readableDims[0] || dims.find((d) => d.cardinality >= 2 && d.cardinality <= 8);
    if (xDim) {
      const mm = measures[0];
      const grp = {};
      workRows.forEach((r) => {
        const k = r[xDim.name];
        const v = toNum(r[mm.name]);
        if (isEmpty(k) || isNaN(v)) return;
        (grp[k] = grp[k] || []).push(v);
      });
      const items = Object.entries(grp).map(([name, vs]) => ({ name: genderLabel(xDim.name, name), value: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length * 10) / 10 })).sort((a, b) => b.value - a.value);
      if (items.length >= 2) {
        charts.push({ id: `bar_${xDim.name}_avg${mm.name}`, title: `${xDim.name} \xD7 ${mm.name} \u5747\u503C`, type: "bar", option: barOption(items.map((a) => a.name), items.map((a) => a.value), `${xDim.name}\xB7${mm.name}\u5747\u503C`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${xDim.name} \u5206\u7EC4\u5BF9 ${mm.name} \u53D6\u5747\u503C\uFF08\u771F\u5B9E\u8BA1\u7B97\uFF09\u3002` });
        const hi = items[0], lo = items[items.length - 1];
        insights.push({ icon: "cross", text: `\u4EA4\u53C9\u5206\u6790\uFF1A\u300C${xDim.name}\u300D\u4E2D ${hi.name} \u7684\u300C${mm.name}\u300D\u5747\u503C\u6700\u9AD8\uFF08${fmt(hi.value)}\uFF09\uFF0C${lo.name} \u6700\u4F4E\uFF08${fmt(lo.value)}\uFF09\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u5206\u7EC4\u5747\u503C\u5BF9\u6BD4\uFF08\u771F\u5B9E\u8BA1\u7B97\uFF09\u3002` });
      }
    }
  }
  if (measures.length >= 2 && charts.length < 6) {
    const [a, b] = measures;
    const pts = workRows.map((r) => [toNum(r[a.name]), toNum(r[b.name])]).filter((p) => !isNaN(p[0]) && !isNaN(p[1])).slice(0, 120);
    charts.push({ id: `scatter_${a.name}_${b.name}`, title: `${a.name} \xD7 ${b.name}`, type: "scatter", option: scatterOption(pts, `${a.name}\xD7${b.name}`), caliber: sp() + `\u53E3\u5F84\uFF1A\u4E24\u5EA6\u91CF\u539F\u59CB\u503C\u6563\u70B9\uFF08\u62BD\u6837 120 \u70B9\uFF09\u3002` });
  }
  if (measures.length && dims.length && charts.length < 6) {
    const avoidDim = times.length ? null : dims[0] && dims[0].name;
    const isCodeName = (n) => /(category|cat_|类目|分类|code|编码|type_id|group_id)/i.test(n);
    const candidates = dims.filter(
      (d) => d.cardinality >= 2 && d.cardinality <= 200 && !isCodeName(d.name) && !looksLikeId(d.name, workRows.map((r) => r[d.name]).filter((v) => !isEmpty(v)), workRows.length) && d.name !== avoidDim
    ).sort((a, b) => b.cardinality - a.cardinality);
    const topDim = candidates[0] || (avoidDim ? null : dims.find((d) => d.cardinality >= 2 && d.cardinality <= 200));
    if (topDim) {
      const items = topN(workTable, topDim.name, measures[0].name, { n: 10, op: "sum" });
      if (items.length >= 2) {
        const nn = Math.min(10, items.length);
        charts.push({ id: `top_${topDim.name}`, title: `Top${nn} ${topDim.name}`, type: "bar", option: barOption(items.map((a) => genderLabel(topDim.name, a.name)), items.map((a) => a.value), `Top${nn}\xB7${topDim.name}\xB7${measures[0].name}`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${topDim.name} \u5206\u7EC4\u5BF9 ${measures[0].name} \u53D6\u5408\u8BA1\uFF0C\u964D\u5E8F\u53D6\u524D ${nn} \u540D\u3002` });
      }
    }
  }
  if (measures.length === 0 && dims.length) {
    const catCols = columns.filter((c) => c.semantic !== "measure" && c.semantic !== "time");
    const analyticDims = catCols.filter((d) => {
      const nonEmpty = workRows.map((r) => r[d.name]).filter((v) => !isEmpty(v));
      if (looksLikeId(d.name, nonEmpty, nonEmpty.length || 1)) return false;
      if (d.cardinality >= totalRows) return false;
      return true;
    });
    const lowCard = analyticDims.filter((d) => d.cardinality >= 2 && d.cardinality <= 12 && !pieDone.has(d.name));
    lowCard.slice(0, 4).forEach((d) => {
      if (charts.length >= 6) return;
      const freq = workRows.reduce((acc, r) => {
        const k = r[d.name];
        if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      if (!items.length) return;
      charts.push({ id: `pie_${d.name}`, title: `${d.name} \u6784\u6210`, type: "pie", option: pieOption(items, `${d.name}\u6784\u6210`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${d.name} \u7EDF\u8BA1\u884C\u9891\uFF08\u5171 ${items.reduce((s, x) => s + x.value, 0)} \u6761\u6709\u6548\uFF09\u3002` });
      const top = items[0];
      insights.push({ icon: "share", text: `\u300C${d.name}\u300D\u4E2D ${top.name} \u5360\u6BD4\u6700\u9AD8\uFF0C\u5171 ${top.value} \u4EBA\uFF08${Math.round(top.value / totalRows * 100)}%\uFF09\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u884C\u9891 \xF7 \u603B\u884C\u6570\u3002` });
    });
    const midCard = analyticDims.filter((d) => d.cardinality > 12);
    midCard.slice(0, 2).forEach((d) => {
      if (charts.length >= 6) return;
      const freq = workRows.reduce((acc, r) => {
        const k = r[d.name];
        if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);
      if (!items.length) return;
      charts.push({ id: `bar_${d.name}`, title: `${d.name} \u5206\u5E03\uFF08\u524D 12\uFF09`, type: "bar", option: barOption(items.map((a) => a.name), items.map((a) => a.value), `${d.name}\xB7\u8BA1\u6570`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${d.name} \u5206\u7EC4\u8BA1\u6570\uFF0C\u53D6\u524D 12 \u9879\u3002` });
      insights.push({ icon: "rank", text: `\u300C${d.name}\u300D\u51FA\u73B0\u6700\u591A\u7684\u662F ${items[0].name}\uFF08${items[0].value} \u4EBA\uFF09\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u5206\u7EC4\u8BA1\u6570\u53D6\u6781\u503C\u3002` });
    });
    const statusCol = dims.find((d) => /(就业状态|就业情况|就业类别)/.test(d.name)) || dims.find((d) => /(状态|就业)/.test(d.name) && d.cardinality <= 8 && d.cardinality >= 2);
    const eduCol = dims.find((d) => /(学历|教育|学位|层次)/.test(d.name));
    if (statusCol && eduCol) {
      const cross = {};
      workRows.forEach((r) => {
        const s = r[statusCol.name], e = r[eduCol.name];
        if (isEmpty(s) || isEmpty(e)) return;
        cross[s] = cross[s] || {};
        cross[s][e] = (cross[s][e] || 0) + 1;
      });
      const statuses = Object.keys(cross);
      if (statuses.length) {
        let best = null;
        statuses.forEach((s) => Object.entries(cross[s]).forEach(([e, c]) => {
          if (!best || c > best.c) best = { s, e, c };
        }));
        insights.push({ icon: "cross", text: `\u4EA4\u53C9\u5206\u6790\uFF1A\u300C${statusCol.name}=${best.s}\u300D\u7FA4\u4F53\u91CC\u4EE5\u300C${eduCol.name}=${best.e}\u300D\u6700\u591A\uFF08${best.c} \u4EBA\uFF09\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A${statusCol.name} \xD7 ${eduCol.name} \u8BA1\u6570\u53D6\u6781\u503C\uFF08\u771F\u5B9E\u8BA1\u7B97\uFF09\u3002` });
      }
    }
    if (times.length && charts.length < 6) {
      const tf = times[0];
      const yearFreq = {};
      workRows.forEach((r) => {
        const s = String(r[tf.name]).trim().replace(/-|\//g, "").slice(0, 4);
        if (/^\d{4}$/.test(s)) yearFreq[s] = (yearFreq[s] || 0) + 1;
      });
      const yrs = Object.entries(yearFreq).sort((a, b) => a[0] > b[0] ? 1 : -1);
      if (yrs.length >= 2) {
        charts.push({ id: `bar_year_${tf.name}`, title: `${tf.name} \u5E74\u4EFD\u5206\u5E03`, type: "bar", option: barOption(yrs.map((x) => x[0]), yrs.map((x) => x[1]), `${tf.name}\u5E74\u4EFD\u5206\u5E03`), caliber: sp() + `\u53E3\u5F84\uFF1A\u6309 ${tf.name} \u53D6\u524D 4 \u4F4D\u5E74\u4EFD\u7EDF\u8BA1\u9891\u6570\u3002` });
        const top = yrs.reduce((a, b) => a[1] > b[1] ? a : b);
        insights.push({ icon: "rank", text: `\u300C${tf.name}\u300D\u4E2D ${top[0]} \u5E74\u8BB0\u5F55\u6700\u591A\uFF0C\u5171 ${top[1]} \u6761\uFF08${Math.round(top[1] / totalRows * 100)}%\uFF09\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A\u5E74\u4EFD\u9891\u6570\u53D6\u6781\u503C\u3002` });
      }
    }
  }
  const head = measures[0];
  if (head) {
    const vals = workRows.map((r) => toNum(r[head.name])).filter((v) => !isNaN(v));
    insights.unshift({ icon: "summary", text: `\u6570\u636E\u5171 ${totalRows} \u884C\u3001${columns.length} \u5217\uFF1B\u6838\u5FC3\u5EA6\u91CF\u300C${head.name}\u300D\u6574\u4F53\u5747\u503C ${fmt(avg(vals))}\u3002\u5EFA\u8BAE\u4F18\u5148\u6838\u67E5\u4E0B\u65B9\u8D28\u91CF\u8BCA\u65AD\u4E0E\u5F02\u5E38\u70B9\u540E\u518D\u4E0B\u7ED3\u8BBA\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A${sampled.enabled ? "\u62BD\u6837" : "\u5168\u8868"}\u771F\u5B9E\u7EDF\u8BA1\u3002` });
  } else if (dims.length) {
    const named = dims.filter((d) => !/(编号|姓名|证件|手机|账号|编号|备注|id|ID)/.test(d.name));
    const focusList = named.slice(0, 3).map((d) => `\u300C${d.name}\u300D`).join("\u3001") || (named[0] ? `\u300C${named[0].name}\u300D` : "");
    insights.unshift({ icon: "summary", text: `\u6570\u636E\u5171 ${totalRows} \u884C\u3001${columns.length} \u5217\uFF0C\u5168\u90E8\u4E3A\u5206\u7C7B\u578B\u5B57\u6BB5\uFF0C\u5DF2\u81EA\u52A8\u751F\u6210\u5404\u7C7B\u522B\u6784\u6210\u4E0E\u5206\u5E03\u5206\u6790\u3002\u5EFA\u8BAE\u4F18\u5148\u67E5\u770B ${focusList} \u7B49\u7EF4\u5EA6\u7684\u6784\u6210\u4E0E\u4EA4\u53C9\u5173\u7CFB\u3002`, caliber: sp() + `\u53E3\u5F84\uFF1A${sampled.enabled ? "\u62BD\u6837" : "\u5168\u8868"}\u771F\u5B9E\u7EDF\u8BA1\uFF08\u65E0\u6570\u503C\u5EA6\u91CF\uFF0C\u5206\u6790\u4EE5\u9891\u6570\u4E0E\u5360\u6BD4\u4E3A\u4E3B\uFF09\u3002` });
  } else {
    insights.unshift({ icon: "summary", text: `\u6570\u636E\u5171 ${totalRows} \u884C\u3001${columns.length} \u5217\uFF1B\u672A\u8BC6\u522B\u5230\u53EF\u7528\u4E8E\u5206\u6790\u7684\u7EF4\u5EA6\u6216\u5EA6\u91CF\uFF0C\u8BF7\u68C0\u67E5\u5B57\u6BB5\u7C7B\u578B\u3002`, caliber: sp() });
  }
  return { table: t, charts, insights, measures, dims, times, sampled };
}
function joinTables(main, sub, mainKey, subKey, cols, mode = "inner") {
  const subCols = sub.columns;
  const idx = /* @__PURE__ */ new Map();
  sub.rows.forEach((r) => {
    const k = r[subKey];
    if (isEmpty(k) || idx.has(k)) return;
    idx.set(k, r);
  });
  const keepCols = cols && cols.length ? cols.filter((c) => subCols.some((sc) => sc.name === c)) : subCols.filter((sc) => sc.name !== subKey).map((sc) => sc.name);
  const added = keepCols.map((n) => {
    let nn = n, i = 2;
    while (main.columns.some((c) => c.name === nn)) {
      nn = `${n}_${i++}`;
    }
    return { name: nn, src: n };
  });
  const colsOut = [...main.columns.map((c) => ({ name: c.name })), ...added.map((a) => ({ name: a.name }))];
  const rowsOut = [];
  let matched = 0;
  main.rows.forEach((r) => {
    const subRow = idx.get(r[mainKey]);
    if (subRow) {
      const nr = { ...r };
      added.forEach((a) => {
        nr[a.name] = subRow[a.src];
      });
      rowsOut.push(nr);
      matched++;
    } else if (mode === "left") {
      const nr = { ...r };
      added.forEach((a) => {
        nr[a.name] = "";
      });
      rowsOut.push(nr);
    }
  });
  return { columns: colsOut, rows: rowsOut, matched, unmatched: main.rows.length - matched };
}
function previewJoin(main, sub, mainKey, subKey) {
  const idx = /* @__PURE__ */ new Map();
  sub.rows.forEach((r) => {
    const k = r[subKey];
    if (isEmpty(k) || idx.has(k)) return;
    idx.set(k, r);
  });
  let matched = 0;
  main.rows.forEach((r) => {
    if (idx.has(r[mainKey])) matched++;
  });
  const total = main.rows.length;
  return { matched, unmatched: total - matched, total, rate: total ? Math.round(matched / total * 100) : 0 };
}
function guessJoinKeys(main, sub) {
  const keys = (t) => inferSchema(t).columns.filter(
    (c) => /(id|编号|用户|user|手机|email|邮箱|account|账号)/i.test(c.name) || c.semantic === "dimension" && c.cardinality > 1
  ).map((c) => c.name);
  const mKeys = keys(main), sKeys = keys(sub), out = [];
  mKeys.forEach((mk) => sKeys.forEach((sk) => {
    const p = previewJoin(main, sub, mk, sk);
    const same = mk.replace(/[\s_]+/g, "").toLowerCase() === sk.replace(/[\s_]+/g, "").toLowerCase();
    out.push({ mainKey: mk, subKey: sk, ...p, same });
  }));
  out.sort((a, b) => b.same - a.same || b.rate - a.rate || 0);
  return { candidates: out.slice(0, 5), best: out[0] || null };
}
function schemaSummaryFor(table) {
  const t = inferSchema(table);
  return {
    rowCount: t.rows.length,
    columns: t.columns.map((c) => ({ name: c.name, semantic: c.semantic, type: c.type, cardinality: c.cardinality })),
    sampleRows: t.rows.slice(0, 5)
  };
}
function analyzeByPlan(table, plan) {
  if (!plan || !Array.isArray(plan.charts) || !plan.charts.length) return null;
  const t = inferSchema(table);
  const { rows } = t;
  const colByName = Object.fromEntries(t.columns.map((c) => [c.name, c]));
  const measures = t.columns.filter((c) => c.semantic === "measure");
  const dims = t.columns.filter((c) => c.semantic === "dimension");
  const times = t.columns.filter((c) => c.semantic === "time");
  const charts = [];
  plan.charts.slice(0, 5).forEach((p, i) => {
    const type = ["line", "bar", "pie", "histogram", "scatter"].includes(p.chartType) ? p.chartType : "bar";
    const m = p.measure && colByName[p.measure] ? colByName[p.measure] : null;
    const d = p.dimension && colByName[p.dimension] && colByName[p.dimension].semantic === "dimension" ? colByName[p.dimension] : dims[0] || null;
    if (type === "pie" && d && (!m || m.semantic !== "measure")) {
      const freq = rows.reduce((acc, r) => {
        const k = r[d.name];
        if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      charts.push({ id: `plan_pie_${i}`, title, type: "pie", option: pieOption(items, title), caliber: `\u53E3\u5F84\uFF1A\u6309 ${d.name} \u7EDF\u8BA1\u884C\u9891\u3002` });
      return;
    }
    if (!m || m.semantic !== "measure") return;
    const tf = p.timeField && colByName[p.timeField] && colByName[p.timeField].semantic === "time" ? colByName[p.timeField] : times[0] || null;
    const op = ["sum", "avg", "count", "max", "min"].includes(p.aggregation) ? p.aggregation : "sum";
    const title = p.title || `${m.name}\uFF08${op === "sum" ? "\u5408\u8BA1" : op === "avg" ? "\u5747\u503C" : op}\uFF09`;
    if (type === "line" && tf) {
      const ts = timeSeries({ columns: t.columns, rows }, tf.name, m.name, { granularity: "auto", op });
      if (ts.length) {
        const gr = pickGranularity(rows, tf.name);
        const grLabel = gr === "day" ? "\u65E5" : gr === "month" ? "\u6708" : "\u5E74";
        charts.push({ id: `plan_line_${i}`, title, type: "line", option: lineOption(ts.map((x) => x.bucket), ts.map((x) => x.value), title), caliber: `\u53E3\u5F84\uFF1A\u6309 ${tf.name} ${grLabel}\u805A\u5408\uFF0C\u5BF9 ${m.name} \u53D6 ${op}\u3002` });
      }
    } else if (type === "pie" && d && d.cardinality <= 20) {
      const freq = rows.reduce((acc, r) => {
        const k = r[d.name];
        if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      charts.push({ id: `plan_pie_${i}`, title, type: "pie", option: pieOption(items, title), caliber: `\u53E3\u5F84\uFF1A\u6309 ${d.name} \u7EDF\u8BA1\u884C\u9891\u3002` });
    } else if (type === "histogram") {
      const bins = histogram(rows, m.name, 10);
      charts.push({ id: `plan_hist_${i}`, title, type: "bar", option: histOption(bins, title), caliber: `\u53E3\u5F84\uFF1A\u7B49\u5206 10 \u7BB1\u7EDF\u8BA1\u9891\u6570\u3002` });
    } else if (type === "scatter" && measures.length >= 2) {
      const other = measures.find((x) => x.name !== m.name) || m;
      const pts = rows.map((r) => [toNum(r[m.name]), toNum(r[other.name])]).filter((p2) => !isNaN(p2[0]) && !isNaN(p2[1])).slice(0, 120);
      charts.push({ id: `plan_scatter_${i}`, title, type: "scatter", option: scatterOption(pts, title), caliber: `\u53E3\u5F84\uFF1A${m.name} \xD7 ${other.name} \u6563\u70B9\uFF08\u62BD\u6837 120 \u70B9\uFF09\u3002` });
    } else if (d) {
      const agg = groupAgg(rows, d.name, m.name, op).slice(0, 12);
      charts.push({ id: `plan_bar_${i}`, title, type: "bar", option: barOption(agg.map((a) => a.name), agg.map((a) => a.value), title), caliber: `\u53E3\u5F84\uFF1A\u6309 ${d.name} \u5206\u7EC4\uFF0C\u5BF9 ${m.name} \u53D6 ${op}\uFF0C\u524D 12 \u9879\u3002` });
    }
  });
  if (!charts.length) return null;
  const base = analyze(table);
  return { ...base, charts: charts.slice(0, 6), insights: base.insights };
}
function buildStatSummary(table, analysis, quality) {
  return {
    \u6570\u636E\u89C4\u6A21: { \u884C\u6570: table.rows.length, \u5217\u6570: table.columns.length },
    \u6570\u636E\u8D28\u91CF\u8BC4\u5206: quality.score,
    \u8D28\u91CF\u95EE\u9898\u6570: quality.issues.length,
    \u56FE\u8868\u7ED3\u8BBA: analysis.charts.map((c) => ({ \u56FE\u8868: c.title, \u7ED3\u8BBA: c.insightText || c.caliber, \u53E3\u5F84: c.caliber })),
    \u6838\u5FC3\u7ED3\u8BBA: analysis.insights.map((i) => ({ \u7ED3\u8BBA: i.text, \u53E3\u5F84: i.caliber })),
    \u8BF4\u660E: "\u4EE5\u4E0A\u6570\u5B57\u5747\u7531\u4EE3\u7801\u771F\u5B9E\u8BA1\u7B97\u3002\u8BF7\u6539\u5199\u4E3A\u4E1A\u52A1\u8BED\u8A00\uFF0C\u4E25\u7981\u65B0\u589E/\u4FEE\u6539\u4EFB\u4F55\u6570\u5B57\u3002"
  };
}
function executeIntent(table, intent) {
  if (!intent || !intent.metric) return null;
  const t = inferSchema(table);
  const { rows } = t;
  const measures = t.columns.filter((c) => c.semantic === "measure");
  const dims = t.columns.filter((c) => c.semantic === "dimension");
  const times = t.columns.filter((c) => c.semantic === "time");
  const m = measures.find((c) => c.name === intent.metric) || measures.find((c) => c.name.includes(intent.metric) || intent.metric.includes(c.name));
  if (!m) return null;
  const d = intent.dim && (dims.find((c) => c.name === intent.dim) || dims.find((c) => c.name.includes(intent.dim))) || dims[0] || null;
  const op = intent.op || "max";
  const clean = rows.filter((r) => !isEmpty(r[m.name]) && !isNaN(toNum(r[m.name])));
  if (!clean.length) return null;
  const vals = clean.map((r) => toNum(r[m.name]));
  if (op === "max" || op === "min") {
    const v = op === "max" ? Math.max(...vals) : Math.min(...vals);
    const row = clean.find((r) => toNum(r[m.name]) === v);
    const where = d ? `\uFF08${d.name}="${row[d.name]}"\uFF09` : times[0] ? `\uFF08${times[0].name}=${row[times[0].name]}\uFF09` : "";
    return { text: `\u300C${m.name}\u300D${op === "max" ? "\u6700\u9AD8" : "\u6700\u4F4E"}\u4E3A ${fmt(v)}${where}\uFF0C\u5171 ${vals.length} \u4E2A\u6709\u6548\u503C\u53C2\u4E0E\u6BD4\u8F83\u3002`, chart: null };
  }
  if (op === "avg") return { text: `\u300C${m.name}\u300D\u5747\u503C\u4E3A ${fmt(avg(vals))}\uFF08${vals.length} \u4E2A\u6709\u6548\u503C\uFF09\u3002`, chart: null };
  if (op === "sum") return { text: `\u300C${m.name}\u300D\u5408\u8BA1\u4E3A ${fmt(vals.reduce((a, b) => a + b, 0))}\uFF08${vals.length} \u4E2A\u6709\u6548\u503C\uFF09\u3002`, chart: null };
  if (op === "trend" && times[0]) {
    const tf = times[0];
    const sorted = [...clean].sort((a, b) => Date.parse(normDate(a[tf.name])) - Date.parse(normDate(b[tf.name])));
    const vs = sorted.map((r) => toNum(r[m.name]));
    const half = Math.floor(vs.length / 2);
    const first = avg(vs.slice(0, half)), last = avg(vs.slice(half));
    const pct = first ? (last - first) / first * 100 : 0;
    return {
      text: `\u300C${m.name}\u300D\u6574\u4F53\u5448${pct >= 0 ? "\u4E0A\u5347" : "\u4E0B\u964D"}\u8D8B\u52BF\uFF0C\u540E\u534A\u6BB5\u5747\u503C\u8F83\u524D\u534A\u6BB5\u53D8\u5316 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%\uFF08${fmt(first)} \u2192 ${fmt(last)}\uFF09\u3002`,
      chart: { id: "intent_line", title: `${m.name}\u8D8B\u52BF`, type: "line", option: lineOption(sorted.map((r) => r[tf.name]), vs, `${m.name}\u8D8B\u52BF`), caliber: "\u53E3\u5F84\uFF1A\u6309\u65F6\u95F4\u5347\u5E8F\uFF0C\u524D\u540E\u534A\u6BB5\u5747\u503C\u5BF9\u6BD4\u3002" }
    };
  }
  if (op === "share" && d) {
    const agg = groupAgg(rows, d.name, m.name, "sum");
    const total = agg.reduce((s, a) => s + a.value, 0);
    const top = agg[0];
    return {
      text: `\u6309 ${d.name} \u5408\u8BA1\uFF0C\u300C${top.name}\u300D\u8D21\u732E\u6700\u9AD8\uFF1A${fmt(top.value)}\uFF0C\u5360 ${total ? (top.value / total * 100).toFixed(1) : 0}%\u3002`,
      chart: { id: "intent_pie", title: `${d.name} \xB7 ${m.name}\u5360\u6BD4`, type: "pie", option: pieOption(agg.slice(0, 8).map((a) => ({ name: a.name, value: a.value })), `${d.name}\u5360\u6BD4`), caliber: `\u53E3\u5F84\uFF1A\u6309 ${d.name} \u5206\u7EC4\u5408\u8BA1\u540E\u8BA1\u7B97\u5360\u6BD4\u3002` }
    };
  }
  return null;
}
function chatAnswer(table, question) {
  const t = inferSchema(table);
  const { rows, columns } = t;
  const measures = columns.filter((c) => c.semantic === "measure");
  const dims = columns.filter((c) => c.semantic === "dimension");
  const times = columns.filter((c) => c.semantic === "time");
  const q = question.trim();
  const usedMeasure = measures.find((m) => q.includes(m.name)) || measures[0];
  const usedDim = dims.find((d) => q.includes(d.name)) || dims[0];
  if (/缺失|质量|异常/.test(q)) {
    return { text: `\u53EF\u5728\u300C\u6570\u636E\u8D28\u91CF\u8BCA\u65AD\u300D\u9875\u67E5\u770B\u5B8C\u6574\u95EE\u9898\u6E05\u5355\u3002\u5F53\u524D\u68C0\u6D4B\u5230\uFF1A${columns.filter((c) => c.missing > 0).map((c) => `${c.name} \u7F3A\u5931 ${c.missing} \u884C`).join("\uFF1B") || "\u6682\u65E0\u7F3A\u5931"}\u3002`, chart: null };
  }
  if (usedMeasure) {
    const vals = rows.map((r) => toNum(r[usedMeasure.name])).filter((v) => !isNaN(v));
    if (/最高|最大|峰值/.test(q)) {
      const max = Math.max(...vals);
      let where = "";
      if (usedDim) {
        const row = rows.find((r) => toNum(r[usedMeasure.name]) === max);
        where = `\u51FA\u73B0\u5728 ${usedDim.name}="${row[usedDim.name]}"`;
      }
      return { text: `\u300C${usedMeasure.name}\u300D\u6700\u9AD8\u4E3A ${fmt(max)}\uFF08${where}\uFF09\u3002`, chart: null };
    }
    if (/最低|最小|谷值/.test(q)) {
      const min = Math.min(...vals);
      let where = "";
      if (usedDim) {
        const row = rows.find((r) => toNum(r[usedMeasure.name]) === min);
        where = `\u51FA\u73B0\u5728 ${usedDim.name}="${row[usedDim.name]}"`;
      }
      return { text: `\u300C${usedMeasure.name}\u300D\u6700\u4F4E\u4E3A ${fmt(min)}\uFF08${where}\uFF09\u3002`, chart: null };
    }
    if (/平均|均值/.test(q)) return { text: `\u300C${usedMeasure.name}\u300D\u5747\u503C\u4E3A ${fmt(avg(vals))}\uFF08\u57FA\u4E8E ${vals.length} \u4E2A\u6709\u6548\u503C\uFF09\u3002`, chart: null };
    if (/总和|合计|总量/.test(q)) return { text: `\u300C${usedMeasure.name}\u300D\u5408\u8BA1\u4E3A ${fmt(vals.reduce((a, b) => a + b, 0))}\u3002`, chart: null };
    if (times.length && /趋势|变化|增长/.test(q)) {
      const timeCol = times[0].name;
      const sorted = [...rows].sort((a, b) => Date.parse(normDate(a[timeCol])) - Date.parse(normDate(b[timeCol])));
      const vs = sorted.map((r) => toNum(r[usedMeasure.name]));
      const half = Math.floor(vs.length / 2);
      const pct = avg(vs.slice(0, half)) ? (avg(vs.slice(half)) - avg(vs.slice(0, half))) / avg(vs.slice(0, half)) * 100 : 0;
      return { text: `\u300C${usedMeasure.name}\u300D\u6574\u4F53\u5448${pct >= 0 ? "\u4E0A\u5347" : "\u4E0B\u964D"}\u8D8B\u52BF\uFF0C\u533A\u95F4\u53D8\u5316 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%\u3002`, chart: { id: "chat_line", title: `${usedMeasure.name}\u8D8B\u52BF`, type: "line", option: lineOption(sorted.map((r) => normDate(r[timeCol])), vs, `${usedMeasure.name}\u8D8B\u52BF`), caliber: "\u53E3\u5F84\uFF1A\u6309\u65F6\u95F4\u5347\u5E8F\u771F\u5B9E\u8BA1\u7B97\u3002" } };
    }
    if (/占比|比例|份额/.test(q) && usedDim) {
      const freq = rows.reduce((acc, r) => {
        const k = r[usedDim.name];
        if (!isEmpty(k)) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const items = Object.entries(freq).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      return { text: `\u300C${usedDim.name}\u300D\u4E2D ${items[0].name} \u5360\u6BD4\u6700\u9AD8\uFF0C\u7EA6 ${Math.round(items[0].value / rows.length * 100)}%\u3002`, chart: { id: "chat_pie", title: `${usedDim.name}\u6784\u6210`, type: "pie", option: pieOption(items, `${usedDim.name}\u6784\u6210`), caliber: "\u53E3\u5F84\uFF1A\u884C\u9891\u5360\u6BD4\u3002" } };
    }
  }
  return { text: `\u6211\u5DF2\u57FA\u4E8E\u771F\u5B9E\u7EDF\u8BA1\u56DE\u7B54\u3002\u4F60\u53EF\u4EE5\u8BD5\u7740\u95EE\uFF1A"${usedMeasure ? usedMeasure.name + " \u6700\u9AD8\u662F\u591A\u5C11" : "\u9500\u552E\u989D\u6700\u9AD8\u662F\u591A\u5C11"}"\u3001"\u6574\u4F53\u8D8B\u52BF\u5982\u4F55"\u3001"${usedDim ? usedDim.name : "\u533A\u57DF"} \u5360\u6BD4"\u3002`, chart: null };
}
function suggestQuestions(table) {
  const t = inferSchema(table);
  const out = [];
  if (t.columns.some((c) => c.semantic === "measure")) out.push("\u9500\u552E\u989D\u6700\u9AD8\u662F\u591A\u5C11\uFF1F");
  if (t.columns.some((c) => c.semantic === "time")) out.push("\u6574\u4F53\u8D8B\u52BF\u5982\u4F55\uFF1F");
  if (t.columns.some((c) => c.semantic === "dimension")) out.push("\u533A\u57DF\u5360\u6BD4\u591A\u5C11\uFF1F");
  out.push("\u6570\u636E\u8D28\u91CF\u6709\u95EE\u9898\u5417\uFF1F");
  return out.slice(0, 4);
}
var ICON_SVG = {
  summary: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  rank: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  dist: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  share: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  cross: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
  quality: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  data: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  insights: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  charts: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>'
};
function iconSvg(name, size = 16) {
  const inner = ICON_SVG[name] || ICON_SVG.summary;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function exportReportHTML(table, analysis, quality) {
  const { charts, insights } = analysis;
  const dataSample = table.rows.slice(0, 8).map((r) => `<tr>${table.columns.map((c) => `<td>${r[c.name] ?? ""}</td>`).join("")}</tr>`).join("");
  const head = table.columns.map((c) => `<th>${c.name}</th>`).join("");
  const insightHTML = insights.map((i) => `<li class="insight-item">${iconSvg(i.icon || "summary")}<div><b>${i.text}</b><br><span class="cal">${i.caliber || ""}</span></div></li>`).join("");
  const issuesHTML = quality.issues.length ? quality.issues.map((it) => `<li class="issue-item"><span class="sev sev-${it.severity}"></span><div><b>${it.col} \xB7 ${it.type}</b><br>${it.detail}<br><span class="fix">\u5EFA\u8BAE\uFF1A${it.suggestion}</span></div></li>`).join("") : '<li class="muted">\u672A\u68C0\u51FA\u660E\u663E\u95EE\u9898\uFF0C\u6570\u636E\u8D28\u91CF\u826F\u597D\u3002</li>';
  const chartDivs = charts.map((c, i) => `<div class="chart" id="chart${i}"></div>`).join("");
  const chartJS = `var _charts=[];` + charts.map((c, i) => `_charts.push(echarts.init(document.getElementById('chart${i}')));_charts[_charts.length-1].setOption(${JSON.stringify(c.option)});`).join("\n") + `
window.addEventListener('resize',function(){_charts.forEach(function(c){try{c.resize()}catch(e){}})});`;
  const sampleNote = analysis.sampled && analysis.sampled.enabled ? `<div class="sample-note">\u6CE8\uFF1A\u539F\u6570\u636E\u5171 ${fmt(analysis.sampled.total)} \u884C\uFF0C\u672C\u6B21\u5206\u6790\u6309\u7B49\u8DDD\u62BD\u6837\u91C7\u7528\u5176\u4E2D ${fmt(analysis.sampled.used)} \u884C\uFF08\u91C7\u6837\u53E3\u5F84\uFF1A${fmt(analysis.sampled.used)}/${fmt(analysis.sampled.total)} \u884C\uFF09\u3002\u4EE5\u4E0B\u6240\u6709\u56FE\u8868\u3001\u7ED3\u8BBA\u4E0E\u5360\u6BD4\u5747\u57FA\u4E8E\u62BD\u6837\u6837\u672C\u3002</div>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>\u6570\u636E\u5206\u6790\u62A5\u544A</title>
<script>${echarts_min_default}</script>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#2A2733;max-width:880px;margin:0 auto;padding:24px;background:#FAF9FC}
h1{font-size:22px;margin:0 0 4px} .sub{color:#6B6577;font-size:13px;margin-bottom:20px}
.sample-note{background:#F7F5FB;border:1px solid #E8E5F0;border-radius:8px;padding:8px 12px;font-size:12px;color:#6B6577;margin:-8px 0 16px}
.card{background:#fff;border:1px solid #E8E5F0;border-radius:16px;padding:16px;margin:12px 0}
h2{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:6px} h2 svg{color:#8B7EC8}
ul{padding-left:18px} li{margin:8px 0;font-size:14px} .cal{color:#6B6577;font-size:12px}
.insight-item{display:flex;gap:8px;align-items:flex-start} .insight-item svg{color:#8B7EC8;flex-shrink:0;margin-top:2px}
.issue-item{display:flex;gap:8px;align-items:flex-start} .issue-item .sev{width:8px;min-width:8px;min-height:20px;border-radius:9999px;margin-top:6px}
.sev-high{background:#C0564B} .sev-medium{background:#C98A2B} .sev-low{background:#8B7EC8} .sev-info{background:#9AA0A6}
.fix{color:#8B7EC8;font-size:12px} .muted{color:#6B6577}
.chart{height:280px;margin:8px 0} table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #E8E5F0;padding:6px 8px;text-align:left}
.score{display:inline-block;width:48px;height:48px;border-radius:50%;border:3px solid #8B7EC8;color:#8B7EC8;font-weight:700;text-align:center;line-height:42px}</style></head>
<body>
<h1>\u6570\u636E\u5206\u6790\u62A5\u544A</h1><div class="sub">\u751F\u6210\u65F6\u95F4\uFF1A${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")} \uFF5C \u6570\u636E ${table.rows.length} \u884C \xD7 ${table.columns.length} \u5217 \uFF5C \u4FDD\u771F\u6A21\u5F0F\uFF1A\u771F\u5B9E\u8BA1\u7B97\uFF08Mock \u5F15\u64CE\uFF09</div>
${sampleNote}
<div class="card"><h2>${iconSvg("quality")} \u6570\u636E\u8D28\u91CF</h2><span class="score">${quality.score}</span><p class="sub">\u68C0\u51FA\u95EE\u9898 ${quality.issues.length} \u9879\u3002\u5EFA\u8BAE\u6838\u67E5\u5F02\u5E38\u70B9\u540E\u518D\u636E\u6B64\u51B3\u7B56\u3002</p><ul>${issuesHTML}</ul></div>
<div class="card"><h2>${iconSvg("insights")} \u5206\u6790\u7ED3\u8BBA\u4E0E\u5EFA\u8BAE</h2><ul>${insightHTML}</ul></div>
<div class="card"><h2>${iconSvg("charts")} \u56FE\u8868</h2>${chartDivs}</div>
<div class="card"><h2>${iconSvg("data")} \u6570\u636E\u9884\u89C8\uFF08\u524D 8 \u884C\uFF09</h2><table><thead><tr>${head}</tr></thead><tbody>${dataSample}</tbody></table></div>
<script>${chartJS}</script>
</body></html>`;
}
function sampleRows(rows, limit = 2e4) {
  if (!rows || rows.length <= limit) return rows || [];
  const step = rows.length / limit;
  const out = [];
  for (let i = 0; i < limit; i++) out.push(rows[Math.min(rows.length - 1, Math.floor(i * step))]);
  return out;
}
function normName(s) {
  return String(s == null ? "" : s).replace(/[\s_\-]+/g, "").toLowerCase();
}
function nameSim(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  return 0;
}
function typeCompat(aCol, bCol) {
  const sa = aCol.semantic || "text";
  const sb = bCol.semantic || "text";
  if (sa === sb) return 1;
  if (sa === "dimension" && sb === "text" || sa === "text" && sb === "dimension") return 1;
  return 0;
}
function overlapRate(aVals, bVals) {
  if (!aVals.length || !bVals.length) return 0;
  const setA = new Set(aVals);
  const setB = new Set(bVals);
  let inter = 0;
  setA.forEach((v) => {
    if (setB.has(v)) inter++;
  });
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}
function detectLinks(datasets) {
  const list = (datasets || []).filter((d) => d && d.rows && d.rows.length && d.columns && d.columns.length);
  const infos = list.map((d) => ({ d, t: inferSchema({ columns: d.columns, rows: d.rows }) }));
  const links = [];
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const a = infos[i], b = infos[j];
      const aSamples = sampleRows(a.d.rows, 2e4);
      const bSamples = sampleRows(b.d.rows, 2e4);
      let best = null;
      for (const ac of a.t.columns) {
        for (const bc of b.t.columns) {
          const aVals = aSamples.map((r) => r[ac.name]).filter((v) => !isEmpty(v));
          const bVals = bSamples.map((r) => r[bc.name]).filter((v) => !isEmpty(v));
          const aCard = uniq(aVals).length;
          const bCard = uniq(bVals).length;
          if (aCard < 2 || bCard < 2) continue;
          const uniRate = (aCard / (aVals.length || 1) + bCard / (bVals.length || 1)) / 2;
          let score = 0.35 * nameSim(ac.name, bc.name) + 0.2 * typeCompat(ac, bc) + 0.3 * overlapRate(aVals, bVals) + 0.15 * uniRate;
          const aId = looksLikeId(ac.name, aVals, a.d.rows.length || 1);
          const bId = looksLikeId(bc.name, bVals, b.d.rows.length || 1);
          if (aId || bId) score += 0.05;
          score = Math.min(1, score);
          if (!best || score > best.score) {
            best = { score, fromKey: ac.name, toKey: bc.name };
          }
        }
      }
      if (!best || best.score <= 0) continue;
      const pv = previewJoin(a.d, b.d, best.fromKey, best.toKey);
      const sameName = normName(best.fromKey) === normName(best.toKey);
      const rate = pv.rate;
      const rawScore = Math.round(best.score * 100) / 100;
      const usable = rate === 0 ? 0 : rate < 30 ? 0.5 : 1;
      const effScore = Math.round(best.score * usable * 100) / 100;
      const confidence = effScore >= 0.65 ? "high" : effScore >= 0.4 ? "medium" : "low";
      links.push({
        fromId: a.d.id,
        toId: b.d.id,
        fromName: a.d.name || a.d.meta && a.d.meta.name || "",
        toName: b.d.name || b.d.meta && b.d.meta.name || "",
        fromKey: best.fromKey,
        toKey: best.toKey,
        score: rawScore,
        confidence,
        matched: pv.matched,
        total: pv.total,
        rate,
        sameName
      });
    }
  }
  const CONF_RANK = { high: 3, medium: 2, low: 1 };
  links.sort((x, y) => CONF_RANK[y.confidence] - CONF_RANK[x.confidence] || y.score - x.score);
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (const l of links) {
    if (used.has(l.fromId) || used.has(l.toId)) continue;
    used.add(l.fromId);
    used.add(l.toId);
    out.push(l);
  }
  return out;
}
function unionTables(tables, addSourceCol = true) {
  const srcList = (tables || []).filter((t) => t && t.rows && t.rows.length);
  if (!srcList.length) return { columns: [], rows: [] };
  const colSet = /* @__PURE__ */ new Set();
  const colOrder = [];
  srcList.forEach((t) => (t.columns || []).forEach((c) => {
    if (!colSet.has(c.name)) {
      colSet.add(c.name);
      colOrder.push(c.name);
    }
  }));
  const srcCol = colOrder.includes("\u6765\u6E90") ? "\u6765\u6E90\uFF08\u6570\u636E\u96C6\uFF09" : "\u6765\u6E90";
  let cols = colOrder.map((name) => ({ name }));
  if (addSourceCol) cols = [{ name: srcCol }, ...cols];
  const rows = [];
  srcList.forEach((t) => {
    const srcName = t.name || t.meta && t.meta.name || "";
    t.rows.forEach((r) => {
      const nr = {};
      if (addSourceCol) nr[srcCol] = srcName;
      colOrder.forEach((c) => {
        nr[c] = r[c] === void 0 ? "" : r[c];
      });
      rows.push(nr);
    });
  });
  return { columns: cols, rows };
}
function dsName(d) {
  return d.name || d.meta && d.meta.name || "\u6570\u636E\u96C6";
}
function mergeDatasets(datasets, plan) {
  const list = (datasets || []).filter((d) => d && d.table);
  if (!list.length) {
    return { table: { columns: [], rows: [] }, meta: { mode: plan && plan.mode, links: [], matched: 0, total: 0, warnings: ["\u672A\u627E\u5230\u53EF\u5408\u5E76\u7684\u6570\u636E\u96C6"] } };
  }
  const warnings = [...plan.warnings || []];
  if (plan.mode === "union") {
    const tables = list.map((d) => ({ ...d.table, name: dsName(d) }));
    const t = unionTables(tables, plan.addSourceCol !== false);
    return { table: t, meta: { mode: "union", links: [], matched: t.rows.length, total: t.rows.length, warnings } };
  }
  const main = [...list].sort((a, b) => b.table.rows.length - a.table.rows.length)[0];
  const byId = {};
  list.forEach((d) => {
    byId[d.id] = d;
  });
  const linkMeta = [];
  const joinedIds = /* @__PURE__ */ new Set([main.id]);
  const unconsumed = [];
  let left = main.table;
  let totalMatched = 0;
  let totalTotal = 0;
  for (const lk of plan.links || []) {
    let sub = null, mainKey = "", subKey = "";
    if (joinedIds.has(lk.fromId) && !joinedIds.has(lk.toId)) {
      sub = byId[lk.toId];
      mainKey = lk.fromKey;
      subKey = lk.toKey;
    } else if (joinedIds.has(lk.toId) && !joinedIds.has(lk.fromId)) {
      sub = byId[lk.fromId];
      mainKey = lk.toKey;
      subKey = lk.fromKey;
    }
    if (!sub) {
      unconsumed.push(lk);
      continue;
    }
    if (!left.columns.some((c) => c.name === mainKey)) {
      unconsumed.push(lk);
      continue;
    }
    joinedIds.add(sub.id);
    const keepCols = sub.table.columns.map((c) => c.name).filter((n) => n !== subKey);
    const pv = previewJoin(left, sub.table, mainKey, subKey);
    const joined = joinTables(left, sub.table, mainKey, subKey, keepCols, "left");
    linkMeta.push({
      fromName: dsName(byId[lk.fromId]),
      toName: dsName(byId[lk.toId]),
      fromId: lk.fromId,
      toId: lk.toId,
      mainKey,
      subKey,
      matched: pv.matched,
      total: pv.total,
      rate: pv.rate
    });
    totalMatched += pv.matched;
    totalTotal += pv.total;
    left = joined;
  }
  if (!linkMeta.length) warnings.push("\u672A\u6307\u5B9A\u6709\u6548\u5173\u8054\uFF0C\u7ED3\u679C\u4EC5\u5305\u542B\u4E3B\u8868\uFF08\u53EF\u5C55\u5F00\u9AD8\u7EA7\u624B\u52A8\u5173\u8054\uFF0C\u6216\u6539\u7528\u7EB5\u5411\u5806\u53E0\uFF09");
  if (unconsumed.length) {
    warnings.push(`\u6709 ${unconsumed.length} \u6761\u5173\u8054\u672A\u751F\u6548\uFF08\u672A\u4E0E\u4E3B\u8868\u8FDE\u901A\u6216\u5173\u8054\u952E\u4E0D\u5728\u7ED3\u679C\u8868\u4E2D\uFF09\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${unconsumed.map((l) => `\u300C${l.fromName || l.fromId}\u300D\u2194\u300C${l.toName || l.toId}\u300D`).join("\u3001")}`);
  }
  return { table: left, meta: { mode: "join", links: linkMeta, matched: totalMatched, total: totalTotal || main.table.rows.length, warnings } };
}
function buildMergePlan(datasets, selectedIds, links) {
  const sel = (datasets || []).filter((d) => d && d.table && (selectedIds || []).includes(d.id));
  if (sel.length === 0) return { mode: "union", mainId: null, links: [], addSourceCol: true, warnings: ["\u672A\u9009\u62E9\u6570\u636E\u96C6"] };
  if (sel.length === 1) return { mode: "single", mainId: sel[0].id, links: [], addSourceCol: false, warnings: [] };
  const relLinks = (links || []).filter(
    (l) => sel.some((d) => d.id === l.fromId) && sel.some((d) => d.id === l.toId) && l.confidence !== "low" && l.rate >= 30
  );
  const adj = {};
  sel.forEach((d) => {
    adj[d.id] = /* @__PURE__ */ new Set();
  });
  relLinks.forEach((l) => {
    adj[l.fromId].add(l.toId);
    adj[l.toId].add(l.fromId);
  });
  const seen = /* @__PURE__ */ new Set();
  const stack = [sel[0].id];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const nbrs = adj[id] || [];
    nbrs.forEach((n) => {
      if (!seen.has(n)) stack.push(n);
    });
  }
  const main = [...sel].sort((a, b) => b.table.rows.length - a.table.rows.length)[0];
  if (seen.size === sel.length && relLinks.length >= 1) {
    return { mode: "join", mainId: main.id, links: relLinks, addSourceCol: false, warnings: [] };
  }
  return {
    mode: "union",
    mainId: null,
    links: relLinks,
    addSourceCol: true,
    warnings: ["\u6570\u636E\u96C6\u95F4\u672A\u5F62\u6210\u53EF\u9760\u5173\u8054\uFF08\u7F6E\u4FE1\u5EA6\u6216\u5339\u914D\u7387\u4E0D\u8DB3\uFF09\uFF0C\u5DF2\u6539\u7528\u300C\u7EB5\u5411\u5806\u53E0\u300D\u5408\u5E76\uFF1B\u53EF\u5C55\u5F00\u9AD8\u7EA7\u624B\u52A8\u6307\u5B9A\u5173\u8054"]
  };
}
function multiBarOption(cats, series) {
  return {
    grid: { left: 8, right: 12, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    title: { text: "\u591A\u6570\u636E\u96C6\u5BF9\u6BD4", left: 0, top: 0, textStyle: { fontSize: 13, color: "#2A2733", fontWeight: 600 } },
    color: PALETTE,
    legend: { top: 0, right: 0, textStyle: { color: "#6B6577", fontSize: 11 } },
    xAxis: { type: "category", data: cats, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: 0, rotate: cats.length > 6 ? 32 : 0 } },
    yAxis: { type: "value", ...axisBase() },
    series: (series || []).map((s) => ({ type: "bar", name: s.name, data: s.data, barMaxWidth: 26, itemStyle: { borderRadius: [4, 4, 0, 0] } }))
  };
}
function multiLineOption(cats, series) {
  return {
    grid: { left: 8, right: 12, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    title: { text: "\u591A\u6570\u636E\u96C6\u5BF9\u6BD4", left: 0, top: 0, textStyle: { fontSize: 13, color: "#2A2733", fontWeight: 600 } },
    color: PALETTE,
    legend: { top: 0, right: 0, textStyle: { color: "#6B6577", fontSize: 11 } },
    xAxis: { type: "category", data: cats, boundaryGap: false, ...axisBase(), axisLabel: { ...axisBase().axisLabel, interval: "auto", rotate: cats.length > 8 ? 32 : 0 } },
    yAxis: { type: "value", ...axisBase() },
    series: (series || []).map((s) => ({ type: "line", name: s.name, data: s.data, smooth: true, symbol: "circle", symbolSize: 6, lineStyle: { width: 2 } }))
  };
}
function compareAcrossTables(datasets, selectedIds) {
  const sel = (datasets || []).filter((d) => d && d.table && (selectedIds || []).includes(d.id));
  if (sel.length < 2) return null;
  const infos = sel.map((d) => ({ d, t: inferSchema(d.table) }));
  const measureCount = {};
  infos.forEach(({ t }) => {
    t.columns.filter((c) => c.semantic === "measure").forEach((c) => {
      measureCount[c.name] = (measureCount[c.name] || 0) + 1;
    });
  });
  const common = Object.keys(measureCount).filter((n) => measureCount[n] >= 2);
  if (!common.length) return null;
  const m = common[0];
  const cats = sel.map((d) => dsName(d));
  const avgSeries = sel.map((d) => {
    const vals = d.table.rows.map((r) => toNum(r[m])).filter((v) => !isNaN(v));
    return { name: dsName(d), value: vals.length ? Math.round(avg(vals) * 100) / 100 : 0 };
  });
  const sumSeries = sel.map((d) => {
    const vals = d.table.rows.map((r) => toNum(r[m])).filter((v) => !isNaN(v));
    return { name: dsName(d), value: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : 0 };
  });
  return {
    measure: m,
    cats,
    avg: avgSeries,
    sum: sumSeries,
    bar: multiBarOption(cats, [
      { name: `${m} \u5747\u503C`, data: avgSeries.map((s) => s.value) },
      { name: `${m} \u5408\u8BA1`, data: sumSeries.map((s) => s.value) }
    ]),
    line: multiLineOption(cats, [{ name: `${m} \u5747\u503C`, data: avgSeries.map((s) => s.value) }])
  };
}
function mergeSummary(mergedTable) {
  const { columns, rows } = mergedTable;
  const t = inferSchema(mergedTable);
  return {
    rowCount: rows.length,
    colCount: columns.length,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type,
      semantic: c.semantic,
      missingRate: rows.length ? Math.round(c.missing / rows.length * 100) / 100 : 0,
      uniqueRate: rows.length - c.missing ? Math.round(c.cardinality / (rows.length - c.missing) * 100) / 100 : 0
    }))
  };
}
export {
  SAMPLE_ANALYZE_THRESHOLD,
  analyze,
  analyzeByPlan,
  buildMergePlan,
  buildStatSummary,
  chatAnswer,
  cleanDedupe,
  cleanFillMissing,
  cleanOutliers,
  cleanTrim,
  compareAcrossTables,
  decodeText,
  detectLinks,
  executeIntent,
  exportReportHTML,
  fmt,
  guessJoinKeys,
  inferSchema,
  isDate,
  isNumeric,
  joinTables,
  looksLikeId,
  mergeDatasets,
  mergeSummary,
  multiBarOption,
  multiLineOption,
  normDate,
  parseCSVText,
  parseFile,
  parseJSON,
  previewJoin,
  qualityCheck,
  sampleRows,
  schemaSummaryFor,
  suggestQuestions,
  timeSeries,
  toNum,
  topN,
  unionTables
};
