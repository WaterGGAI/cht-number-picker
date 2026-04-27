import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import chtCore from "../lib/cht-core.cjs";

const {
  ALL_09_PREFIX,
  CATEGORY_FEEDS,
  PREFIXES,
  attachStatusUrls,
  parseCategoryResponse,
  parseChtResponse,
  rewriteLocation,
  rewriteOfficialHtml,
  runSearchQuery,
  validateSearch
} = chtCore;

const currentDir = path.dirname(fileURLToPath(import.meta.url));

async function readFixture(name) {
  return readFile(path.join(currentDir, "fixtures", name), "utf8");
}

function htmlResponse(html, init = {}) {
  return new Response(Buffer.from(html, "utf8"), init);
}

function storeSetCookies(store, headers) {
  const header = headers.get("set-cookie");
  if (!header) return;
  const pair = header.split(";")[0];
  const eq = pair.indexOf("=");
  if (eq === -1) return;
  store.set(pair.slice(0, eq), pair.slice(eq + 1));
}

function getCookieHeader(store) {
  return [...store.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

test("parseChtResponse parses priced rows and pagination from fixture", async () => {
  const html = await readFixture("search-results-page-1.html");
  const parsed = parseChtResponse(html);

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.message, "找到 20 筆門號");
  assert.deepEqual(parsed.pagination.pages, [1, 2, 3, 4, 5]);
  assert.equal(parsed.pagination.pageCount, 5);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].number, "0905123456");
  assert.equal(parsed.rows[0].fee, 480);
  assert.equal(parsed.rows[0].token, "token-alpha");
  assert.equal(parsed.rows[0].region, "north");
  assert.equal(parsed.rows[1].fee, 1000);
  assert.ok(parsed.rows[1].score.reasons.includes("常見好記尾碼"));
});

test("parseCategoryResponse keeps themed buckets from fixture", async () => {
  const html = await readFixture("category-pattern.html");
  const parsed = parseCategoryResponse(html, CATEGORY_FEEDS.get("pattern"));

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(
    parsed.rows.map((row) => row.bucket),
    ["一路發", "一路發", "步步高升"]
  );
  assert.equal(parsed.rows[0].token, "theme-168");
  assert.equal(parsed.rows[1].region, null);
});

test("parseChtResponse flags form fallback when official search bounces back to form", async () => {
  const html = await readFixture("search-form-response.html");
  const parsed = parseChtResponse(html);

  assert.equal(parsed.status, "form");
  assert.ok(parsed.messages.includes("官方網站回傳查詢表單，這次查詢可能沒有被接受。"));
  assert.equal(parsed.rows.length, 0);
});

test("validateSearch normalizes wildcard input and reports invalid combinations", () => {
  const normalized = validateSearch({
    mode: "pattern",
    prefix: "0905",
    pattern: "58xx58",
    pageLimit: 9,
    filters: ["7", "5", "7"]
  });

  assert.equal(normalized.pattern, "58??58");
  assert.equal(normalized.pageLimit, 5);
  assert.deepEqual(normalized.filters, ["5", "7"]);
  assert.deepEqual(normalized.errors, []);

  const invalid = validateSearch({
    mode: "pattern",
    prefix: "0905",
    pattern: "4xxxxx",
    filters: ["5"]
  });

  assert.ok(invalid.errors.includes("最多支援 4 個 x。"));
  assert.ok(invalid.errors.includes("第5碼不含4 和後六碼條件互斥。"));

  const suffix = validateSearch({
    mode: "suffix",
    prefix: "0905",
    pattern: "12-34",
    pageLimit: 3,
    filters: ["9", "9"]
  });

  assert.equal(suffix.prefix, ALL_09_PREFIX);
  assert.equal(suffix.pattern, "1234");
  assert.equal(suffix.pageLimit, 3);
  assert.deepEqual(suffix.filters, ["9"]);
  assert.deepEqual(suffix.errors, []);

  const invalidSuffix = validateSearch({
    mode: "suffix",
    pattern: "412345",
    filters: ["5"]
  });
  assert.ok(invalidSuffix.errors.includes("第5碼不含4 和尾數反查條件互斥。"));

  const badLengthSuffix = validateSearch({
    mode: "suffix",
    pattern: "123"
  });
  assert.ok(badLengthSuffix.errors.includes("尾數反查需輸入 2、4 或 6 位數字。"));
});

test("rewrite helpers preserve official flow under a custom prefix", () => {
  const location = rewriteLocation("/mbms/NewApply/findAvailableReal.jsp?tel=1", "/official/demo");
  assert.equal(location, "/official/demo/mbms/NewApply/findAvailableReal.jsp?tel=1");

  const html = rewriteOfficialHtml(
    '<a href="/mbms/NewApply/findAvailable.jsp">查詢</a><form id="F1" action="findAvailableProc.jsp"></form>',
    "/official/demo"
  );
  assert.match(html, /href="\/official\/demo\/mbms\/NewApply\/findAvailable\.jsp"/);
  assert.match(html, /action="\/official\/demo\/mbms\/NewApply\/findAvailableProc\.jsp"/);
  assert.match(html, /style="display:none"/);

  const rows = attachStatusUrls(
    [{ number: "0905123456", token: "demo-token", region: null }],
    "/official/demo"
  );
  assert.match(rows[0].statusUrl, /^\/official\/demo\/mbms\/NewApply\/findAvailableReal\.jsp\?/);
  assert.match(rows[0].statusUrl, /telnum=demo-token/);
});

test("runSearchQuery expands four wildcards into ten upstream pattern searches", async (t) => {
  const firstPageHtml = await readFixture("search-results-page-1.html");
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/findAvailable.jsp")) {
      return htmlResponse("entry", {
        headers: { "set-cookie": "upstream=entry; Path=/; HttpOnly" }
      });
    }
    if (String(url).endsWith("/findAvailableProc.jsp")) {
      return htmlResponse(firstPageHtml, {
        status: 200,
        headers: { "set-cookie": "search=pattern; Path=/; HttpOnly" }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = validateSearch({
    mode: "pattern",
    prefix: "0905",
    pattern: "58xxxx",
    pageLimit: 5,
    filters: []
  });

  const result = await runSearchQuery(input, {
    createStore: () => new Map(),
    storeSetCookies,
    getCookieHeader
  });

  const postCalls = calls.filter((call) => call.url.endsWith("/findAvailableProc.jsp"));
  assert.equal(postCalls.length, 10);
  assert.equal(result.pagesFetched, 10);
  assert.deepEqual(result.expandedPattern.variants, [
    "580???",
    "581???",
    "582???",
    "583???",
    "584???",
    "585???",
    "586???",
    "587???",
    "588???",
    "589???"
  ]);
  assert.equal(calls.length, 11);
  assert.match(postCalls[0].options.body.toString(), /tel=580%3F%3F%3F/);
  assert.match(postCalls[9].options.body.toString(), /tel=589%3F%3F%3F/);
  assert.equal(postCalls[0].options.headers.Cookie, "upstream=entry");
});

test("runSearchQuery follows requested page limit and carries cookies across page fetches", async (t) => {
  const firstPageHtml = await readFixture("search-results-page-1.html");
  const secondPageHtml = await readFixture("search-results-page-2.html");
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/findAvailable.jsp")) {
      return htmlResponse("entry", {
        headers: { "set-cookie": "upstream=entry; Path=/; HttpOnly" }
      });
    }
    if (String(url).endsWith("/findAvailableProc.jsp")) {
      return htmlResponse(firstPageHtml, {
        headers: { "set-cookie": "search=first; Path=/; HttpOnly" }
      });
    }
    if (String(url).includes("pageid=2")) {
      return htmlResponse(secondPageHtml, {
        headers: { "set-cookie": "page2=ok; Path=/; HttpOnly" }
      });
    }
    if (String(url).includes("pageid=3")) {
      return htmlResponse(secondPageHtml);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = validateSearch({
    mode: "all",
    prefix: "0905",
    pageLimit: 3,
    filters: []
  });

  const result = await runSearchQuery(input, {
    createStore: () => new Map(),
    storeSetCookies,
    getCookieHeader
  });

  assert.equal(result.pagesFetched, 3);
  assert.equal(result.pages.length, 3);
  assert.equal(result.pages[1].page, 2);
  assert.equal(result.pages[2].page, 3);

  const pageCalls = calls.filter((call) => call.url.includes("findAvailableRst.jsp?pageid="));
  assert.deepEqual(
    pageCalls.map((call) => call.url.match(/pageid=(\d+)/)[1]),
    ["2", "3"]
  );
  assert.equal(pageCalls[0].options.headers.Cookie, "upstream=entry; search=first");
  assert.equal(pageCalls[1].options.headers.Cookie, "upstream=entry; search=first; page2=ok");
});

test("runSearchQuery fans out two-digit reverse suffix search across all official prefixes", async (t) => {
  const firstPageHtml = await readFixture("search-results-page-1.html");
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/findAvailable.jsp")) {
      return htmlResponse("entry", {
        headers: { "set-cookie": "upstream=entry; Path=/; HttpOnly" }
      });
    }
    if (String(url).endsWith("/findAvailableProc.jsp")) {
      return htmlResponse(firstPageHtml, {
        headers: { "set-cookie": "search=pattern; Path=/; HttpOnly" }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = validateSearch({
    mode: "suffix",
    pattern: "12",
    pageLimit: 5,
    filters: []
  });

  const result = await runSearchQuery(input, {
    createStore: () => new Map(),
    storeSetCookies,
    getCookieHeader
  });

  const entryCalls = calls.filter((call) => call.url.endsWith("/findAvailable.jsp"));
  const postCalls = calls.filter((call) => call.url.endsWith("/findAvailableProc.jsp"));
  assert.equal(entryCalls.length, PREFIXES.length + 1);
  assert.equal(postCalls.length, PREFIXES.length * 10);
  assert.equal(result.pagesFetched, PREFIXES.length * 10);
  assert.equal(result.pages.length, PREFIXES.length * 10);
  assert.equal(result.reverseSuffix.requested, "12");
  assert.equal(result.reverseSuffix.officialPattern, "????12");
  assert.equal(result.reverseSuffix.perPrefixPageLimit, 1);
  assert.equal(result.reverseSuffix.officialQueryCount, PREFIXES.length * 10);
  assert.equal(result.reverseSuffix.forcedFirstPage, true);
  assert.deepEqual(result.reverseSuffix.prefixes, PREFIXES);
  assert.match(postCalls[0].options.body.toString(), /head4G=0900/);
  assert.match(postCalls[0].options.body.toString(), /tel=0%3F%3F%3F12/);
  assert.match(postCalls[postCalls.length - 1].options.body.toString(), /head4G=0978/);
  assert.match(postCalls[postCalls.length - 1].options.body.toString(), /tel=9%3F%3F%3F12/);
});
