const SHORTLIST_STORAGE_KEY = "cht-shortlist-v1";
const DISPLAY_STORAGE_KEY = "cht-display-mode-v1";
const SEARCH_DRAFT_STORAGE_KEY = "cht-search-draft-v1";
const CATEGORY_ALL_GROUP = "__all";

const DEFAULT_EMPTY_STATE = {
  title: "尚未查詢",
  detail: "選好條件後開始。"
};

const DEFAULT_PAGINATION = {
  currentPage: 1,
  totalPages: 1,
  batchSize: 1,
  loadedPages: [1]
};

const state = {
  rows: [],
  sortByScore: true,
  config: null,
  activeQuickLink: "free",
  snapshots: new Map(),
  emptyState: { ...DEFAULT_EMPTY_STATE },
  pagination: { ...DEFAULT_PAGINATION },
  pageCache: new Map(),
  pageContextId: 0,
  shortlist: loadShortlist(),
  shortlistSort: "added",
  displayMode: loadDisplayMode(),
  categoryRows: [],
  categoryGroups: [],
  activeCategoryGroup: CATEGORY_ALL_GROUP
};

const quickLinks = document.querySelector("#quick-links");
const form = document.querySelector("#search-form");
const searchPanel = document.querySelector("#search-form");
const prefixInput = document.querySelector("#prefix");
const modeInput = document.querySelector("#mode");
const patternInput = document.querySelector("#pattern");
const feeInput = document.querySelector("#fee");
const pageLimitInput = document.querySelector("#page-limit");
const filterList = document.querySelector("#filter-list");
const filtersWrap = document.querySelector("#filters-wrap");
const filterSummary = document.querySelector("#filter-summary");
const patternField = document.querySelector(".pattern-field");
const feeField = document.querySelector(".fee-field");
const categoryPanel = document.querySelector("#category-panel");
const categoryKicker = document.querySelector("#category-kicker");
const categoryTitle = document.querySelector("#category-title");
const categoryDescription = document.querySelector("#category-description");
const categoryRefreshButton = document.querySelector("#category-refresh");
const categoryOfficialLink = document.querySelector("#category-official-link");
const categoryGroups = document.querySelector("#category-groups");
const shortlistList = document.querySelector("#shortlist-list");
const shortlistSortInput = document.querySelector("#shortlist-sort");
const shortlistCopyButton = document.querySelector("#shortlist-copy");
const shortlistExportButton = document.querySelector("#shortlist-export");
const shortlistImportButton = document.querySelector("#shortlist-import");
const shortlistClearButton = document.querySelector("#shortlist-clear");
const shortlistImportFile = document.querySelector("#shortlist-import-file");
const pager = document.querySelector("#pager");
const results = document.querySelector("#results");
const statusLine = document.querySelector("#status-line");
const statusTitle = document.querySelector("#status-title");
const statusCount = document.querySelector("#status-count");
const submitButton = document.querySelector("#submit-button");
const clearButton = document.querySelector("#clear-button");
const sortButton = document.querySelector("#sort-button");
const viewListButton = document.querySelector("#view-list");
const viewGridButton = document.querySelector("#view-grid");
const resultTemplate = document.querySelector("#result-template");
const {
  cloneRows,
  clonePagination,
  cloneCategoryGroups,
  normalizeShortlistRows,
  buildShortlistExport,
  parseShortlistImport,
  mergeShortlistRows,
  dedupeDisplayRows,
  sortShortlistRows,
  sortRows: sortResultRows,
  buildCategoryGroups,
  normalizePattern,
  toOfficialPattern,
  getBatchSize: resolveBatchSize,
  getLoadedPages: resolveLoadedPages,
  getBatchPages: resolveBatchPages,
  formatPageRange: resolvePageRange,
  buildBatchSequence: resolveBatchSequence,
  buildSnapshot,
  restoreSnapshotState,
  normalizeSearchDraft
} = window.CHTAppLogic;

const mobileMedia = window.matchMedia("(max-width: 640px)");

function loadShortlist() {
  try {
    return window.CHTAppLogic.normalizeShortlistRows(
      JSON.parse(localStorage.getItem(SHORTLIST_STORAGE_KEY) || "[]")
    );
  } catch {
    return [];
  }
}

function saveShortlist() {
  state.shortlist = normalizeShortlistRows(state.shortlist);
  localStorage.setItem(SHORTLIST_STORAGE_KEY, JSON.stringify(state.shortlist));
}

function loadDisplayMode() {
  return localStorage.getItem(DISPLAY_STORAGE_KEY) === "grid" ? "grid" : "list";
}

function saveDisplayMode() {
  localStorage.setItem(DISPLAY_STORAGE_KEY, state.displayMode);
}

function loadSearchDraft() {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_DRAFT_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSearchDraft(draft) {
  localStorage.setItem(SEARCH_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function syncDisplayMode() {
  const isGrid = state.displayMode === "grid";
  results.classList.toggle("is-grid", isGrid);
  viewListButton.classList.toggle("is-active", !isGrid);
  viewGridButton.classList.toggle("is-active", isGrid);
  viewListButton.setAttribute("aria-pressed", String(!isGrid));
  viewGridButton.setAttribute("aria-pressed", String(isGrid));
}

function setDisplayMode(mode) {
  state.displayMode = mode === "grid" ? "grid" : "list";
  saveDisplayMode();
  syncDisplayMode();
}

function flashButtonLabel(button, text, fallback, delay = 1200) {
  button.textContent = text;
  clearTimeout(button._flashTimeout);
  button._flashTimeout = setTimeout(() => {
    button.textContent = fallback;
  }, delay);
}

function getQuickLink(id) {
  return state.config?.quickLinks?.find((link) => link.id === id) || null;
}

function getFilters() {
  return [...form.querySelectorAll("input[name='filters']:checked")].map((input) => input.value);
}

function getSearchDraftOptions() {
  return {
    prefixes: state.config?.prefixes || [],
    modes: ["all", "pattern", "fee"],
    fees: [...feeInput.options].map((optionNode) => optionNode.value),
    pageLimits: [...pageLimitInput.options].map((optionNode) => optionNode.value),
    filters: state.config?.filters?.map((filter) => filter.value) || []
  };
}

function persistSearchDraft() {
  if (!state.config) return;
  saveSearchDraft(
    normalizeSearchDraft(
      {
        prefix: prefixInput.value,
        mode: modeInput.value,
        pattern: patternInput.value,
        fee: feeInput.value,
        pageLimit: pageLimitInput.value,
        filters: getFilters()
      },
      getSearchDraftOptions()
    )
  );
}

function applySearchDraft() {
  if (!state.config) return;
  const draft = normalizeSearchDraft(loadSearchDraft(), getSearchDraftOptions());
  prefixInput.value = draft.prefix;
  modeInput.value = draft.mode;
  patternInput.value = draft.pattern;
  feeInput.value = draft.fee;
  pageLimitInput.value = draft.pageLimit;
  form.querySelectorAll("input[name='filters']").forEach((input) => {
    input.checked = draft.filters.includes(input.value);
  });
}

function option(value, label = value) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function setStatus(title, count = state.rows.length) {
  statusTitle.textContent = title;
  statusCount.textContent = String(count);
}

function setStatusVisible(visible) {
  statusLine.classList.toggle("is-hidden", !visible);
}

function resetPagination() {
  state.pagination = clonePagination(DEFAULT_PAGINATION);
  pager.classList.add("is-hidden");
  pager.replaceChildren();
}

function buildRowMeta(row) {
  const parts = [];
  if (row.bucket) parts.push(row.bucket);
  if (row.fee !== null) parts.push(`${row.feeLabel || "選號費"} NT ${row.fee} 元`);
  if (row.score?.reasons?.length) parts.push(row.score.reasons.join("、"));
  return parts.join(" · ") || "費用未標示";
}

function isShortlisted(number) {
  return state.shortlist.some((item) => item.number === number);
}

function openStatusWindow(row) {
  if (!row.statusUrl) return;
  window.open(
    row.statusUrl,
    `cht-status-${row.number}`,
    "width=680,height=720,scrollbars=yes,resizable=yes"
  );
}

function renderShortlist() {
  shortlistCopyButton.disabled = state.shortlist.length === 0;
  shortlistExportButton.disabled = state.shortlist.length === 0;
  shortlistClearButton.disabled = state.shortlist.length === 0;

  if (!state.shortlist.length) {
    const empty = document.createElement("p");
    empty.className = "shortlist-empty";
    empty.textContent = "按結果列右側的星號，把喜歡的門號先收進來。";
    shortlistList.replaceChildren(empty);
    return;
  }

  const nodes = sortedShortlist().map((row) => {
    const article = document.createElement("article");
    article.className = "shortlist-item";

    const copy = document.createElement("div");

    const number = document.createElement("p");
    number.className = "number";
    number.textContent = formatNumber(row.number);

    const meta = document.createElement("p");
    meta.className = "number-meta";
    meta.textContent = buildRowMeta(row);

    copy.append(number, meta);

    const actions = document.createElement("div");
    actions.className = "shortlist-actions";

    if (row.statusUrl) {
      const status = document.createElement("button");
      status.className = "status-button";
      status.type = "button";
      status.title = `立即查 ${row.number}`;
      status.setAttribute("aria-label", `立即查 ${row.number}`);
      status.addEventListener("click", () => openStatusWindow(row));
      actions.append(status);
    }

    const remove = document.createElement("button");
    remove.className = "pick-button is-active";
    remove.type = "button";
    remove.title = `移出待選 ${row.number}`;
    remove.setAttribute("aria-label", `移出待選 ${row.number}`);
    remove.textContent = "★";
    remove.addEventListener("click", () => toggleShortlist(row));
    actions.append(remove);

    article.append(copy, actions);
    return article;
  });

  shortlistList.replaceChildren(...nodes);
}

function sortedShortlist() {
  return sortShortlistRows(state.shortlist, state.shortlistSort);
}

async function copyShortlist() {
  if (!state.shortlist.length) return;

  const text = sortedShortlist().map((row) => row.number).join("\n");
  await navigator.clipboard.writeText(text);
  flashButtonLabel(shortlistCopyButton, "已複製", "複製全部");
}

function exportShortlist() {
  if (!state.shortlist.length) return;
  const content = buildShortlistExport(sortedShortlist());
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cht-shortlist-${stamp}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  flashButtonLabel(shortlistExportButton, "已匯出", "匯出");
}

async function importShortlistFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const importedRows = parseShortlistImport(text);
    if (!importedRows.length) {
      flashButtonLabel(shortlistImportButton, "沒有可匯入", "匯入", 1600);
      return;
    }

    const beforeCount = state.shortlist.length;
    state.shortlist = mergeShortlistRows(state.shortlist, importedRows);
    saveShortlist();
    renderShortlist();
    if (state.rows.length) {
      renderResults();
    }

    const addedCount = Math.max(0, state.shortlist.length - beforeCount);
    flashButtonLabel(
      shortlistImportButton,
      addedCount ? `已匯入 ${addedCount}` : "已合併",
      "匯入",
      1600
    );
  } catch (error) {
    flashButtonLabel(shortlistImportButton, "匯入失敗", "匯入", 1800);
    console.warn("Shortlist import failed", error);
  } finally {
    shortlistImportFile.value = "";
  }
}

function syncQuickLinks() {
  quickLinks.querySelectorAll(".quick-link").forEach((button) => {
    const isActive = button.dataset.quickLink === state.activeQuickLink;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderQuickLinks() {
  const nodes = state.config.quickLinks.map((link) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-link";
    button.dataset.quickLink = link.id;
    button.textContent = link.label;
    button.title = link.description;

    if (link.kind === "external") {
      button.classList.add("is-external");
      button.addEventListener("click", () => {
        window.open(link.officialUrl, "_blank", "noopener,noreferrer");
      });
    } else {
      button.addEventListener("click", () => {
        activateQuickLink(link.id);
      });
    }

    return button;
  });

  quickLinks.replaceChildren(...nodes);
  syncQuickLinks();
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("設定載入失敗");
  state.config = await response.json();

  prefixInput.replaceChildren(...state.config.prefixes.map((prefix) => option(prefix)));

  const chips = state.config.filters.map((filter) => {
    const label = document.createElement("label");
    label.className = "filter-chip";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "filters";
    input.value = filter.value;

    const text = document.createElement("span");
    text.textContent = filter.label;

    label.append(input, text);
    return label;
  });

  filterList.replaceChildren(...chips);
  renderQuickLinks();
}

function syncModeFields() {
  const mode = modeInput.value;
  patternField.hidden = mode !== "pattern";
  feeField.hidden = mode !== "fee";
}

function updateFilterSummary() {
  const count = getFilters().length;
  filterSummary.textContent = count ? `已選 ${count}` : "進階篩選";
}

function bucketKey(row) {
  return row.bucket || "未分類";
}

function clearCategoryState() {
  state.categoryRows = [];
  state.categoryGroups = [];
  state.activeCategoryGroup = CATEGORY_ALL_GROUP;
  renderCategoryGroups();
}

function currentCategoryGroup() {
  if (state.activeCategoryGroup === CATEGORY_ALL_GROUP) {
    return {
      key: CATEGORY_ALL_GROUP,
      label: "全部",
      count: state.categoryRows.length
    };
  }
  return state.categoryGroups.find((group) => group.key === state.activeCategoryGroup) || null;
}

function syncCategoryRows(baseMessage) {
  const group = currentCategoryGroup();
  const isGrouped = state.categoryGroups.length > 1 && group?.key !== CATEGORY_ALL_GROUP;
  state.rows = isGrouped
    ? cloneRows(state.categoryRows.filter((row) => bucketKey(row) === group.key))
    : cloneRows(state.categoryRows);

  const link = getQuickLink(state.activeQuickLink);
  const title = baseMessage || (link ? `已載入${link.label}` : "已載入官方快選");
  setStatus(isGrouped ? `${title} · ${group.label}` : title, state.rows.length);
  renderCategoryGroups();
}

function renderCategoryGroups() {
  const shouldShow = state.activeQuickLink !== "free" && state.categoryGroups.length > 1;
  categoryGroups.hidden = !shouldShow;

  if (!shouldShow) {
    categoryGroups.replaceChildren();
    return;
  }

  const nodes = state.categoryGroups.map((group) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-group-chip";
    button.dataset.categoryGroup = group.key;
    button.classList.toggle("is-active", state.activeCategoryGroup === group.key);
    button.setAttribute("aria-pressed", String(state.activeCategoryGroup === group.key));
    button.textContent = `${group.label} ${group.count}`;
    button.addEventListener("click", () => {
      setCategoryGroup(group.key);
    });
    return button;
  });

  const all = document.createElement("button");
  all.type = "button";
  all.className = "category-group-chip is-all";
  all.dataset.categoryGroup = CATEGORY_ALL_GROUP;
  all.classList.toggle("is-active", state.activeCategoryGroup === CATEGORY_ALL_GROUP);
  all.setAttribute("aria-pressed", String(state.activeCategoryGroup === CATEGORY_ALL_GROUP));
  all.textContent = `全部 ${state.categoryRows.length}`;
  all.addEventListener("click", () => {
    setCategoryGroup(CATEGORY_ALL_GROUP);
  });

  categoryGroups.replaceChildren(...nodes, all);
}

function setCategoryGroup(groupKey) {
  state.activeCategoryGroup = groupKey;
  syncCategoryRows();
  renderResults();
  renderPager();
  saveSnapshot(state.activeQuickLink);
}

function syncResponsiveLayout() {
  if (mobileMedia.matches) {
    if (!filtersWrap.dataset.userTouched) {
      filtersWrap.open = false;
    }
  } else {
    filtersWrap.open = true;
  }
}

function syncSourceView() {
  const link = getQuickLink(state.activeQuickLink);
  const isFreeSearch = !link || link.kind === "search";

  searchPanel.hidden = !isFreeSearch;
  categoryPanel.hidden = link?.kind !== "feed";
  if (link?.kind !== "feed") {
    categoryGroups.hidden = true;
  } else {
    renderCategoryGroups();
  }

  if (link?.kind === "feed") {
    categoryKicker.textContent = "官方快選";
    categoryTitle.textContent = link.label;
    categoryDescription.textContent = link.description;
    categoryOfficialLink.href = link.officialUrl;
  }
}

function buildPayload() {
  return {
    prefix: prefixInput.value,
    mode: modeInput.value,
    pattern: toOfficialPattern(patternInput.value),
    fee: feeInput.value,
    pageLimit: Number(pageLimitInput.value),
    filters: getFilters()
  };
}

function formatNumber(number) {
  return `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`;
}

function sortedRows() {
  return sortResultRows(state.rows, state.sortByScore);
}

function renderEmpty(title, detail = "") {
  state.emptyState = { title, detail };

  const node = document.createElement("div");
  node.className = "empty-state";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const text = document.createElement("span");
  text.textContent = detail;

  node.append(heading, text);
  results.replaceChildren(node);
}

function toggleShortlist(row) {
  const index = state.shortlist.findIndex((item) => item.number === row.number);
  if (index >= 0) {
    state.shortlist.splice(index, 1);
  } else {
    state.shortlist.unshift({
      number: row.number,
      fee: row.fee,
      feeLabel: row.feeLabel,
      bucket: row.bucket,
      score: row.score,
      statusUrl: row.statusUrl || null
    });
  }

  saveShortlist();
  renderShortlist();
  if (state.rows.length) {
    renderResults();
  }
}

function renderResults() {
  if (!state.rows.length) {
    renderEmpty("沒有可顯示的門號", "換一個分類或條件再查一次。");
    return;
  }

  const nodes = sortedRows().map((row) => {
    const node = resultTemplate.content.firstElementChild.cloneNode(true);
    const number = node.querySelector(".number");
    const meta = node.querySelector(".number-meta");
    const status = node.querySelector(".status-button");
    const pick = node.querySelector(".pick-button");
    const picked = isShortlisted(row.number);

    number.textContent = formatNumber(row.number);
    meta.textContent = buildRowMeta(row);
    status.title = `立即查 ${row.number}`;
    status.setAttribute("aria-label", `立即查 ${row.number}`);

    if (row.statusUrl) {
      status.addEventListener("click", () => openStatusWindow(row));
    } else {
      status.disabled = true;
      status.title = "這筆結果沒有官方即時查 token";
    }

    pick.textContent = picked ? "★" : "☆";
    pick.classList.toggle("is-active", picked);
    pick.title = picked ? `移出待選 ${row.number}` : `加入待選 ${row.number}`;
    pick.setAttribute("aria-label", pick.title);
    pick.addEventListener("click", () => toggleShortlist(row));

    return node;
  });

  results.replaceChildren(...nodes);
}

function makeSnapshot() {
  return buildSnapshot(
    {
      rows: state.rows,
      categoryRows: state.categoryRows,
      categoryGroups: state.categoryGroups,
      activeCategoryGroup: state.activeCategoryGroup,
      statusTitle: statusTitle.textContent,
      statusCount: Number(statusCount.textContent) || 0,
      visible: !statusLine.classList.contains("is-hidden"),
      emptyState: state.emptyState,
      pagination: state.pagination
    },
    {
      defaultEmptyState: DEFAULT_EMPTY_STATE,
      defaultPagination: DEFAULT_PAGINATION,
      categoryAllGroup: CATEGORY_ALL_GROUP
    }
  );
}

function saveSnapshot(id = state.activeQuickLink) {
  state.snapshots.set(id, makeSnapshot());
}

function getBatchSize(pagination = state.pagination) {
  return resolveBatchSize(pagination);
}

function getLoadedPages(pagination = state.pagination) {
  return resolveLoadedPages(pagination);
}

function getBatchPages(startPage, totalPages = state.pagination.totalPages) {
  return resolveBatchPages(startPage, totalPages, getBatchSize());
}

function formatPageRange(startPage, totalPages = state.pagination.totalPages) {
  return resolvePageRange(startPage, totalPages, getBatchSize());
}

function renderPager() {
  const shouldShow = state.activeQuickLink === "free" && state.pagination.totalPages > 1;
  pager.classList.toggle("is-hidden", !shouldShow);

  if (!shouldShow) {
    pager.replaceChildren();
    return;
  }

  const nodes = [];
  const summary = document.createElement("span");
  summary.className = "pager-summary";
  const loadedPages = getLoadedPages();
  const firstLoaded = Math.min(...loadedPages);
  const lastLoaded = Math.max(...loadedPages);
  summary.textContent = `第 ${
    firstLoaded === lastLoaded ? firstLoaded : `${firstLoaded}-${lastLoaded}`
  } / ${state.pagination.totalPages} 頁`;
  nodes.push(summary);

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "pager-button";
  prev.textContent = "‹";
  prev.disabled = firstLoaded <= 1;
  prev.addEventListener("click", () => {
    goToSearchBatch(Math.max(1, firstLoaded - getBatchSize()));
  });
  nodes.push(prev);

  const sequence = buildBatchSequence(firstLoaded, state.pagination.totalPages);
  sequence.forEach((entry) => {
    if (entry === "...") {
      const gap = document.createElement("span");
      gap.className = "pager-gap";
      gap.textContent = "…";
      nodes.push(gap);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "pager-button";
    button.textContent = formatPageRange(entry);
    button.classList.toggle("is-active", entry === firstLoaded);
    button.classList.toggle("is-range", getBatchSize() > 1);
    button.addEventListener("click", () => goToSearchBatch(entry));
    nodes.push(button);
  });

  const next = document.createElement("button");
  next.type = "button";
  next.className = "pager-button";
  next.textContent = "›";
  next.disabled = lastLoaded >= state.pagination.totalPages;
  next.addEventListener("click", () => {
    goToSearchBatch(Math.min(state.pagination.totalPages, firstLoaded + getBatchSize()));
  });
  nodes.push(next);

  pager.replaceChildren(...nodes);
}

function buildBatchSequence(currentStart, total) {
  return resolveBatchSequence(currentStart, total, getBatchSize());
}

function restoreSnapshot(id) {
  const restored = restoreSnapshotState(state.snapshots.get(id), {
    defaultEmptyState: DEFAULT_EMPTY_STATE,
    defaultPagination: DEFAULT_PAGINATION,
    categoryAllGroup: CATEGORY_ALL_GROUP
  });
  if (!restored) return false;

  state.rows = restored.rows;
  state.categoryRows = restored.categoryRows;
  state.categoryGroups = restored.categoryGroups;
  state.activeCategoryGroup = restored.activeCategoryGroup;
  state.pagination = restored.pagination;
  setStatus(restored.status.title, restored.status.count);
  setStatusVisible(restored.status.visible);
  renderCategoryGroups();

  if (state.rows.length) {
    renderResults();
  } else {
    renderEmpty(restored.emptyState.title, restored.emptyState.detail);
  }

  renderPager();
  return true;
}

function showErrors(errors) {
  const message = Array.isArray(errors) ? errors.join(" ") : String(errors);
  setStatusVisible(true);
  setStatus("查詢未送出", 0);
  renderEmpty("條件需要調整", message);
  saveSnapshot("free");
}

function pageStatusText(base, currentPage, totalPages) {
  return totalPages > 1 ? `${base} · 第 ${currentPage} / ${totalPages} 頁` : base;
}

function loadedPagesStatusText(base) {
  const loadedPages = getLoadedPages();
  if (loadedPages.length <= 1) {
    return pageStatusText(base, state.pagination.currentPage, state.pagination.totalPages);
  }
  const firstLoaded = Math.min(...loadedPages);
  const lastLoaded = Math.max(...loadedPages);
  return `${base} · 第 ${firstLoaded}-${lastLoaded} / ${state.pagination.totalPages} 頁`;
}

async function fetchSearchPage(page, { silent = false } = {}) {
  if (state.pageCache.has(page)) {
    return {
      rows: cloneRows(state.pageCache.get(page)),
      pagination: { pageCount: state.pagination.totalPages }
    };
  }

  const contextId = state.pageContextId;
  if (!silent) {
    setStatus(pageStatusText("切換頁面", page, state.pagination.totalPages), 0);
    renderEmpty("查詢中", "正在抓官方頁面。");
  }

  const response = await fetch(`/api/search-page?page=${page}`);
  const data = await response.json();
  if (contextId !== state.pageContextId) return null;

  if (!response.ok) {
    if (!silent) {
      setStatus("頁面切換失敗", 0);
      renderEmpty("無法切換頁面", data.error || "請重新查詢。");
      saveSnapshot("free");
    }
    return null;
  }

  state.pageCache.set(page, cloneRows(data.rows || []));
  return data;
}

async function goToSearchBatch(startPage) {
  if (startPage < 1 || startPage > state.pagination.totalPages) return;

  const contextId = state.pageContextId;
  const pages = getBatchPages(startPage);
  const totalPages = state.pagination.totalPages;
  const batchSize = getBatchSize();
  setStatus(`切換頁面 · 第 ${formatPageRange(startPage, totalPages)} / ${totalPages} 頁`, 0);
  renderEmpty("查詢中", "正在抓官方頁面。");

  for (const page of pages) {
    const data = await fetchSearchPage(page, { silent: true });
    if (!data || contextId !== state.pageContextId) {
      if (contextId === state.pageContextId) {
        setStatus("頁面切換失敗", 0);
        renderEmpty("無法切換頁面", "官方查詢狀態可能已過期，請重新查詢。");
        renderPager();
        saveSnapshot("free");
      }
      return;
    }
  }

  const rows = pages.flatMap((page) => cloneRows(state.pageCache.get(page) || []));
  state.rows = dedupeDisplayRows(rows);
  state.pagination = {
    currentPage: pages[0] || startPage,
    totalPages,
    batchSize,
    loadedPages: pages
  };

  setStatus(loadedPagesStatusText("已切換"), state.rows.length);
  renderResults();
  renderPager();
  saveSnapshot("free");
}

async function search(event) {
  event.preventDefault();

  patternInput.value = normalizePattern(patternInput.value);
  const payload = buildPayload();
  submitButton.disabled = true;
  submitButton.textContent = "查詢中";
  state.pageContextId += 1;
  state.pageCache.clear();
  clearCategoryState();
  resetPagination();
  setStatusVisible(true);
  setStatus("連線到官方系統", 0);
  renderEmpty("查詢中", "通常需要幾秒鐘。");

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      showErrors(data.errors || data.error || "查詢失敗");
      return;
    }

    state.rows = data.rows || [];
    state.pageCache.clear();
    Object.entries(data.pageRows || { 1: state.rows }).forEach(([page, rows]) => {
      state.pageCache.set(Number(page), cloneRows(rows || []));
    });
    const loadedPages = data.loadedPages?.length
      ? data.loadedPages
      : Array.from(
          { length: Math.min(payload.pageLimit, data.pagination?.pageCount || 1) },
          (_, index) => index + 1
        );
    const batchSize = Math.max(1, Number(payload.pageLimit) || 1);
    state.pagination = {
      currentPage: loadedPages[0] || 1,
      totalPages: data.pagination?.pageCount || 1,
      batchSize,
      loadedPages
    };

    setStatus(loadedPagesStatusText(data.message || "查詢完成"), state.rows.length);
    renderResults();
    renderPager();
    saveSnapshot("free");
  } catch (error) {
    setStatus("查詢失敗", 0);
    renderEmpty("無法連線", error.message || "請稍後再試。");
    saveSnapshot("free");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "查詢門號";
  }
}

function clearForm() {
  patternInput.value = "";
  feeInput.value = "480";
  pageLimitInput.value = "1";
  form.querySelectorAll("input[name='filters']").forEach((input) => {
    input.checked = false;
  });
  updateFilterSummary();
  syncResponsiveLayout();
  state.rows = [];
  state.pageContextId += 1;
  state.pageCache.clear();
  clearCategoryState();
  resetPagination();
  setStatusVisible(false);
  setStatus("準備查詢", 0);
  renderEmpty(DEFAULT_EMPTY_STATE.title, DEFAULT_EMPTY_STATE.detail);
  persistSearchDraft();
  saveSnapshot("free");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function fetchCategory(link) {
  categoryRefreshButton.disabled = true;
  state.pageContextId += 1;
  state.pageCache.clear();
  clearCategoryState();
  resetPagination();
  setStatusVisible(true);
  setStatus(`載入${link.label}`, 0);
  renderEmpty("查詢中", "正在整理官方快選門號。");

  try {
    const response = await fetch(`/api/category?type=${encodeURIComponent(link.id)}`);
    const data = await response.json();

    if (!response.ok) {
      setStatus(`${link.label}`, 0);
      renderEmpty("載入失敗", data.error || "請稍後再試。");
      saveSnapshot(link.id);
      return;
    }

    state.categoryRows = cloneRows(data.rows || []);
    state.categoryGroups = buildCategoryGroups(state.categoryRows);
    state.activeCategoryGroup =
      state.categoryGroups.length > 1 ? state.categoryGroups[0].key : CATEGORY_ALL_GROUP;
    syncCategoryRows(link.label);
    renderResults();
    renderPager();
    saveSnapshot(link.id);
  } catch (error) {
    setStatus(`${link.label}`, 0);
    renderEmpty("無法連線", error.message || "請稍後再試。");
    saveSnapshot(link.id);
  } finally {
    categoryRefreshButton.disabled = false;
  }
}

async function activateQuickLink(id, { force = false } = {}) {
  const link = getQuickLink(id);
  if (!link) return;

  if (state.activeQuickLink !== id) {
    saveSnapshot(state.activeQuickLink);
    state.activeQuickLink = id;
    syncQuickLinks();
    syncSourceView();
  }

  if (link.kind === "search") {
    if (!restoreSnapshot("free")) {
      state.rows = [];
      state.pageCache.clear();
      resetPagination();
      setStatusVisible(false);
      setStatus("準備查詢", 0);
      renderEmpty(DEFAULT_EMPTY_STATE.title, DEFAULT_EMPTY_STATE.detail);
      saveSnapshot("free");
    }
    return;
  }

  if (!force && restoreSnapshot(id)) {
    return;
  }

  await fetchCategory(link);
}

prefixInput.addEventListener("change", persistSearchDraft);
modeInput.addEventListener("change", () => {
  syncModeFields();
  persistSearchDraft();
});
feeInput.addEventListener("change", persistSearchDraft);
pageLimitInput.addEventListener("change", persistSearchDraft);
filtersWrap.addEventListener("toggle", () => {
  filtersWrap.dataset.userTouched = "true";
});
filterList.addEventListener("change", () => {
  updateFilterSummary();
  persistSearchDraft();
});
mobileMedia.addEventListener("change", syncResponsiveLayout);
patternInput.addEventListener("input", () => {
  const caret = patternInput.selectionStart;
  patternInput.value = normalizePattern(patternInput.value);
  patternInput.setSelectionRange(caret, caret);
  persistSearchDraft();
});
form.addEventListener("submit", search);
clearButton.addEventListener("click", clearForm);
categoryRefreshButton.addEventListener("click", () => {
  const link = getQuickLink(state.activeQuickLink);
  if (link?.kind === "feed") {
    fetchCategory(link);
  }
});
shortlistClearButton.addEventListener("click", () => {
  state.shortlist = [];
  saveShortlist();
  renderShortlist();
  if (state.rows.length) {
    renderResults();
  }
});
shortlistCopyButton.addEventListener("click", () => {
  copyShortlist();
});
shortlistExportButton.addEventListener("click", () => {
  exportShortlist();
});
shortlistImportButton.addEventListener("click", () => {
  shortlistImportFile.click();
});
shortlistImportFile.addEventListener("change", () => {
  importShortlistFile(shortlistImportFile.files?.[0] || null);
});
shortlistSortInput.addEventListener("change", () => {
  state.shortlistSort = shortlistSortInput.value;
  renderShortlist();
});
sortButton.addEventListener("click", () => {
  state.sortByScore = !state.sortByScore;
  sortButton.textContent = state.sortByScore ? "依好記度" : "依號碼";
  renderResults();
  saveSnapshot(state.activeQuickLink);
});
viewListButton.addEventListener("click", () => {
  setDisplayMode("list");
});
viewGridButton.addEventListener("click", () => {
  setDisplayMode("grid");
});

loadConfig()
  .then(() => {
    applySearchDraft();
    syncModeFields();
    updateFilterSummary();
    syncResponsiveLayout();
    syncSourceView();
    syncDisplayMode();
    setStatusVisible(false);
    renderEmpty(DEFAULT_EMPTY_STATE.title, DEFAULT_EMPTY_STATE.detail);
    renderShortlist();
    persistSearchDraft();
    saveSnapshot("free");
  })
  .catch((error) => {
    setStatus("設定載入失敗", 0);
    renderEmpty("無法啟動", error.message);
  });

registerServiceWorker();
