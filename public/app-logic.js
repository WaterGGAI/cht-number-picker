const CHTAppLogic = (() => {
  function cloneRows(rows = []) {
    return rows.map((row) => ({
      ...row,
      score: row.score
        ? {
            ...row.score,
            reasons: [...(row.score.reasons || [])]
          }
        : null
    }));
  }

  function clonePagination(pagination = {}) {
    const currentPage = Number(pagination.currentPage) || 1;
    return {
      currentPage,
      totalPages: Math.max(1, Number(pagination.totalPages) || 1),
      batchSize: Math.max(1, Number(pagination.batchSize) || 1),
      loadedPages: getLoadedPages({
        ...pagination,
        currentPage
      })
    };
  }

  function cloneCategoryGroups(groups = []) {
    return groups.map((group) => ({ ...group }));
  }

  function normalizeNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 10 ? digits : "";
  }

  function normalizeScore(score) {
    if (!score || typeof score !== "object") return null;
    return {
      value: Number(score.value) || 0,
      reasons: Array.isArray(score.reasons) ? score.reasons.map(String).filter(Boolean) : []
    };
  }

  function normalizeShortlistRow(row) {
    const number =
      typeof row === "string" || typeof row === "number"
        ? normalizeNumber(row)
        : normalizeNumber(row?.number);
    if (!number) return null;

    const score = normalizeScore(typeof row === "object" ? row?.score : null);
    const feeValue =
      typeof row === "object" && row?.fee !== undefined && row?.fee !== null ? Number(row.fee) : null;

    return {
      number,
      fee: Number.isFinite(feeValue) ? feeValue : null,
      feeLabel:
        typeof row === "object" && typeof row?.feeLabel === "string" && row.feeLabel.trim()
          ? row.feeLabel.trim()
          : null,
      bucket:
        typeof row === "object" && typeof row?.bucket === "string" && row.bucket.trim()
          ? row.bucket.trim()
          : null,
      score,
      statusUrl:
        typeof row === "object" && typeof row?.statusUrl === "string" && row.statusUrl.trim()
          ? row.statusUrl.trim()
          : null
    };
  }

  function normalizeShortlistRows(rows = []) {
    const seen = new Set();
    return rows
      .map((row) => normalizeShortlistRow(row))
      .filter((row) => {
        if (!row || seen.has(row.number)) return false;
        seen.add(row.number);
        return true;
      });
  }

  function dedupeDisplayRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      if (!row.number || seen.has(row.number)) return false;
      seen.add(row.number);
      return true;
    });
  }

  function sortShortlistRows(rows, sortMode = "added") {
    const shortlist = [...rows];
    if (sortMode === "number") {
      return shortlist.sort((a, b) => a.number.localeCompare(b.number));
    }
    if (sortMode === "score") {
      return shortlist.sort((a, b) => {
        const score = (b.score?.value || 0) - (a.score?.value || 0);
        return score || a.number.localeCompare(b.number);
      });
    }
    return shortlist;
  }

  function sortRows(rows, sortByScore = true) {
    const output = [...rows];
    if (!sortByScore) return output.sort((a, b) => a.number.localeCompare(b.number));
    return output.sort((a, b) => {
      const score = (b.score?.value || 0) - (a.score?.value || 0);
      return score || a.number.localeCompare(b.number);
    });
  }

  function bucketKey(row) {
    return row.bucket || "未分類";
  }

  function buildCategoryGroups(rows) {
    const counts = new Map();
    rows.forEach((row) => {
      const key = bucketKey(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }

  function normalizePattern(value) {
    return String(value || "")
      .replace(/[？?ＸｘX]/g, "x")
      .replace(/[^\dx]/gi, "")
      .toLowerCase()
      .slice(0, 6);
  }

  function toOfficialPattern(value) {
    return normalizePattern(value).replace(/x/g, "?");
  }

  function normalizeNumberCopyFormat(format) {
    return String(format || "").trim() === "spaced" ? "spaced" : "plain";
  }

  function normalizeNumberCopyDetailMode(mode) {
    return String(mode || "").trim() === "annotated" ? "annotated" : "number";
  }

  function formatCopyNumber(value, format = "plain") {
    const number = normalizeNumber(value) || String(value || "").replace(/\D/g, "");
    if (!number) return "";
    if (normalizeNumberCopyFormat(format) !== "spaced" || number.length !== 10) {
      return number;
    }
    return `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`;
  }

  function buildRowMetaText(row, options = {}) {
    const parts = [];
    if (row?.bucket) parts.push(String(row.bucket).trim());
    if (row?.fee !== null && row?.fee !== undefined && Number.isFinite(Number(row.fee))) {
      parts.push(`${row.feeLabel || "選號費"} NT ${Number(row.fee)} 元`);
    }
    if (Array.isArray(row?.score?.reasons) && row.score.reasons.length) {
      parts.push(row.score.reasons.map(String).filter(Boolean).join("、"));
    }
    const fallback = options.fallback === undefined ? "費用未標示" : String(options.fallback || "");
    return parts.join(" · ") || fallback;
  }

  function normalizeNumberCopyOptions(options = "plain") {
    if (typeof options === "string") {
      return {
        numberFormat: normalizeNumberCopyFormat(options),
        detailMode: "number"
      };
    }
    return {
      numberFormat: normalizeNumberCopyFormat(options.numberFormat),
      detailMode: normalizeNumberCopyDetailMode(options.detailMode)
    };
  }

  function formatNumberCopyLine(row, options = "plain") {
    const settings = normalizeNumberCopyOptions(options);
    const value = row && typeof row === "object" ? row.number : row;
    const number = formatCopyNumber(value, settings.numberFormat);
    if (!number) return "";
    if (settings.detailMode !== "annotated") return number;
    const meta =
      row && typeof row === "object" ? buildRowMetaText(row, { fallback: "" }) : "";
    return meta ? `${number}｜${meta}` : number;
  }

  function formatNumberCopyList(rows = [], options = "plain") {
    return rows
      .map((row) => formatNumberCopyLine(row, options))
      .filter(Boolean)
      .join("\n");
  }

  function getBatchSize(pagination = {}) {
    return Math.max(1, Number(pagination.batchSize) || 1);
  }

  function getLoadedPages(pagination = {}) {
    const fallbackPage = pagination.currentPage || 1;
    return [...(pagination.loadedPages || [fallbackPage])]
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page >= 1)
      .sort((a, b) => a - b);
  }

  function getBatchPages(startPage, totalPages, batchSize) {
    const size = Math.max(1, Number(batchSize) || 1);
    const total = Math.max(1, Number(totalPages) || 1);
    const start = Math.max(1, Math.min(startPage, total));
    const end = Math.min(total, start + size - 1);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  function formatPageRange(startPage, totalPages, batchSize) {
    const pages = getBatchPages(startPage, totalPages, batchSize);
    const first = pages[0] || 1;
    const last = pages[pages.length - 1] || first;
    return first === last ? String(first) : `${first}-${last}`;
  }

  function getBatchStarts(totalPages, batchSize) {
    const total = Math.max(1, Number(totalPages) || 1);
    const size = Math.max(1, Number(batchSize) || 1);
    return Array.from({ length: Math.ceil(total / size) }, (_, index) => index * size + 1);
  }

  function buildBatchSequence(currentStart, totalPages, batchSize) {
    const starts = getBatchStarts(totalPages, batchSize);
    if (starts.length <= 7) {
      return starts;
    }

    const currentIndex = Math.max(0, starts.indexOf(currentStart));
    const indexes = new Set([0, starts.length - 1, currentIndex - 1, currentIndex, currentIndex + 1]);
    if (currentIndex <= 2) {
      indexes.add(1);
      indexes.add(2);
      indexes.add(3);
    }
    if (currentIndex >= starts.length - 3) {
      indexes.add(starts.length - 2);
      indexes.add(starts.length - 3);
      indexes.add(starts.length - 4);
    }

    const sorted = [...indexes]
      .filter((index) => index >= 0 && index < starts.length)
      .sort((a, b) => a - b);
    const output = [];

    sorted.forEach((batchIndex, index) => {
      const previous = sorted[index - 1];
      if (previous !== undefined && batchIndex - previous > 1) output.push("...");
      output.push(starts[batchIndex]);
    });

    return output;
  }

  function buildSnapshot(snapshot = {}, options = {}) {
    const defaultEmptyState = options.defaultEmptyState || { title: "", detail: "" };
    const defaultPagination = options.defaultPagination || {
      currentPage: 1,
      totalPages: 1,
      batchSize: 1,
      loadedPages: [1]
    };
    const categoryAllGroup = options.categoryAllGroup || "__all";
    const emptyState = snapshot.emptyState || defaultEmptyState;

    return {
      rows: cloneRows(snapshot.rows || []),
      categoryRows: cloneRows(snapshot.categoryRows || []),
      categoryGroups: cloneCategoryGroups(snapshot.categoryGroups || []),
      activeCategoryGroup: snapshot.activeCategoryGroup || categoryAllGroup,
      statusTitle: snapshot.statusTitle || "",
      statusCount: Number(snapshot.statusCount) || 0,
      visible: Boolean(snapshot.visible),
      emptyTitle: emptyState.title || defaultEmptyState.title || "",
      emptyDetail: emptyState.detail || defaultEmptyState.detail || "",
      pagination: clonePagination(snapshot.pagination || defaultPagination)
    };
  }

  function restoreSnapshotState(snapshot, options = {}) {
    if (!snapshot) return null;

    const normalized = buildSnapshot(
      {
        ...snapshot,
        emptyState: {
          title: snapshot.emptyTitle,
          detail: snapshot.emptyDetail
        }
      },
      options
    );

    return {
      rows: normalized.rows,
      categoryRows: normalized.categoryRows,
      categoryGroups: normalized.categoryGroups,
      activeCategoryGroup: normalized.activeCategoryGroup,
      status: {
        title: normalized.statusTitle,
        count: normalized.statusCount,
        visible: normalized.visible
      },
      emptyState: {
        title: normalized.emptyTitle,
        detail: normalized.emptyDetail
      },
      pagination: normalized.pagination
    };
  }

  function normalizeSearchDraft(draft = {}, options = {}) {
    const source = draft && typeof draft === "object" ? draft : {};
    const prefixes = Array.isArray(options.prefixes) ? options.prefixes.map(String) : [];
    const modes = Array.isArray(options.modes) ? options.modes.map(String) : ["all", "pattern", "fee"];
    const fees = Array.isArray(options.fees) ? options.fees.map(String) : ["480", "1000"];
    const pageLimits = Array.isArray(options.pageLimits) ? options.pageLimits.map(String) : ["1", "3", "5"];
    const allowedFilters = new Set(
      Array.isArray(options.filters) ? options.filters.map(String) : []
    );

    const uniqueFilters = [...new Set(Array.isArray(source.filters) ? source.filters.map(String) : [])]
      .filter((value) => allowedFilters.has(value));

    return {
      prefix:
        prefixes.includes(String(source.prefix)) ? String(source.prefix) : prefixes[0] || "0900",
      mode: modes.includes(String(source.mode)) ? String(source.mode) : modes[0] || "all",
      pattern: normalizePattern(source.pattern),
      fee: fees.includes(String(source.fee)) ? String(source.fee) : fees[0] || "480",
      pageLimit:
        pageLimits.includes(String(source.pageLimit))
          ? String(source.pageLimit)
          : pageLimits[0] || "1",
      filters: uniqueFilters
    };
  }

  function buildFilterLabelMap(filters = []) {
    const map = new Map();
    filters.forEach((filter) => {
      if (!filter) return;
      if (typeof filter === "object") {
        const value = String(filter.value || "").trim();
        if (!value) return;
        map.set(value, String(filter.label || filter.text || filter.value).trim());
        return;
      }
      const value = String(filter).trim();
      if (value) map.set(value, value);
    });
    return map;
  }

  function summarizePrefixes(rows = [], { limit = 3 } = {}) {
    const prefixes = [];
    const seen = new Set();
    normalizeShortlistRows(rows).forEach((row) => {
      const prefix = row.number.slice(0, 4);
      if (!prefix || seen.has(prefix)) return;
      seen.add(prefix);
      prefixes.push(prefix);
    });
    const shown = prefixes.slice(0, Math.max(1, Number(limit) || 3));
    const extra = Math.max(0, prefixes.length - shown.length);
    return { prefixes, shown, extra };
  }

  function buildShareSummaryItems(draft = null, rows = [], options = {}) {
    const normalizedRows = normalizeShortlistRows(rows);
    const chips = [];
    const draftValue = draft && typeof draft === "object" ? draft : null;

    if (normalizedRows.length) {
      chips.push({
        label: `${normalizedRows.length}筆待選`,
        copyText: formatNumberCopyList(normalizedRows, options)
      });
    }

    const prefixSummary = summarizePrefixes(normalizedRows, options);
    const queryPrefix = String(draftValue?.prefix || "").trim();
    if (prefixSummary.shown.length && !(prefixSummary.prefixes.length === 1 && prefixSummary.prefixes[0] === queryPrefix)) {
      chips.push({
        label: `待選 ${prefixSummary.shown.join(" / ")}${prefixSummary.extra ? ` +${prefixSummary.extra}` : ""}`,
        copyText: prefixSummary.prefixes.join("\n")
      });
    }

    if (!draftValue) return chips;

    if (queryPrefix) {
      chips.push({
        label: `查詢 ${queryPrefix}`,
        copyText: queryPrefix
      });
    }

    const mode = String(draftValue.mode || "all");
    if (mode === "pattern") {
      const pattern = normalizePattern(draftValue.pattern);
      if (pattern) {
        chips.push({
          label: `後六碼 ${pattern}`,
          copyText: pattern
        });
      }
    } else if (mode === "fee") {
      const fee = String(draftValue.fee || "").trim();
      if (fee) {
        chips.push({
          label: `特殊號碼 ${fee}元`,
          copyText: fee
        });
      }
    } else {
      chips.push({
        label: "查詢 不拘",
        copyText: "不拘"
      });
    }

    const pageLimit = String(draftValue.pageLimit || "").trim();
    if (pageLimit) {
      chips.push({
        label: `${pageLimit}頁`,
        copyText: pageLimit
      });
    }

    const filterLabelMap = buildFilterLabelMap(options.filterOptions || options.filters || []);
    const filters = Array.isArray(draftValue.filters) ? draftValue.filters.map(String).filter(Boolean) : [];
    if (filters.length) {
      const labels = filters.map((value) => filterLabelMap.get(value) || `第${value}碼不含4`);
      const shown = labels.slice(0, 2);
      const extra = Math.max(0, labels.length - shown.length);
      chips.push({
        label: `${shown.join(" / ")}${extra ? ` +${extra}` : ""}`,
        copyText: labels.join("\n")
      });
    }

    return chips;
  }

  function buildShareSummary(draft = null, rows = [], options = {}) {
    return buildShareSummaryItems(draft, rows, options).map((item) => item.label);
  }

  const SHARE_MODE_CODES = {
    all: "a",
    pattern: "p",
    fee: "f"
  };

  const SHARE_CODE_MODES = {
    a: "all",
    p: "pattern",
    f: "fee"
  };

  function trimTrailingEmpty(values = []) {
    const output = [...values];
    while (output.length) {
      const last = output[output.length - 1];
      if (last === undefined || last === null || last === "") {
        output.pop();
        continue;
      }
      break;
    }
    return output;
  }

  function packSearchShareDraft(draft) {
    return trimTrailingEmpty([
      draft.prefix,
      SHARE_MODE_CODES[draft.mode] || draft.mode,
      draft.pattern,
      draft.fee,
      draft.pageLimit,
      Array.isArray(draft.filters) ? draft.filters.join("") : ""
    ]);
  }

  function unpackSearchShareDraft(draft) {
    if (Array.isArray(draft)) {
      return {
        prefix: draft[0],
        mode: SHARE_CODE_MODES[draft[1]] || draft[1],
        pattern: draft[2],
        fee: draft[3],
        pageLimit: draft[4],
        filters:
          typeof draft[5] === "string"
            ? draft[5].split("").filter(Boolean)
            : Array.isArray(draft[5])
              ? draft[5]
              : []
      };
    }
    if (!draft || typeof draft !== "object") return {};
    return {
      prefix: draft.p,
      mode: draft.m,
      pattern: draft.t,
      fee: draft.f,
      pageLimit: draft.l,
      filters: draft.x
    };
  }

  function encodeSearchShare(draft = {}, options = {}) {
    const normalized = normalizeSearchDraft(draft, options);
    return encodeBase64Url(
      JSON.stringify({
        v: 2,
        d: packSearchShareDraft(normalized)
      })
    );
  }

  function decodeSearchShare(value, options = {}) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(decodeBase64Url(value));
      return normalizeSearchDraft(unpackSearchShareDraft(parsed?.d), options);
    } catch {
      return null;
    }
  }

  function buildSearchShareUrl(draft = {}, currentUrl, options = {}) {
    const url = new URL(currentUrl || "https://example.com/");
    url.searchParams.set("sd", encodeSearchShare(draft, options));
    url.searchParams.delete("ws");
    url.searchParams.delete("sl");
    return url.toString();
  }

  function readSearchShareFromUrl(currentUrl, options = {}) {
    const url = new URL(currentUrl || "https://example.com/");
    return decodeSearchShare(url.searchParams.get("sd"), options);
  }

  function stripSearchShareParam(currentUrl) {
    const url = new URL(currentUrl || "https://example.com/");
    url.searchParams.delete("sd");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function encodeWorkspaceShare(draft = {}, rows = [], options = {}) {
    const normalizedDraft = normalizeSearchDraft(draft, options);
    const normalizedRows = normalizeShortlistRows(rows);
    return encodeBase64Url(
      JSON.stringify({
        v: 2,
        d: packSearchShareDraft(normalizedDraft),
        r: normalizedRows.map((row) => packShortlistShareRow(row))
      })
    );
  }

  function decodeWorkspaceShare(value, options = {}) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(decodeBase64Url(value));
      return {
        draft: normalizeSearchDraft(unpackSearchShareDraft(parsed?.d), options),
        rows: normalizeShortlistRows(
          Array.isArray(parsed?.r) ? parsed.r.map((row) => unpackShortlistShareRow(row)) : []
        )
      };
    } catch {
      return null;
    }
  }

  function buildWorkspaceShareUrl(draft = {}, rows = [], currentUrl, options = {}) {
    const url = new URL(currentUrl || "https://example.com/");
    url.searchParams.set("ws", encodeWorkspaceShare(draft, rows, options));
    url.searchParams.delete("sd");
    url.searchParams.delete("sl");
    return url.toString();
  }

  function readWorkspaceShareFromUrl(currentUrl, options = {}) {
    const url = new URL(currentUrl || "https://example.com/");
    return decodeWorkspaceShare(url.searchParams.get("ws"), options);
  }

  function stripWorkspaceShareParam(currentUrl) {
    const url = new URL(currentUrl || "https://example.com/");
    url.searchParams.delete("ws");
    url.searchParams.delete("sd");
    url.searchParams.delete("sl");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function buildShortlistExport(rows = [], exportedAt = new Date().toISOString()) {
    return JSON.stringify(
      {
        version: 1,
        exportedAt,
        rows: normalizeShortlistRows(rows)
      },
      null,
      2
    );
  }

  function parseShortlistImport(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];

    let sourceRows = null;

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        sourceRows = parsed;
      } else if (parsed && Array.isArray(parsed.rows)) {
        sourceRows = parsed.rows;
      }
    } catch {
      sourceRows = null;
    }

    if (!sourceRows) {
      sourceRows = text
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    }

    return normalizeShortlistRows(sourceRows);
  }

  function mergeShortlistRows(existingRows = [], importedRows = []) {
    return normalizeShortlistRows([...importedRows, ...existingRows]);
  }

  function encodeBase64Url(text) {
    const bytes = new TextEncoder().encode(String(text || ""));
    const base64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(bytes).toString("base64")
        : btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeBase64Url(value) {
    const input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = input + "=".repeat((4 - (input.length % 4 || 4)) % 4);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(padded, "base64").toString("utf8");
    }
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function buildSharedStatusUrl(token, region = "null", officialPrefix = "/official") {
    if (!token) return null;
    const params = new URLSearchParams();
    params.set("telnum", token);
    params.set("region", region || "null");
    params.set("t", String(Date.now()));
    return `${officialPrefix}/mbms/NewApply/findAvailableReal.jsp?${params.toString()}`;
  }

  function parseSharedStatusUrl(statusUrl) {
    if (typeof statusUrl !== "string" || !statusUrl.trim()) return null;
    try {
      const url = new URL(statusUrl, "https://example.com/");
      if (!url.pathname.endsWith("/findAvailableReal.jsp")) return null;
      const token = url.searchParams.get("telnum");
      if (!token) return null;
      return {
        token,
        region: url.searchParams.get("region") || "null"
      };
    } catch {
      return null;
    }
  }

  function packStatusShareValue(statusUrl) {
    const parsed = parseSharedStatusUrl(statusUrl);
    if (parsed) {
      return parsed.region && parsed.region !== "null" ? [parsed.token, parsed.region] : parsed.token;
    }
    return typeof statusUrl === "string" && statusUrl.trim() ? `!${statusUrl.trim()}` : "";
  }

  function unpackStatusShareValue(value, officialPrefix = "/official") {
    if (Array.isArray(value) && value[0]) {
      return buildSharedStatusUrl(value[0], value[1] || "null", officialPrefix);
    }
    if (typeof value === "string" && value.startsWith("!")) {
      return value.slice(1) || null;
    }
    if (typeof value === "string" && value) {
      return buildSharedStatusUrl(value, "null", officialPrefix);
    }
    return null;
  }

  function packShortlistShareRow(row) {
    return trimTrailingEmpty([
      row.number,
      row.fee,
      row.bucket || "",
      row.score?.value ?? "",
      packStatusShareValue(row.statusUrl)
    ]);
  }

  function unpackShortlistShareRow(row) {
    if (Array.isArray(row)) {
      const feeValue = row[1] === "" || row[1] === undefined || row[1] === null ? null : Number(row[1]);
      const scoreValue = row[3] === "" || row[3] === undefined || row[3] === null ? null : Number(row[3]);
      return {
        number: row[0],
        fee: Number.isFinite(feeValue) ? feeValue : null,
        feeLabel: Number.isFinite(feeValue) ? "選號費" : null,
        bucket: typeof row[2] === "string" && row[2] ? row[2] : null,
        score: Number.isFinite(scoreValue)
          ? {
              value: scoreValue,
              reasons: []
            }
          : null,
        statusUrl: unpackStatusShareValue(row[4])
      };
    }
    if (!row || typeof row !== "object") return row;
    return {
      number: row.n,
      fee: row.f,
      feeLabel: row.l,
      bucket: row.b,
      score: Array.isArray(row.s)
        ? {
            value: Number(row.s[0]) || 0,
            reasons: Array.isArray(row.s[1]) ? row.s[1] : []
          }
        : null,
      statusUrl: row.u
    };
  }

  function encodeShortlistShare(rows = []) {
    const payload = {
      v: 2,
      r: normalizeShortlistRows(rows).map((row) => packShortlistShareRow(row))
    };
    return encodeBase64Url(JSON.stringify(payload));
  }

  function decodeShortlistShare(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(decodeBase64Url(value));
      const rows = Array.isArray(parsed?.r)
        ? parsed.r.map((row) => unpackShortlistShareRow(row))
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];
      return normalizeShortlistRows(rows);
    } catch {
      return [];
    }
  }

  function buildShortlistShareUrl(rows = [], currentUrl) {
    const url = new URL(currentUrl || "https://example.com/");
    url.searchParams.set("sl", encodeShortlistShare(rows));
    url.searchParams.delete("ws");
    url.searchParams.delete("sd");
    return url.toString();
  }

  function readShortlistShareFromUrl(currentUrl) {
    const url = new URL(currentUrl || "https://example.com/");
    return decodeShortlistShare(url.searchParams.get("sl"));
  }

  function stripShortlistShareParam(currentUrl) {
    const url = new URL(currentUrl || "https://example.com/");
    url.searchParams.delete("sl");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  return {
    cloneRows,
    clonePagination,
    cloneCategoryGroups,
    normalizeShortlistRow,
    normalizeShortlistRows,
    buildShortlistExport,
    parseShortlistImport,
    mergeShortlistRows,
    encodeWorkspaceShare,
    decodeWorkspaceShare,
    buildWorkspaceShareUrl,
    readWorkspaceShareFromUrl,
    stripWorkspaceShareParam,
    encodeSearchShare,
    decodeSearchShare,
    buildSearchShareUrl,
    readSearchShareFromUrl,
    stripSearchShareParam,
    encodeShortlistShare,
    decodeShortlistShare,
    buildShortlistShareUrl,
    readShortlistShareFromUrl,
    stripShortlistShareParam,
    dedupeDisplayRows,
    sortShortlistRows,
    sortRows,
    buildCategoryGroups,
    normalizePattern,
    toOfficialPattern,
    normalizeNumberCopyFormat,
    normalizeNumberCopyDetailMode,
    formatCopyNumber,
    buildRowMetaText,
    formatNumberCopyLine,
    formatNumberCopyList,
    getBatchSize,
    getLoadedPages,
    getBatchPages,
    formatPageRange,
    buildBatchSequence,
    buildSnapshot,
    restoreSnapshotState,
    normalizeSearchDraft,
    summarizePrefixes,
    buildShareSummaryItems,
    buildShareSummary
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = CHTAppLogic;
}

if (typeof globalThis !== "undefined") {
  globalThis.CHTAppLogic = CHTAppLogic;
}
