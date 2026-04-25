const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { TextDecoder } = require("node:util");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");

const CHT_ORIGIN = "https://bms.cht.com.tw";
const CHT_ENTRY_URL = `${CHT_ORIGIN}/mbms/NewApply/findAvailable.jsp`;
const CHT_SEARCH_URL = `${CHT_ORIGIN}/mbms/NewApply/findAvailableProc.jsp`;
const SESSION_TTL_MS = 30 * 60 * 1000;
const LOCAL_SESSION_COOKIE = "cht_local_session";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PREFIXES = [
  "0900",
  "0905",
  "0912",
  "0919",
  "0928",
  "0933",
  "0965",
  "0966",
  "0975",
  "0978"
];

const FILTERS = new Map([
  ["5", "第5碼不含4"],
  ["6", "第6碼不含4"],
  ["7", "第7碼不含4"],
  ["8", "第8碼不含4"],
  ["9", "第9碼不含4"],
  ["10", "最後一碼不含4"]
]);

const CATEGORY_FEEDS = new Map([
  [
    "pattern",
    {
      id: "pattern",
      label: "主題門號",
      kind: "feed",
      description: "官方整理的 88、99、如意等主題號碼。",
      officialUrl: `${CHT_ORIGIN}/mbms/NewApply/number_area_proc.jsp?type=pattern`
    }
  ],
  [
    "preferential",
    {
      id: "preferential",
      label: "優惠門號",
      kind: "feed",
      description: "官方整理的優惠門號清單。",
      officialUrl: `${CHT_ORIGIN}/mbms/NewApply/number_area_proc.jsp?type=preferential`
    }
  ],
  [
    "choice",
    {
      id: "choice",
      label: "精選門號",
      kind: "feed",
      description: "官方精選門號，有空號時會直接整理在這裡。",
      officialUrl: `${CHT_ORIGIN}/mbms/NewApply/number_area_proc.jsp?type=choice`
    }
  ],
  [
    "golden",
    {
      id: "golden",
      label: "黃金門號",
      kind: "feed",
      description: "官方黃金門號與成交價整理。",
      officialUrl: `${CHT_ORIGIN}/mbms/NewApply/number_area_proc.jsp?type=golden`
    }
  ]
]);

const QUICK_LINKS = [
  {
    id: "free",
    label: "免費幸運門號",
    kind: "search",
    description: "自由查前四碼、後六碼、特殊號碼費與不含 4。",
    officialUrl: CHT_ENTRY_URL
  },
  CATEGORY_FEEDS.get("pattern"),
  CATEGORY_FEEDS.get("preferential"),
  CATEGORY_FEEDS.get("choice"),
  {
    id: "bid",
    label: "門號競標",
    kind: "external",
    description: "另開官方門號競標頁。",
    officialUrl: `${CHT_ORIGIN}/mbms/mobbid/index.jsp`
  },
  CATEGORY_FEEDS.get("golden")
];

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

const sessions = new Map();

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, statusCode, text, type = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) {
      throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
    }
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("JSON 格式錯誤"), { statusCode: 400 });
  }
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const header = headers.get("set-cookie");
  if (!header) return [];
  return header.split(/,(?=\s*[^;,]+=)/g).map((cookie) => cookie.trim());
}

function buildCookieHeader(setCookies) {
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function parseRequestCookies(header = "") {
  return header.split(/;\s*/).reduce((cookies, part) => {
    if (!part) return cookies;
    const eq = part.indexOf("=");
    if (eq === -1) return cookies;
    cookies.set(part.slice(0, eq), part.slice(eq + 1));
    return cookies;
  }, new Map());
}

function serializeLocalSessionCookie(sessionId) {
  return `${LOCAL_SESSION_COOKIE}=${sessionId}; Max-Age=${Math.round(
    SESSION_TTL_MS / 1000
  )}; Path=/; HttpOnly; SameSite=Lax`;
}

function createSession() {
  cleanupSessions();
  const id = crypto.randomUUID();
  const session = {
    id,
    cookies: new Map(),
    createdAt: Date.now(),
    lastAccessAt: Date.now()
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  cleanupSessions();
  const session = sessions.get(id);
  if (!session) return null;
  session.lastAccessAt = Date.now();
  return session;
}

function cleanupSessions() {
  const expiresBefore = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.lastAccessAt < expiresBefore) {
      sessions.delete(id);
    }
  }
}

function storeSetCookies(session, headers) {
  getSetCookies(headers).forEach((cookie) => {
    const pair = cookie.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) session.cookies.set(name, value);
  });
}

function getSessionCookieHeader(session) {
  return [...session.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function decodeBig5(buffer) {
  return new TextDecoder("big5").decode(buffer);
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 16))
    );
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function makeRow({ number, fee = null, feeLabel = null, token = null, region = null, bucket = null }) {
  return {
    number,
    fee,
    feeLabel,
    token,
    region: region === "null" ? null : region,
    bucket,
    score: scoreNumber(number)
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.number || seen.has(row.number)) return false;
    seen.add(row.number);
    return true;
  });
}

function extractPricedTokenRows(html, feeLabel = "選號費") {
  const rows = [];
  const rowPattern =
    /openFile\('([^']+)','([^']*)'\)[\s\S]*?<\/a>\s*(09\d{8})[\s\S]*?NT\s*<span[^>]*>\s*<strong>\s*([0-9,]+)\s*<\/strong>/gi;

  let match;
  while ((match = rowPattern.exec(html))) {
    const [, token, region, number, fee] = match;
    rows.push(
      makeRow({
        number,
        fee: Number(fee.replace(/,/g, "")),
        feeLabel,
        token,
        region
      })
    );
  }

  return dedupeRows(rows);
}

function extractBucketedTokenRows(html) {
  const rows = [];
  const blockPattern =
    /<tr><td[^>]*bgcolor=#295fa0[^>]*class=style3[^>]*>\s*<div[^>]*align=center>\s*([^<]+?)\s*<\/div>\s*<\/td>\s*<\/tr>([\s\S]*?)(?=<tr><td[^>]*bgcolor=#295fa0[^>]*class=style3[^>]*>\s*<div[^>]*align=center>|$)/gi;
  const rowPattern = /openFile\('([^']+)','([^']*)'\)[\s\S]*?<\/a>\s*(09\d{8})/gi;

  let blockMatch;
  while ((blockMatch = blockPattern.exec(html))) {
    const [, bucket, sectionHtml] = blockMatch;
    if (bucket === "門號") continue;

    let rowMatch;
    while ((rowMatch = rowPattern.exec(sectionHtml))) {
      const [, token, region, number] = rowMatch;
      rows.push(
        makeRow({
          number,
          token,
          region,
          bucket: stripTags(bucket)
        })
      );
    }
  }

  return dedupeRows(rows);
}

function extractPlainPricedRows(html, feeLabel) {
  const rows = [];
  const rowPattern =
    /<tr><td[^>]*class=number[^>]*>\s*<div[^>]*align=center>\s*(09\d{8})\s*<\/div>\s*<\/td>\s*<td[^>]*class=style6[^>]*>[\s\S]*?<strong>\s*([0-9,]+)\s*<\/strong>/gi;

  let match;
  while ((match = rowPattern.exec(html))) {
    const [, number, fee] = match;
    rows.push(
      makeRow({
        number,
        fee: Number(fee.replace(/,/g, "")),
        feeLabel
      })
    );
  }

  return dedupeRows(rows);
}

function extractFallbackRows(html, extra = {}) {
  return dedupeRows(
    [...new Set(stripTags(html).match(/09\d{8}/g) || [])].map((number) =>
      makeRow({ number, ...extra })
    )
  );
}

function extractSearchRows(html) {
  const rows = extractPricedTokenRows(html);
  return rows.length ? rows : extractFallbackRows(html);
}

function extractCategoryRows(html, categoryId) {
  if (categoryId === "pattern") {
    const rows = extractBucketedTokenRows(html);
    return rows.length ? rows : extractFallbackRows(html);
  }

  if (categoryId === "preferential") {
    const rows = extractPricedTokenRows(html, "選號費");
    return rows.length ? rows : extractFallbackRows(html);
  }

  if (categoryId === "choice") {
    const pricedRows = extractPricedTokenRows(html, "選號費");
    if (pricedRows.length) return pricedRows;

    const bucketRows = extractBucketedTokenRows(html);
    return bucketRows.length ? bucketRows : [];
  }

  if (categoryId === "golden") {
    const pricedTokenRows = extractPricedTokenRows(html, "最後競標價");
    if (pricedTokenRows.length) return pricedTokenRows;

    const pricedRows = extractPlainPricedRows(html, "最後競標價");
    return pricedRows.length ? pricedRows : extractFallbackRows(html);
  }

  return [];
}

function scoreNumber(number) {
  const tail = number.slice(4);
  const digits = [...tail];
  let score = 0;
  const reasons = [];

  if (!tail.includes("4")) {
    score += 8;
    reasons.push("後六碼無4");
  }

  const repeats = tail.match(/(\d)\1+/g) || [];
  const longestRepeat = repeats.reduce((max, value) => Math.max(max, value.length), 0);
  if (longestRepeat >= 3) {
    score += longestRepeat * 3;
    reasons.push(`${longestRepeat}連號`);
  } else if (longestRepeat === 2) {
    score += 4;
    reasons.push("雙連");
  }

  for (let i = 0; i <= digits.length - 3; i += 1) {
    const a = Number(digits[i]);
    const b = Number(digits[i + 1]);
    const c = Number(digits[i + 2]);
    if (b === a + 1 && c === b + 1) {
      score += 5;
      reasons.push("順子");
      break;
    }
    if (b === a - 1 && c === b - 1) {
      score += 5;
      reasons.push("倒順");
      break;
    }
  }

  if (tail.slice(0, 3) === tail.slice(3)) {
    score += 10;
    reasons.push("前三後三重複");
  }

  if (tail.slice(0, 2) === tail.slice(2, 4) || tail.slice(2, 4) === tail.slice(4)) {
    score += 5;
    reasons.push("雙碼重複");
  }

  if (tail === [...tail].reverse().join("")) {
    score += 12;
    reasons.push("鏡像");
  }

  if (/168|888|999|666|520|1314/.test(tail)) {
    score += 8;
    reasons.push("常見好記尾碼");
  }

  return { value: score, reasons: [...new Set(reasons)] };
}

function extractMessages(html) {
  const messages = [];
  const bluePattern = /<font[^>]*color\s*=\s*["']?blue["']?[^>]*>([\s\S]*?)<\/font>/gi;

  let match;
  while ((match = bluePattern.exec(html))) {
    const text = stripTags(match[1]);
    if (text) messages.push(text);
  }

  if (!messages.length) {
    const text = stripTags(html);
    const response = text.match(/系統回應[:：]\s*([^。！!]+)/);
    if (response?.[1]) messages.push(response[1].trim());
  }

  return [...new Set(messages)];
}

function extractPagination(html) {
  const pageMatches = [...html.matchAll(/findAvailableRst\.jsp\?pageid=(\d+)/g)];
  const pages = [...new Set(pageMatches.map((match) => Number(match[1])))]
    .filter((page) => Number.isInteger(page))
    .sort((a, b) => a - b);
  return {
    pages,
    pageCount: pages.length ? Math.max(...pages) : 1
  };
}

function parseChtResponse(html) {
  const messages = extractMessages(html);
  const noResult = messages.some((message) => message.includes("查無符合"));
  const rows = noResult ? [] : extractSearchRows(html);
  const pagination = extractPagination(html);
  const text = stripTags(html);

  let status = "ok";
  if (noResult || rows.length === 0) status = "empty";
  if (/findAvailableProc\.jsp/.test(html) && !messages.length && rows.length === 0) {
    status = "form";
    messages.push("官方網站回傳查詢表單，這次查詢可能沒有被接受。");
  }

  return {
    status,
    message: messages[0] || (rows.length ? `找到 ${rows.length} 筆門號` : "沒有可顯示的門號"),
    messages,
    rows,
    pagination,
    textPreview: text.slice(0, 300)
  };
}

function parseCategoryResponse(html, category) {
  const messages = extractMessages(html);
  const noResult = messages.some((message) => message.includes("查無符合"));
  const rows = noResult ? [] : extractCategoryRows(html, category.id);
  const text = stripTags(html);

  return {
    status: noResult || rows.length === 0 ? "empty" : "ok",
    message:
      messages[0] ||
      (rows.length ? `找到 ${rows.length} 筆${category.label}` : `目前沒有可顯示的${category.label}`),
    messages,
    rows,
    textPreview: text.slice(0, 300)
  };
}

function attachStatusUrls(rows, sessionId) {
  return rows.map((row) => {
    if (!row.token) return row;
    const region = row.region || "null";
    return {
      ...row,
      statusUrl:
        `/official/${sessionId}/mbms/NewApply/findAvailableReal.jsp` +
        `?telnum=${row.token}&region=${region}&t=${Date.now()}`
    };
  });
}

function normalizeFilters(value) {
  const input = Array.isArray(value) ? value : [];
  return input
    .map((item) => String(item))
    .filter((item) => FILTERS.has(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort((a, b) => Number(a) - Number(b));
}

function normalizePatternInput(value) {
  return String(value || "")
    .trim()
    .replace(/[？?Ｘｘx]/gi, "?")
    .replace(/[^\d?]/g, "")
    .slice(0, 6);
}

function countPatternWildcards(pattern) {
  return [...pattern].filter((char) => char === "?").length;
}

function expandFourWildcardPattern(pattern) {
  const chars = [...pattern];
  const wildcardIndex = chars.findIndex((char) => char === "?");
  if (wildcardIndex === -1 || countPatternWildcards(pattern) !== 4) return [pattern];

  return Array.from({ length: 10 }, (_, digit) => {
    const variant = [...chars];
    variant[wildcardIndex] = String(digit);
    return variant.join("");
  });
}

function validateSearch(body) {
  const errors = [];
  const mode = String(body.mode || "all");
  const prefix = String(body.prefix || "");
  const pattern = normalizePatternInput(body.pattern);
  const fee = String(body.fee || "480");
  const requestedPageLimit = Number(body.pageLimit || 1);
  const pageLimit =
    Number.isInteger(requestedPageLimit) && requestedPageLimit > 0
      ? Math.min(requestedPageLimit, 5)
      : 1;
  const filters = normalizeFilters(body.filters);

  if (!PREFIXES.includes(prefix)) {
    errors.push("請選擇有效的前四碼。");
  }

  if (!["all", "pattern", "fee"].includes(mode)) {
    errors.push("查詢模式不正確。");
  }

  if (mode === "pattern") {
    if (!/^[0-9?]{6}$/.test(pattern)) {
      errors.push("後六碼需為 6 位數字或 x。");
    }
    const wildcardCount = countPatternWildcards(pattern);
    if (wildcardCount > 4) {
      errors.push("最多支援 4 個 x。");
    }
    filters.forEach((filter) => {
      const index = Number(filter) - 5;
      if (pattern[index] === "4") {
        errors.push(`${FILTERS.get(filter)} 和後六碼條件互斥。`);
      }
    });
  }

  if (mode === "fee" && !["480", "1000"].includes(fee)) {
    errors.push("特殊號碼費用不正確。");
  }

  return { errors, mode, prefix, pattern, fee, pageLimit, filters };
}

function buildChtParams(input) {
  const params = new URLSearchParams();
  params.set("servicetype", "K");
  params.set("head4G", input.prefix);
  params.set("search_type", input.mode);
  params.set("rb_search_type", input.mode);
  params.set("tel", input.mode === "pattern" ? input.pattern : "");
  params.set("selfee", input.fee);
  input.filters.forEach((filter) => params.append("filter", filter));
  params.set("x", "50");
  params.set("y", "12");
  return params;
}

async function searchCht(input) {
  const session = createSession();
  const entryResponse = await fetch(CHT_ENTRY_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  storeSetCookies(session, entryResponse.headers);
  await entryResponse.arrayBuffer();

  const wildcardCount = input.mode === "pattern" ? countPatternWildcards(input.pattern) : 0;
  const variants = wildcardCount === 4 ? expandFourWildcardPattern(input.pattern) : [input.pattern];
  const isExpandedPattern = variants.length > 1;
  const pages = [];
  let upstreamStatus = 200;
  let upstreamUrl = CHT_SEARCH_URL;

  for (const pattern of variants) {
    const variantInput = { ...input, pattern, pageLimit: isExpandedPattern ? 1 : input.pageLimit };
    const response = await fetch(CHT_SEARCH_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CHT_ORIGIN,
        Referer: CHT_ENTRY_URL,
        Cookie: getSessionCookieHeader(session)
      },
      body: buildChtParams(variantInput)
    });
    storeSetCookies(session, response.headers);
    upstreamStatus = response.status;
    upstreamUrl = response.url;

    const buffer = Buffer.from(await response.arrayBuffer());
    const firstHtml = decodeBig5(buffer);
    const firstPagination = extractPagination(firstHtml);
    const pagesToFetch = isExpandedPattern
      ? 1
      : Math.min(input.pageLimit, firstPagination.pageCount || 1);
    pages.push({
      page: isExpandedPattern ? pages.length + 1 : 1,
      html: firstHtml,
      upstreamStatus: response.status,
      pattern
    });

    for (let page = 2; page <= pagesToFetch; page += 1) {
      const pageResponse = await fetch(
        `${CHT_ORIGIN}/mbms/NewApply/findAvailableRst.jsp?pageid=${page}`,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            Referer: CHT_SEARCH_URL,
            Cookie: getSessionCookieHeader(session)
          }
        }
      );
      storeSetCookies(session, pageResponse.headers);
      pages.push({
        page,
        html: decodeBig5(Buffer.from(await pageResponse.arrayBuffer())),
        upstreamStatus: pageResponse.status,
        pattern
      });
    }
  }

  return {
    sessionId: session.id,
    html: pages.map((entry) => entry.html).join("\n"),
    pages,
    pagesFetched: pages.length,
    upstreamStatus,
    upstreamUrl,
    expandedPattern: isExpandedPattern
      ? {
          requested: input.pattern,
          variants
        }
      : null
  };
}

async function fetchCategoryFeed() {
  const session = createSession();
  return session;
}

async function loadCategoryFeed(category) {
  const session = await fetchCategoryFeed();
  const response = await fetch(category.officialUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: CHT_ENTRY_URL
    }
  });
  storeSetCookies(session, response.headers);

  return {
    sessionId: session.id,
    html: decodeBig5(Buffer.from(await response.arrayBuffer())),
    upstreamStatus: response.status
  };
}

async function fetchSearchPageBySession(session, page) {
  const response = await fetch(`${CHT_ORIGIN}/mbms/NewApply/findAvailableRst.jsp?pageid=${page}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: CHT_SEARCH_URL,
      Cookie: getSessionCookieHeader(session)
    }
  });
  storeSetCookies(session, response.headers);

  return {
    html: decodeBig5(Buffer.from(await response.arrayBuffer())),
    upstreamStatus: response.status
  };
}

function getCharset(contentType) {
  const match = contentType.match(/charset=([^;]+)/i);
  return match?.[1]?.trim().toLowerCase() || "";
}

function isTextContent(contentType) {
  return /text\/|javascript|json|xml/i.test(contentType);
}

function rewriteLocation(location, sessionId) {
  if (!location) return location;
  try {
    const target = new URL(location, CHT_ORIGIN);
    if (target.origin !== CHT_ORIGIN) return location;
    return `/official/${sessionId}${target.pathname}${target.search}`;
  } catch {
    return location;
  }
}

function rewriteOfficialHtml(html, sessionId) {
  const prefix = `/official/${sessionId}`;
  return html
    .replace(/charset\s*=\s*big5/gi, "charset=utf-8")
    .replace(/charset\s*=\s*Big5/g, "charset=utf-8")
    .replaceAll(`${CHT_ORIGIN}/mbms/`, `${prefix}/mbms/`)
    .replace(/(["'=]\s*)\/mbms\//g, `$1${prefix}/mbms/`)
    .replace(/(window\.open\(["'])((?!https?:|\/|javascript:)[^"']+)/g, `$1${prefix}/mbms/NewApply/$2`)
    .replace(/(location\.href\s*=\s*["'])((?!https?:|\/|javascript:)[^"']+)/g, `$1${prefix}/mbms/NewApply/$2`)
    .replace(/(src\s*=\s*["'])((?!https?:|\/|javascript:)[^"']+)/gi, `$1${prefix}/mbms/NewApply/$2`)
    .replace(/(href\s*=\s*["'])((?!https?:|\/|javascript:|#)[^"']+)/gi, `$1${prefix}/mbms/NewApply/$2`)
    .replace(/(action\s*=\s*["'])((?!https?:|\/|javascript:)[^"']+)/gi, `$1${prefix}/mbms/NewApply/$2`)
    .replace(
      /onclick="\$\('#F1'\)\.show\(\);\$\('#info'\)\.hide\(\);"/g,
      "onclick=\"document.getElementById('F1').style.display='';document.getElementById('info').style.display='none';\""
    )
    .replace(/<form([^>]*\bid=["']F1["'][^>]*)>/i, (match, attrs) => {
      if (/\bstyle\s*=/.test(attrs)) return match;
      return `<form${attrs} style="display:none">`;
    });
}

async function handleOfficialProxy(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const match = requestUrl.pathname.match(/^\/official\/([^/]+)\/(.+)$/);
  if (!match) {
    sendText(res, 404, "Not found");
    return;
  }

  const [, sessionId, upstreamPath] = match;
  const session = getSession(sessionId);
  if (!session) {
    sendText(
      res,
      410,
      "這次查詢的官方 session 已過期，請回到門號快選重新查詢。",
      "text/html; charset=utf-8"
    );
    return;
  }

  const upstreamUrl = `${CHT_ORIGIN}/${upstreamPath}${requestUrl.search}`;
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: req.headers.accept || "*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: CHT_SEARCH_URL,
    Cookie: getSessionCookieHeader(session)
  };

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
    if (req.headers["content-type"]) {
      headers["Content-Type"] = req.headers["content-type"];
    }
  }

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    redirect: "manual",
    headers,
    body
  });
  storeSetCookies(session, upstream.headers);

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = rewriteLocation(upstream.headers.get("location"), sessionId);
    res.writeHead(upstream.status, location ? { Location: location } : {});
    res.end();
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await upstream.arrayBuffer());

  if (!isTextContent(contentType)) {
    res.writeHead(upstream.status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(buffer);
    return;
  }

  const charset = getCharset(contentType);
  const text =
    charset === "big5" || charset === "ms950" || /text\/html/i.test(contentType)
      ? decodeBig5(buffer)
      : buffer.toString("utf8");
  const rewritten = /text\/html/i.test(contentType)
    ? rewriteOfficialHtml(text, sessionId)
    : text;

  res.writeHead(upstream.status, {
    "Content-Type": contentType.replace(/charset=[^;]+/i, "charset=utf-8"),
    "Cache-Control": "no-store"
  });
  res.end(rewritten);
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      runtime: "node",
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/config") {
    sendJson(res, 200, {
      prefixes: PREFIXES,
      filters: [...FILTERS.entries()].map(([value, label]) => ({ value, label })),
      quickLinks: QUICK_LINKS.map(({ id, label, kind, description, officialUrl }) => ({
        id,
        label,
        kind,
        description,
        officialUrl
      })),
      officialUrl: CHT_ENTRY_URL
    });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/category")) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const category = CATEGORY_FEEDS.get(requestUrl.searchParams.get("type") || "");
    if (!category) {
      sendJson(res, 404, { error: "找不到分類。" });
      return;
    }

    const startedAt = Date.now();
    const upstream = await loadCategoryFeed(category);
    const parsed = parseCategoryResponse(upstream.html, category);
    parsed.rows = attachStatusUrls(parsed.rows, upstream.sessionId);

    sendJson(
      res,
      200,
      {
        category: {
          id: category.id,
          label: category.label
        },
        elapsedMs: Date.now() - startedAt,
        upstreamStatus: upstream.upstreamStatus,
        officialUrl: category.officialUrl,
        ...parsed
      },
      {
        "Set-Cookie": serializeLocalSessionCookie(upstream.sessionId)
      }
    );
    return;
  }

  if (req.method === "POST" && req.url === "/api/search") {
    const body = await readJson(req);
    const input = validateSearch(body);

    if (input.errors.length) {
      sendJson(res, 400, { errors: input.errors });
      return;
    }

    const startedAt = Date.now();
    const upstream = await searchCht(input);
    const parsed = parseChtResponse(upstream.html);
    let loadedPages;
    let pageRows;

    if (upstream.expandedPattern) {
      const rows = dedupeRows(
        upstream.pages.flatMap(({ html }) => parseChtResponse(html).rows)
      );
      parsed.rows = attachStatusUrls(rows, upstream.sessionId);
      parsed.pagination = { pages: [1], pageCount: 1 };
      parsed.status = parsed.rows.length ? "ok" : "empty";
      parsed.message = parsed.rows.length
        ? `找到 ${parsed.rows.length} 筆門號 · 4 個 x 已拆成 10 組查詢`
        : "沒有找到符合的門號 · 4 個 x 已拆成 10 組查詢";
      loadedPages = [1];
      pageRows = { 1: parsed.rows };
    } else {
      const pageEntries = upstream.pages.map(({ page, html }) => {
        const pageParsed = parseChtResponse(html);
        return [page, attachStatusUrls(pageParsed.rows, upstream.sessionId)];
      });
      pageRows = Object.fromEntries(pageEntries);
      parsed.rows = dedupeRows(pageEntries.flatMap(([, rows]) => rows));
      parsed.message = parsed.rows.length ? `找到 ${parsed.rows.length} 筆門號` : parsed.message;
      loadedPages = upstream.pages.map(({ page }) => page);
    }

    sendJson(
      res,
      200,
      {
        query: {
          mode: input.mode,
          prefix: input.prefix,
          pattern: input.pattern,
          fee: input.fee,
          pageLimit: input.pageLimit,
          filters: input.filters
        },
        elapsedMs: Date.now() - startedAt,
        pagesFetched: upstream.pagesFetched,
        loadedPages,
        pageRows,
        expandedPattern: upstream.expandedPattern,
        sessionTtlMinutes: Math.round(SESSION_TTL_MS / 60_000),
        upstreamStatus: upstream.upstreamStatus,
        officialUrl: CHT_ENTRY_URL,
        ...parsed
      },
      {
        "Set-Cookie": serializeLocalSessionCookie(upstream.sessionId)
      }
    );
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/search-page")) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const page = Number(requestUrl.searchParams.get("page") || "1");
    if (!Number.isInteger(page) || page < 1) {
      sendJson(res, 400, { error: "頁碼不正確。" });
      return;
    }

    const cookies = parseRequestCookies(req.headers.cookie || "");
    const sessionId = cookies.get(LOCAL_SESSION_COOKIE);
    const session = sessionId ? getSession(sessionId) : null;
    if (!session) {
      sendJson(res, 410, { error: "查詢 session 已過期，請重新查詢。" });
      return;
    }

    const startedAt = Date.now();
    const upstream = await fetchSearchPageBySession(session, page);
    const parsed = parseChtResponse(upstream.html);
    parsed.rows = attachStatusUrls(parsed.rows, session.id);

    sendJson(
      res,
      200,
      {
        currentPage: page,
        elapsedMs: Date.now() - startedAt,
        upstreamStatus: upstream.upstreamStatus,
        officialUrl: CHT_ENTRY_URL,
        ...parsed
      },
      {
        "Set-Cookie": serializeLocalSessionCookie(session.id)
      }
    );
    return;
  }

  sendJson(res, 404, { error: "找不到 API。" });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    const type = MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, 404, "Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/official/")) {
      await handleOfficialProxy(req, res);
      return;
    }

    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      error: error.message || "伺服器發生錯誤。"
    });
  }
});

server.listen(PORT, () => {
  console.log(`CHT number picker is running at http://localhost:${PORT}`);
});
