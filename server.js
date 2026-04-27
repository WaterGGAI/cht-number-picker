const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { readFile } = require("node:fs/promises");
const chtCore = require("./lib/cht-core.cjs");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");

const SESSION_TTL_MS = 30 * 60 * 1000;
const LOCAL_SESSION_COOKIE = "cht_local_session";
const {
  CHT_ORIGIN,
  CHT_ENTRY_URL,
  CHT_SEARCH_URL,
  USER_AGENT,
  PREFIXES,
  FILTERS,
  CATEGORY_FEEDS,
  QUICK_LINKS,
  decodeBig5,
  dedupeRows,
  parseChtResponse,
  parseCategoryResponse,
  validateSearch,
  attachStatusUrls,
  getCharset,
  isTextContent,
  rewriteLocation,
  rewriteOfficialHtml,
  runSearchQuery,
  runCategoryFeed,
  runSearchPageFetch
} = chtCore;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
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
    const location = rewriteLocation(upstream.headers.get("location"), `/official/${sessionId}`);
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
    ? rewriteOfficialHtml(text, `/official/${sessionId}`)
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
    const upstream = await runCategoryFeed(category, {
      createStore: createSession,
      storeSetCookies,
      getCookieHeader: getSessionCookieHeader
    });
    const parsed = parseCategoryResponse(upstream.html, category);
    parsed.rows = attachStatusUrls(parsed.rows, `/official/${upstream.store.id}`);

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
        "Set-Cookie": serializeLocalSessionCookie(upstream.store.id)
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
    const upstream = await runSearchQuery(input, {
      createStore: createSession,
      storeSetCookies,
      getCookieHeader: getSessionCookieHeader
    });
    const parsed = parseChtResponse(upstream.html);
    let loadedPages;
    let pageRows;
    const officialPrefix = `/official/${upstream.store.id}`;

    if (upstream.reverseSuffix) {
      const rows = dedupeRows(
        upstream.pages.flatMap(({ html }) => parseChtResponse(html).rows)
      );
      parsed.rows = attachStatusUrls(rows, officialPrefix);
      parsed.pagination = { pages: [1], pageCount: 1 };
      parsed.status = parsed.rows.length ? "ok" : "empty";
      parsed.message = parsed.rows.length
        ? `找到 ${parsed.rows.length} 筆門號 · 尾數 ${input.pattern} 已掃 ${upstream.reverseSuffix.prefixes.length} 個前綴`
        : `沒有找到符合尾數 ${input.pattern} 的空號`;
      if (upstream.reverseSuffix.forcedFirstPage) {
        parsed.message += " · 後兩碼先抓每個前綴第 1 頁";
      }
      loadedPages = [1];
      pageRows = { 1: parsed.rows };
    } else if (upstream.expandedPattern) {
      const rows = dedupeRows(
        upstream.pages.flatMap(({ html }) => parseChtResponse(html).rows)
      );
      parsed.rows = attachStatusUrls(rows, officialPrefix);
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
        return [page, attachStatusUrls(pageParsed.rows, officialPrefix)];
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
        reverseSuffix: upstream.reverseSuffix,
        expandedPattern: upstream.expandedPattern,
        sessionTtlMinutes: Math.round(SESSION_TTL_MS / 60_000),
        upstreamStatus: upstream.upstreamStatus,
        officialUrl: CHT_ENTRY_URL,
        ...parsed
      },
      {
        "Set-Cookie": serializeLocalSessionCookie(upstream.store.id)
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
    const upstream = await runSearchPageFetch(page, session, {
      storeSetCookies,
      getCookieHeader: getSessionCookieHeader
    });
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
