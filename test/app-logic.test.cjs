const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
} = require("../public/app-logic.js");

test("normalizePattern and toOfficialPattern keep mobile-friendly x input stable", () => {
  assert.equal(normalizePattern("58??58"), "58xx58");
  assert.equal(normalizePattern(" 58Ｘx5?8abc "), "58xx5x");
  assert.equal(toOfficialPattern("58xx58"), "58??58");
});

test("sortShortlistRows respects added, number, and score modes", () => {
  const rows = [
    { number: "0905123456", score: { value: 8 } },
    { number: "0905000001", score: { value: 20 } },
    { number: "0905888888", score: { value: 20 } }
  ];

  assert.deepEqual(
    sortShortlistRows(rows, "added").map((row) => row.number),
    ["0905123456", "0905000001", "0905888888"]
  );
  assert.deepEqual(
    sortShortlistRows(rows, "number").map((row) => row.number),
    ["0905000001", "0905123456", "0905888888"]
  );
  assert.deepEqual(
    sortShortlistRows(rows, "score").map((row) => row.number),
    ["0905000001", "0905888888", "0905123456"]
  );
});

test("sortRows switches between score-first and number-first ordering", () => {
  const rows = [
    { number: "0905888888", score: { value: 12 } },
    { number: "0905999999", score: { value: 18 } },
    { number: "0905111111", score: { value: 18 } }
  ];

  assert.deepEqual(
    sortRows(rows, true).map((row) => row.number),
    ["0905111111", "0905999999", "0905888888"]
  );
  assert.deepEqual(
    sortRows(rows, false).map((row) => row.number),
    ["0905111111", "0905888888", "0905999999"]
  );
});

test("dedupeDisplayRows keeps first occurrence of each number", () => {
  const rows = [
    { number: "0905111111", source: "a" },
    { number: "0905222222", source: "b" },
    { number: "0905111111", source: "c" },
    { number: "", source: "d" }
  ];

  const output = dedupeDisplayRows(rows);
  assert.equal(output.length, 2);
  assert.deepEqual(output.map((row) => row.source), ["a", "b"]);
});

test("buildCategoryGroups counts themed buckets and unnamed rows", () => {
  const groups = buildCategoryGroups([
    { bucket: "一路發" },
    { bucket: "一路發" },
    { bucket: "步步高升" },
    {}
  ]);

  assert.deepEqual(groups, [
    { key: "一路發", label: "一路發", count: 2 },
    { key: "步步高升", label: "步步高升", count: 1 },
    { key: "未分類", label: "未分類", count: 1 }
  ]);
});

test("pagination helpers build page ranges and pager sequence by batch size", () => {
  const pagination = {
    currentPage: 6,
    totalPages: 25,
    batchSize: 5,
    loadedPages: [6, 7, 8, 9, 10]
  };

  assert.equal(getBatchSize(pagination), 5);
  assert.deepEqual(getLoadedPages(pagination), [6, 7, 8, 9, 10]);
  assert.deepEqual(getBatchPages(6, 25, 5), [6, 7, 8, 9, 10]);
  assert.equal(formatPageRange(6, 25, 5), "6-10");
  assert.deepEqual(buildBatchSequence(6, 25, 5), [1, 6, 11, 16, 21]);
});

test("pagination sequence inserts ellipsis when batch list is long", () => {
  assert.deepEqual(buildBatchSequence(16, 60, 5), [1, "...", 11, 16, 21, "...", 56]);
  assert.deepEqual(buildBatchSequence(1, 60, 5), [1, 6, 11, 16, "...", 56]);
  assert.deepEqual(buildBatchSequence(56, 60, 5), [1, "...", 41, 46, 51, 56]);
});

test("clone helpers copy nested frontend state without sharing references", () => {
  const rows = [
    {
      number: "0905111111",
      score: {
        value: 18,
        reasons: ["順子", "尾數4"]
      }
    }
  ];
  const pagination = { currentPage: 5, totalPages: 25, batchSize: 5, loadedPages: [9, 8, 7, 6, 10] };
  const groups = [{ key: "一路發", label: "一路發", count: 2 }];

  const rowClone = cloneRows(rows);
  const paginationClone = clonePagination(pagination);
  const groupClone = cloneCategoryGroups(groups);

  assert.deepEqual(rowClone, rows);
  assert.deepEqual(paginationClone, {
    currentPage: 5,
    totalPages: 25,
    batchSize: 5,
    loadedPages: [6, 7, 8, 9, 10]
  });
  assert.deepEqual(groupClone, groups);

  rowClone[0].score.reasons.push("新理由");
  paginationClone.loadedPages.push(11);
  groupClone[0].count = 99;

  assert.deepEqual(rows[0].score.reasons, ["順子", "尾數4"]);
  assert.deepEqual(pagination.loadedPages, [9, 8, 7, 6, 10]);
  assert.equal(groups[0].count, 2);
});

test("buildSnapshot normalizes quick-link snapshot payloads", () => {
  const snapshot = buildSnapshot(
    {
      rows: [{ number: "0905111111", score: { value: 10, reasons: ["順子"] } }],
      categoryRows: [{ number: "0905222222" }],
      categoryGroups: [{ key: "一路發", label: "一路發", count: 1 }],
      activeCategoryGroup: "一路發",
      statusTitle: "已載入主題門號",
      statusCount: "12",
      visible: 1,
      emptyState: { title: "空", detail: "目前沒資料" },
      pagination: { currentPage: 6, totalPages: 25, batchSize: 5, loadedPages: [10, 6, 8, 7, 9] }
    },
    {
      defaultEmptyState: { title: "尚未查詢", detail: "選好條件後開始。" },
      defaultPagination: { currentPage: 1, totalPages: 1, batchSize: 1, loadedPages: [1] },
      categoryAllGroup: "__all"
    }
  );

  assert.deepEqual(snapshot, {
    rows: [{ number: "0905111111", score: { value: 10, reasons: ["順子"] } }],
    categoryRows: [{ number: "0905222222", score: null }],
    categoryGroups: [{ key: "一路發", label: "一路發", count: 1 }],
    activeCategoryGroup: "一路發",
    statusTitle: "已載入主題門號",
    statusCount: 12,
    visible: true,
    emptyTitle: "空",
    emptyDetail: "目前沒資料",
    pagination: {
      currentPage: 6,
      totalPages: 25,
      batchSize: 5,
      loadedPages: [6, 7, 8, 9, 10]
    }
  });
});

test("restoreSnapshotState rebuilds view state and falls back to defaults for partial snapshots", () => {
  const restored = restoreSnapshotState(
    {
      rows: [{ number: "0905333333" }],
      statusTitle: "查詢完成",
      statusCount: "3",
      visible: true,
      emptyTitle: "沒有資料",
      emptyDetail: "請再查一次"
    },
    {
      defaultEmptyState: { title: "尚未查詢", detail: "選好條件後開始。" },
      defaultPagination: { currentPage: 1, totalPages: 1, batchSize: 1, loadedPages: [1] },
      categoryAllGroup: "__all"
    }
  );

  assert.deepEqual(restored, {
    rows: [{ number: "0905333333", score: null }],
    categoryRows: [],
    categoryGroups: [],
    activeCategoryGroup: "__all",
    status: {
      title: "查詢完成",
      count: 3,
      visible: true
    },
    emptyState: {
      title: "沒有資料",
      detail: "請再查一次"
    },
    pagination: {
      currentPage: 1,
      totalPages: 1,
      batchSize: 1,
      loadedPages: [1]
    }
  });

  assert.equal(restoreSnapshotState(null), null);
});
