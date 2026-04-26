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

  return {
    cloneRows,
    clonePagination,
    cloneCategoryGroups,
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
    restoreSnapshotState
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = CHTAppLogic;
}

if (typeof globalThis !== "undefined") {
  globalThis.CHTAppLogic = CHTAppLogic;
}
