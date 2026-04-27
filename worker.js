import chtCore from "./lib/cht-core.cjs";

const SESSION_COOKIE = "cht_upstream";
const SESSION_TTL_SECONDS = 30 * 60;
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

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request);
      }

      if (url.pathname.startsWith("/official/")) {
        return await handleOfficialProxy(request);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      return jsonResponse(
        { error: error?.message || "伺服器發生錯誤。" },
        { status: error?.statusCode || 500 }
      );
    }
  }
};

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function textResponse(text, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", headers.get("Content-Type") || "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(text, { ...init, headers });
}

async function readJson(request) {
  const raw = await request.text();
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

  if (typeof headers.getAll === "function") {
    try {
      return headers.getAll("Set-Cookie");
    } catch {}
  }

  const header = headers.get("set-cookie");
  if (!header) return [];
  return header.split(/,(?=\s*[^;,]+=)/g).map((cookie) => cookie.trim());
}

function storeSetCookies(jar, headers) {
  getSetCookies(headers).forEach((cookie) => {
    const pair = cookie.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  });
}

function buildCookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function parseRequestCookies(request) {
  const header = request.headers.get("cookie") || "";
  return header.split(/;\s*/).reduce((cookies, part) => {
    if (!part) return cookies;
    const eq = part.indexOf("=");
    if (eq === -1) return cookies;
    cookies.set(part.slice(0, eq), part.slice(eq + 1));
    return cookies;
  }, new Map());
}

function toBase64Url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + pad);
}

function serializeSessionCookie(jar) {
  const payload = toBase64Url(JSON.stringify(Object.fromEntries(jar.entries())));
  return `${SESSION_COOKIE}=${payload}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function readSessionJar(request) {
  const cookies = parseRequestCookies(request);
  const encoded = cookies.get(SESSION_COOKIE);
  if (!encoded) return null;

  try {
    return new Map(Object.entries(JSON.parse(fromBase64Url(encoded))));
  } catch {
    return null;
  }
}

async function handleApi(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse({
      ok: true,
      runtime: "cloudflare-worker",
      timestamp: new Date().toISOString()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return jsonResponse({
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
  }

  if (request.method === "GET" && url.pathname === "/api/category") {
    const category = CATEGORY_FEEDS.get(url.searchParams.get("type") || "");
    if (!category) {
      return jsonResponse({ error: "找不到分類。" }, { status: 404 });
    }

    const startedAt = Date.now();
    const upstream = await runCategoryFeed(category, {
      createStore: () => new Map(),
      storeSetCookies,
      getCookieHeader: buildCookieHeader
    });
    const parsed = parseCategoryResponse(upstream.html, category);
    parsed.rows = attachStatusUrls(parsed.rows, "/official");

    return jsonResponse(
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
        headers: {
          "Set-Cookie": serializeSessionCookie(upstream.store)
        }
      }
    );
  }

  if (request.method === "POST" && url.pathname === "/api/search") {
    const body = await readJson(request);
    const input = validateSearch(body);
    if (input.errors.length) {
      return jsonResponse({ errors: input.errors }, { status: 400 });
    }

    const startedAt = Date.now();
    const upstream = await runSearchQuery(input, {
      createStore: () => new Map(),
      storeSetCookies,
      getCookieHeader: buildCookieHeader
    });
    const parsed = parseChtResponse(upstream.html);
    let loadedPages;
    let pageRows;
    const officialPrefix = "/official";

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
      parsed.rows = attachStatusUrls(rows, "/official");
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
        return [page, attachStatusUrls(pageParsed.rows, "/official")];
      });
      pageRows = Object.fromEntries(pageEntries);
      parsed.rows = dedupeRows(pageEntries.flatMap(([, rows]) => rows));
      parsed.message = parsed.rows.length ? `找到 ${parsed.rows.length} 筆門號` : parsed.message;
      loadedPages = upstream.pages.map(({ page }) => page);
    }

    return jsonResponse(
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
        sessionTtlMinutes: Math.round(SESSION_TTL_SECONDS / 60),
        upstreamStatus: upstream.upstreamStatus,
        officialUrl: CHT_ENTRY_URL,
        ...parsed
      },
      {
        headers: {
          "Set-Cookie": serializeSessionCookie(upstream.store)
        }
      }
    );
  }

  if (request.method === "GET" && url.pathname === "/api/search-page") {
    const page = Number(url.searchParams.get("page") || "1");
    if (!Number.isInteger(page) || page < 1) {
      return jsonResponse({ error: "頁碼不正確。" }, { status: 400 });
    }

    const jar = readSessionJar(request);
    if (!jar || jar.size === 0) {
      return jsonResponse({ error: "查詢 session 已過期，請重新查詢。" }, { status: 410 });
    }

    const startedAt = Date.now();
    const upstream = await runSearchPageFetch(page, jar, {
      storeSetCookies,
      getCookieHeader: buildCookieHeader
    });
    const parsed = parseChtResponse(upstream.html);
    parsed.rows = attachStatusUrls(parsed.rows, "/official");

    return jsonResponse(
      {
        currentPage: page,
        elapsedMs: Date.now() - startedAt,
        upstreamStatus: upstream.upstreamStatus,
        officialUrl: CHT_ENTRY_URL,
        ...parsed
      },
      {
        headers: {
          "Set-Cookie": serializeSessionCookie(upstream.store)
        }
      }
    );
  }

  return jsonResponse({ error: "找不到 API。" }, { status: 404 });
}

async function handleOfficialProxy(request) {
  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/official/, "");
  const jar = readSessionJar(request);
  if (!jar || jar.size === 0) {
    return textResponse("這次查詢的官方 session 已過期，請回到門號快選重新查詢。", {
      status: 410
    });
  }

  const upstreamUrl = `${CHT_ORIGIN}${upstreamPath}${url.search}`;
  const headers = new Headers({
    "User-Agent": USER_AGENT,
    Accept: request.headers.get("Accept") || "*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: CHT_SEARCH_URL,
    Cookie: buildCookieHeader(jar)
  });

  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    if (request.headers.get("content-type")) {
      headers.set("Content-Type", request.headers.get("content-type"));
    }
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    redirect: "manual",
    headers,
    body
  });
  storeSetCookies(jar, upstream.headers);

  if (upstream.status >= 300 && upstream.status < 400) {
    const responseHeaders = new Headers();
    const location = rewriteLocation(upstream.headers.get("location"), "/official");
    if (location) responseHeaders.set("Location", location);
    responseHeaders.append("Set-Cookie", serializeSessionCookie(jar));
    return new Response(null, {
      status: upstream.status,
      headers: responseHeaders
    });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const responseHeaders = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": contentType.replace(/charset=[^;]+/i, "charset=utf-8")
  });
  responseHeaders.append("Set-Cookie", serializeSessionCookie(jar));

  const buffer = await upstream.arrayBuffer();
  if (!isTextContent(contentType)) {
    return new Response(buffer, {
      status: upstream.status,
      headers: responseHeaders
    });
  }

  const charset = getCharset(contentType);
  let text;
  if (charset === "big5" || charset === "ms950" || /text\/html/i.test(contentType)) {
    text = decodeBig5(buffer);
  } else {
    text = new TextDecoder(charset || "utf-8").decode(buffer);
  }

  if (/text\/html/i.test(contentType)) {
    text = rewriteOfficialHtml(text, "/official");
  }

  return new Response(text, {
    status: upstream.status,
    headers: responseHeaders
  });
}
