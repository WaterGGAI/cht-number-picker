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

  function packSearchShareDraft(draft) {
    return {
      p: draft.prefix,
      m: draft.mode,
      t: draft.pattern,
      f: draft.fee,
      l: draft.pageLimit,
      x: draft.filters
    };
  }

  function unpackSearchShareDraft(draft) {
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
        v: 1,
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

  function packShortlistShareRow(row) {
    return {
      n: row.number,
      f: row.fee,
      l: row.feeLabel,
      b: row.bucket,
      s: row.score ? [row.score.value || 0, row.score.reasons || []] : null,
      u: row.statusUrl
    };
  }

  function unpackShortlistShareRow(row) {
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
      v: 1,
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
    getBatchSize,
    getLoadedPages,
    getBatchPages,
    formatPageRange,
    buildBatchSequence,
    buildSnapshot,
    restoreSnapshotState,
    normalizeSearchDraft
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = CHTAppLogic;
}

if (typeof globalThis !== "undefined") {
  globalThis.CHTAppLogic = CHTAppLogic;
}
