const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
  buildBatchSequence
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
