const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
  normalizeSuffix,
  normalizeSearchInput,
  toOfficialPattern,
  normalizeNumberCopyFormat,
  normalizeNumberCopyDetailMode,
  formatCopyNumber,
  buildRowMetaText,
  buildCompactRowNote,
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
} = require("../public/app-logic.js");

function toBase64Url(value) {
  return Buffer.from(String(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

test("normalizePattern, normalizeSuffix, and toOfficialPattern keep mobile-friendly search input stable", () => {
  assert.equal(normalizePattern("58??58"), "58xx58");
  assert.equal(normalizePattern(" 58Ｘx5?8abc "), "58xx5x");
  assert.equal(normalizeSuffix(" 12-34ab "), "1234");
  assert.equal(normalizeSearchInput("suffix", "12-34ab"), "1234");
  assert.equal(normalizeSearchInput("pattern", "58??58"), "58xx58");
  assert.equal(toOfficialPattern("58xx58"), "58??58");
});

test("number copy format helpers switch between plain and spaced output", () => {
  assert.equal(normalizeNumberCopyFormat("spaced"), "spaced");
  assert.equal(normalizeNumberCopyFormat("weird"), "plain");
  assert.equal(normalizeNumberCopyDetailMode("annotated"), "annotated");
  assert.equal(normalizeNumberCopyDetailMode("line"), "line");
  assert.equal(normalizeNumberCopyDetailMode("line-compact"), "line-compact");
  assert.equal(normalizeNumberCopyDetailMode("other"), "number");
  assert.equal(formatCopyNumber("0905123456", "plain"), "0905123456");
  assert.equal(formatCopyNumber("0905123456", "spaced"), "0905 123 456");
  assert.equal(
    buildRowMetaText({
      fee: 480,
      feeLabel: "選號費",
      bucket: "一路發",
      score: { reasons: ["順子"] }
    }),
    "一路發 · 選號費 NT 480 元 · 順子"
  );
  assert.equal(
    formatNumberCopyLine(
      {
        number: "0905123456",
        fee: 480,
        feeLabel: "選號費",
        bucket: "一路發",
        score: { reasons: ["順子"] }
      },
      { numberFormat: "spaced", detailMode: "annotated" }
    ),
    "0905 123 456｜一路發 · 選號費 NT 480 元 · 順子"
  );
  assert.equal(
    formatNumberCopyList(["0905123456", { number: "0912661188" }], "spaced"),
    "0905 123 456\n0912 661 188"
  );
  assert.equal(
    formatNumberCopyList(
      [
        {
          number: "0905123456",
          fee: 480,
          feeLabel: "選號費",
          bucket: "一路發",
          score: { reasons: ["順子"] }
        }
      ],
      { numberFormat: "plain", detailMode: "annotated" }
    ),
    "0905123456｜一路發 · 選號費 NT 480 元 · 順子"
  );
  assert.equal(
    formatNumberCopyLine(
      {
        number: "0905123456",
        fee: 480,
        feeLabel: "選號費",
        bucket: "一路發",
        score: { reasons: ["順子"] }
      },
      { numberFormat: "spaced", detailMode: "line" }
    ),
    "0905 123 456\n一路發 · 選號費 NT 480 元 · 順子"
  );
  assert.equal(
    buildCompactRowNote(
      {
        number: "0905123456",
        fee: 480,
        feeLabel: "選號費",
        bucket: "一路發",
        score: { reasons: ["順子", "好記"] }
      }
    ),
    "一路發 · 順子"
  );
  assert.equal(
    buildCompactRowNote(
      {
        number: "0912661188",
        fee: 480,
        feeLabel: "選號費"
      }
    ),
    "選號費 480元"
  );
  assert.equal(
    formatNumberCopyList(
      [
        {
          number: "0905123456",
          fee: 480,
          feeLabel: "選號費",
          bucket: "一路發",
          score: { reasons: ["順子"] }
        },
        {
          number: "0912661188",
          fee: 0,
          feeLabel: "選號費",
          score: { reasons: ["豹子"] }
        }
      ],
      { numberFormat: "spaced", detailMode: "line" }
    ),
    "0905 123 456\n一路發 · 選號費 NT 480 元 · 順子\n\n0912 661 188\n選號費 NT 0 元 · 豹子"
  );
  assert.equal(
    formatNumberCopyLine(
      {
        number: "0905123456",
        fee: 480,
        feeLabel: "選號費",
        bucket: "一路發",
        score: { reasons: ["順子"] }
      },
      { numberFormat: "spaced", detailMode: "line-compact" }
    ),
    "0905 123 456｜一路發 · 順子"
  );
  assert.equal(
    formatNumberCopyList(
      [
        {
          number: "0905123456",
          fee: 480,
          feeLabel: "選號費",
          bucket: "一路發",
          score: { reasons: ["順子"] }
        },
        {
          number: "0912661188",
          fee: 0,
          feeLabel: "選號費",
          score: { reasons: ["豹子"] }
        },
        {
          number: "0928123123",
          fee: 480,
          feeLabel: "選號費"
        }
      ],
      { numberFormat: "spaced", detailMode: "line-compact" }
    ),
    "0905 123 456｜一路發 · 順子\n0912 661 188｜豹子\n0928 123 123｜選號費 480元"
  );
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

test("shortlist helpers normalize rows and preserve richer metadata", () => {
  assert.deepEqual(normalizeShortlistRow("0905 123 456"), {
    number: "0905123456",
    fee: null,
    feeLabel: null,
    bucket: null,
    score: null,
    statusUrl: null
  });

  assert.equal(normalizeShortlistRow("12345"), null);

  assert.deepEqual(
    normalizeShortlistRows([
      { number: "0905123456", fee: "480", feeLabel: "選號費", bucket: "一路發", score: { value: "8", reasons: ["順子"] } },
      "0905-123-456",
      { number: "0905987654", statusUrl: "https://example.com/status" }
    ]),
    [
      {
        number: "0905123456",
        fee: 480,
        feeLabel: "選號費",
        bucket: "一路發",
        score: { value: 8, reasons: ["順子"] },
        statusUrl: null
      },
      {
        number: "0905987654",
        fee: null,
        feeLabel: null,
        bucket: null,
        score: null,
        statusUrl: "https://example.com/status"
      }
    ]
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

test("share summary helpers describe shortlist prefixes and query conditions", () => {
  const rows = [
    { number: "0905123456" },
    { number: "0912661188" },
    { number: "0928123123" },
    { number: "0937123123" }
  ];

  assert.deepEqual(summarizePrefixes(rows), {
    prefixes: ["0905", "0912", "0928", "0937"],
    shown: ["0905", "0912", "0928"],
    extra: 1
  });

  assert.deepEqual(
    buildShareSummary(
      {
        prefix: "0912",
        mode: "pattern",
        pattern: "66??88",
        fee: "480",
        pageLimit: "3",
        filters: ["5", "6", "9"]
      },
      rows,
      {
        filterOptions: [
          { value: "5", label: "第5碼不含4" },
          { value: "6", label: "第6碼不含4" },
          { value: "9", label: "第9碼不含4" }
        ]
      }
    ),
    ["4筆待選", "待選 0905 / 0912 / 0928 +1", "查詢 0912", "後六碼 66xx88", "3頁", "第5碼不含4 / 第6碼不含4 +1"]
  );

  assert.deepEqual(
    buildShareSummaryItems(
      {
        prefix: "0912",
        mode: "pattern",
        pattern: "66??88",
        fee: "480",
        pageLimit: "3",
        filters: ["5", "6", "9"]
      },
      rows,
      {
        filterOptions: [
          { value: "5", label: "第5碼不含4" },
          { value: "6", label: "第6碼不含4" },
          { value: "9", label: "第9碼不含4" }
        ]
      }
    ),
    [
      { label: "4筆待選", copyText: "0905123456\n0912661188\n0928123123\n0937123123" },
      { label: "待選 0905 / 0912 / 0928 +1", copyText: "0905\n0912\n0928\n0937" },
      { label: "查詢 0912", copyText: "0912" },
      { label: "後六碼 66xx88", copyText: "66xx88" },
      { label: "3頁", copyText: "3" },
      { label: "第5碼不含4 / 第6碼不含4 +1", copyText: "第5碼不含4\n第6碼不含4\n第9碼不含4" }
    ]
  );

  assert.deepEqual(
    buildShareSummaryItems(
      {
        prefix: "0912",
        mode: "pattern",
        pattern: "66??88",
        pageLimit: "3",
        filters: []
      },
      rows,
      {
        numberFormat: "spaced"
      }
    )[0],
    { label: "4筆待選", copyText: "0905 123 456\n0912 661 188\n0928 123 123\n0937 123 123" }
  );

  assert.deepEqual(
    buildShareSummaryItems(
      {
        prefix: "0912",
        mode: "pattern",
        pattern: "66??88",
        pageLimit: "3",
        filters: []
      },
      [
        { number: "0905123456", fee: 480, feeLabel: "選號費", bucket: "一路發", score: { reasons: ["順子"] } },
        { number: "0912661188", fee: 0, feeLabel: "選號費", score: { reasons: ["豹子"] } }
      ],
      {
        numberFormat: "plain",
        detailMode: "annotated"
      }
    )[0],
    {
      label: "2筆待選",
      copyText: "0905123456｜一路發 · 選號費 NT 480 元 · 順子\n0912661188｜選號費 NT 0 元 · 豹子"
    }
  );

  assert.deepEqual(
    buildShareSummaryItems(
      {
        prefix: "0912",
        mode: "pattern",
        pattern: "66??88",
        pageLimit: "3",
        filters: []
      },
      [
        { number: "0905123456", fee: 480, feeLabel: "選號費", bucket: "一路發", score: { reasons: ["順子"] } },
        { number: "0912661188", fee: 0, feeLabel: "選號費", score: { reasons: ["豹子"] } }
      ],
      {
        numberFormat: "spaced",
        detailMode: "line"
      }
    )[0],
    {
      label: "2筆待選",
      copyText: "0905 123 456\n一路發 · 選號費 NT 480 元 · 順子\n\n0912 661 188\n選號費 NT 0 元 · 豹子"
    }
  );

  assert.deepEqual(
    buildShareSummaryItems(
      {
        prefix: "0912",
        mode: "pattern",
        pattern: "66??88",
        pageLimit: "3",
        filters: []
      },
      [
        { number: "0905123456", fee: 480, feeLabel: "選號費", bucket: "一路發", score: { reasons: ["順子"] } },
        { number: "0912661188", fee: 0, feeLabel: "選號費", score: { reasons: ["豹子"] } },
        { number: "0928123123", fee: 480, feeLabel: "選號費" }
      ],
      {
        numberFormat: "spaced",
        detailMode: "line-compact"
      }
    )[0],
    {
      label: "3筆待選",
      copyText: "0905 123 456｜一路發 · 順子\n0912 661 188｜豹子\n0928 123 123｜選號費 480元"
    }
  );

  assert.deepEqual(
    buildShareSummary(
      {
        prefix: "0912",
        mode: "all",
        pageLimit: "1",
        filters: []
      },
      [{ number: "0912661188" }]
    ),
    ["1筆待選", "查詢 0912", "查詢 不拘", "1頁"]
  );

  assert.deepEqual(
    buildShareSummary(
      {
        prefix: "all09",
        mode: "suffix",
        pattern: "1234",
        pageLimit: "1",
        filters: ["5"]
      },
      rows,
      {
        prefixOptions: [
          { value: "0905", label: "0905" },
          { value: "0912", label: "0912" },
          { value: "all09", label: "全部09" }
        ],
        filterOptions: [{ value: "5", label: "第5碼不含4" }]
      }
    ),
    ["4筆待選", "待選 0905 / 0912 / 0928 +1", "查詢 全部09", "尾數 1234", "1頁", "第5碼不含4"]
  );

  assert.deepEqual(buildShareSummary(null, rows), ["4筆待選", "待選 0905 / 0912 / 0928 +1"]);
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

test("normalizeSearchDraft keeps allowed choices and restores safe defaults", () => {
  const draft = normalizeSearchDraft(
    {
      prefix: "0912",
      mode: "pattern",
      pattern: "58??58abc",
      fee: "1000",
      pageLimit: "5",
      filters: ["f5", "f5", "f9", "bad"]
    },
    {
      prefixes: ["0900", "0912"],
      modes: ["all", "pattern", "fee"],
      fees: ["480", "1000"],
      pageLimits: ["1", "3", "5"],
      filters: ["f5", "f9"]
    }
  );

  assert.deepEqual(draft, {
    prefix: "0912",
    mode: "pattern",
    pattern: "58xx58",
    fee: "1000",
    pageLimit: "5",
    filters: ["f5", "f9"]
  });

  assert.deepEqual(
    normalizeSearchDraft(
      {
        prefix: "0999",
        mode: "weird",
        pattern: "ABC??",
        fee: "9999",
        pageLimit: "88",
        filters: ["unknown"]
      },
      {
        prefixes: ["0900", "0912"],
        modes: ["all", "pattern", "fee"],
        fees: ["480", "1000"],
        pageLimits: ["1", "3", "5"],
        filters: ["f5", "f9"]
      }
    ),
    {
      prefix: "0900",
      mode: "all",
      pattern: "xx",
      fee: "480",
      pageLimit: "1",
      filters: []
    }
  );

  assert.deepEqual(
    normalizeSearchDraft(
      {
        prefix: "all09",
        mode: "suffix",
        pattern: "12-34x",
        fee: "480",
        pageLimit: "3",
        filters: ["f9"]
      },
      {
        prefixes: ["0900", "0912", "all09"],
        modes: ["all", "pattern", "suffix", "fee"],
        fees: ["480", "1000"],
        pageLimits: ["1", "3", "5"],
        filters: ["f5", "f9"]
      }
    ),
    {
      prefix: "all09",
      mode: "suffix",
      pattern: "1234",
      fee: "480",
      pageLimit: "3",
      filters: ["f9"]
    }
  );

  assert.deepEqual(
    normalizeSearchDraft(null, {
      prefixes: ["0900", "0912", "all09"],
      modes: ["all", "pattern", "suffix", "fee"],
      fees: ["480", "1000"],
      pageLimits: ["1", "3", "5"],
      filters: ["f5", "f9"]
    }),
    {
      prefix: "0900",
      mode: "all",
      pattern: "",
      fee: "480",
      pageLimit: "1",
      filters: []
    }
  );
});

test("search share helpers round-trip a normalized draft through URL payloads", () => {
  const options = {
    prefixes: ["0900", "0912"],
    modes: ["all", "pattern", "fee"],
    fees: ["480", "1000"],
    pageLimits: ["1", "3", "5"],
    filters: ["5", "6", "9"]
  };
  const draft = {
    prefix: "0912",
    mode: "pattern",
    pattern: "66??88",
    fee: "1000",
    pageLimit: "3",
    filters: ["5", "9"]
  };

  const encoded = encodeSearchShare(draft, options);
  assert.deepEqual(decodeSearchShare(encoded, options), {
    prefix: "0912",
    mode: "pattern",
    pattern: "66xx88",
    fee: "1000",
    pageLimit: "3",
    filters: ["5", "9"]
  });

  const shareUrl = buildSearchShareUrl(
    draft,
    "https://cht-number-picker.pages.dev/?foo=1&ws=old&sl=old",
    options
  );
  assert.match(shareUrl, /[?&]sd=/);
  assert.equal(shareUrl.includes("ws="), false);
  assert.equal(shareUrl.includes("sl="), false);
  assert.deepEqual(readSearchShareFromUrl(shareUrl, options), {
    prefix: "0912",
    mode: "pattern",
    pattern: "66xx88",
    fee: "1000",
    pageLimit: "3",
    filters: ["5", "9"]
  });
  assert.equal(stripSearchShareParam(shareUrl), "/?foo=1");

  assert.equal(decodeSearchShare("bad-payload", options), null);

  const suffixOptions = {
    prefixes: ["0900", "0912", "all09"],
    modes: ["all", "pattern", "suffix", "fee"],
    fees: ["480", "1000"],
    pageLimits: ["1", "3", "5"],
    filters: ["5", "6", "9"]
  };
  const suffixDraft = {
    prefix: "all09",
    mode: "suffix",
    pattern: "1234",
    fee: "480",
    pageLimit: "1",
    filters: ["5"]
  };
  assert.deepEqual(decodeSearchShare(encodeSearchShare(suffixDraft, suffixOptions), suffixOptions), suffixDraft);
});

test("workspace share helpers round-trip both search draft and shortlist rows", () => {
  const options = {
    prefixes: ["0900", "0912"],
    modes: ["all", "pattern", "fee"],
    fees: ["480", "1000"],
    pageLimits: ["1", "3", "5"],
    filters: ["5", "6", "9"]
  };
  const draft = {
    prefix: "0912",
    mode: "pattern",
    pattern: "66??88",
    fee: "480",
    pageLimit: "3",
    filters: ["5"]
  };
  const rows = [
    {
      number: "0905123456",
      fee: 480,
      feeLabel: "選號費",
      bucket: "一路發",
      score: { value: 8, reasons: [] },
      statusUrl: "/official/mbms/NewApply/findAvailableReal.jsp?telnum=token123&region=2&t=123"
    }
  ];

  const encoded = encodeWorkspaceShare(draft, rows, options);
  const decoded = decodeWorkspaceShare(encoded, options);
  assert.deepEqual(decoded.draft, {
    prefix: "0912",
    mode: "pattern",
    pattern: "66xx88",
    fee: "480",
    pageLimit: "3",
    filters: ["5"]
  });
  assert.equal(decoded.rows.length, 1);
  assert.equal(decoded.rows[0].number, "0905123456");
  assert.equal(decoded.rows[0].fee, 480);
  assert.equal(decoded.rows[0].feeLabel, "選號費");
  assert.equal(decoded.rows[0].bucket, "一路發");
  assert.deepEqual(decoded.rows[0].score, { value: 8, reasons: [] });
  assert.match(decoded.rows[0].statusUrl || "", /telnum=token123/);
  assert.match(decoded.rows[0].statusUrl || "", /region=2/);

  const shareUrl = buildWorkspaceShareUrl(
    draft,
    rows,
    "https://cht-number-picker.pages.dev/?foo=1&sd=old&sl=old",
    options
  );
  assert.match(shareUrl, /[?&]ws=/);
  assert.equal(shareUrl.includes("sd="), false);
  assert.equal(shareUrl.includes("sl="), false);
  const parsedFromUrl = readWorkspaceShareFromUrl(shareUrl, options);
  assert.deepEqual(parsedFromUrl.draft, decoded.draft);
  assert.equal(parsedFromUrl.rows[0].number, "0905123456");
  assert.match(parsedFromUrl.rows[0].statusUrl || "", /telnum=token123/);
  assert.equal(stripWorkspaceShareParam(shareUrl), "/?foo=1");
  assert.equal(decodeWorkspaceShare("bad-workspace", options), null);
});

test("workspace share decoder keeps legacy object payloads working", () => {
  const options = {
    prefixes: ["0900", "0912"],
    modes: ["all", "pattern", "fee"],
    fees: ["480", "1000"],
    pageLimits: ["1", "3", "5"],
    filters: ["5", "6", "9"]
  };
  const legacyPayload = toBase64Url(
    JSON.stringify({
      v: 1,
      d: { p: "0912", m: "pattern", t: "66??88", f: "480", l: "3", x: ["5"] },
      r: [
        {
          n: "0905123456",
          f: 480,
          l: "選號費",
          b: "一路發",
          s: [8, ["順子"]],
          u: "https://example.com/status/1"
        }
      ]
    })
  );

  assert.deepEqual(decodeWorkspaceShare(legacyPayload, options), {
    draft: {
      prefix: "0912",
      mode: "pattern",
      pattern: "66xx88",
      fee: "480",
      pageLimit: "3",
      filters: ["5"]
    },
    rows: normalizeShortlistRows([
      {
        number: "0905123456",
        fee: 480,
        feeLabel: "選號費",
        bucket: "一路發",
        score: { value: 8, reasons: ["順子"] },
        statusUrl: "https://example.com/status/1"
      }
    ])
  });
});

test("shortlist import/export helpers support json payloads and plain text lists", () => {
  const exported = buildShortlistExport([
    { number: "0905123456", fee: 480, score: { value: 8, reasons: ["順子"] } }
  ], "2026-04-26T02:00:00.000Z");

  assert.match(exported, /"exportedAt": "2026-04-26T02:00:00.000Z"/);

  assert.deepEqual(parseShortlistImport(exported), [
    {
      number: "0905123456",
      fee: 480,
      feeLabel: null,
      bucket: null,
      score: { value: 8, reasons: ["順子"] },
      statusUrl: null
    }
  ]);

  assert.deepEqual(parseShortlistImport("0905 123 456\n0905-987-654\n0905 123 456"), [
    {
      number: "0905123456",
      fee: null,
      feeLabel: null,
      bucket: null,
      score: null,
      statusUrl: null
    },
    {
      number: "0905987654",
      fee: null,
      feeLabel: null,
      bucket: null,
      score: null,
      statusUrl: null
    }
  ]);

  assert.deepEqual(
    mergeShortlistRows(
      [{ number: "0905000001", fee: 480 }],
      [
        { number: "0905111111", fee: 1000 },
        { number: "0905000001", fee: 480 }
      ]
    ).map((row) => row.number),
    ["0905111111", "0905000001"]
  );
});

test("shortlist share helpers round-trip rows through a compact URL payload", () => {
  const rows = [
    {
      number: "0912111222",
      fee: 480,
      feeLabel: "選號費",
      bucket: "一路發",
      score: { value: 9, reasons: [] },
      statusUrl: "https://example.com/status/1"
    },
    {
      number: "0905987654",
      fee: null,
      feeLabel: null,
      bucket: null,
      score: null,
      statusUrl: null
    }
  ];

  const encoded = encodeShortlistShare(rows);
  const decoded = decodeShortlistShare(encoded);
  assert.deepEqual(decoded, normalizeShortlistRows(rows));

  const shareUrl = buildShortlistShareUrl(
    rows,
    "https://cht-number-picker.pages.dev/?foo=1&ws=old&sd=old"
  );
  assert.match(shareUrl, /[?&]sl=/);
  assert.equal(shareUrl.includes("ws="), false);
  assert.equal(shareUrl.includes("sd="), false);
  assert.deepEqual(readShortlistShareFromUrl(shareUrl), normalizeShortlistRows(rows));
  assert.equal(stripShortlistShareParam(shareUrl), "/?foo=1");

  assert.deepEqual(decodeShortlistShare("not-valid"), []);
});
