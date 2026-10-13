import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createProxyServer } from "httpxy";

const DEFAULT_PROXY_TIMEOUT_MS = 120_000;
const WEBGEN_ACTION_TIMEOUT_MS = 45 * 60 * 1_000;
const SERVER_INFO_PATH = "/server_info";
const BENIGN_SOCKET_ERRORS = new Set([
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

export function matchesPathPrefix(url, prefix) {
  return (
    url === prefix ||
    url.startsWith(prefix + "/") ||
    url.startsWith(prefix + "?")
  );
}

export function createRouter(routes, defaultBackend = null) {
  const sortedRoutes = Object.entries(routes).sort(
    ([a], [b]) => b.length - a.length,
  );

  return function route(url) {
    for (const [prefix, backend] of sortedRoutes) {
      if (matchesPathPrefix(url, prefix)) {
        return backend;
      }
    }
    return defaultBackend;
  };
}

export function isBenignSocketError(err) {
  return Boolean(err && BENIGN_SOCKET_ERRORS.has(err.code));
}

function parseBackendUrl(backendUrl) {
  const url = new URL(backendUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid backend URL");
  }
  return {
    hostname: url.hostname,
    port:
      Number.parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80),
    protocol: url.protocol,
  };
}

function writeInvalidBackendUrlResponse(req, res) {
  const message = "Invalid backend URL";
  console.error(`Proxy error for ${req.url}: ${message}`);
  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Bad Gateway: ${message}`);
  } else {
    res.destroy();
  }
}

export function isLoopbackBackendUrl(backendUrl) {
  try {
    const hostname = new URL(backendUrl).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function isWebgenControlBackendUrl(backendUrl) {
  try {
    const url = new URL(backendUrl);
    return (
      url.protocol === "http:" &&
      url.hostname === "webgen-control.internal" &&
      url.port === "8769" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isWebgenControlRequest(url) {
  try {
    const pathname = new URL(url ?? "/", "http://localhost").pathname;
    return (
      matchesPathPrefix(pathname, "/api/webgen") ||
      matchesPathPrefix(pathname, "/api/webgen-provisioning")
    );
  } catch {
    return false;
  }
}

function isWebgenLifecycleActionRequest(req, target) {
  if (req.method !== "POST" || !isWebgenControlBackendUrl(target)) return false;
  try {
    return /^\/api\/webgen\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/actions$/.test(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    return false;
  }
}

export function isServerInfoRequest(req) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  return pathname === SERVER_INFO_PATH;
}

export function isVSCodeUrlRequest(req) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname.replace(
    /\/+$/,
    "",
  );
  return pathname === "/api/vscode/url" || pathname.endsWith("/api/vscode/url");
}

function redactVSCodeToken(value) {
  if (typeof value !== "string") return value;
  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const url = new URL(value, "http://localhost");
    url.searchParams.delete("tkn");
    url.searchParams.delete("session_api_key");
    return isAbsolute
      ? url.toString()
      : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value.replace(/([?&](?:tkn|session_api_key)=)[^&#]*/gi, "$1");
  }
}

function proxyAgentServerJsonRequest(
  req,
  res,
  backendUrl,
  {
    runtimeServicesInfo = null,
    sessionApiKey = null,
    redactVSCodeUrl = false,
  } = {},
) {
  let backend;
  try {
    backend = parseBackendUrl(backendUrl);
  } catch {
    writeInvalidBackendUrlResponse(req, res);
    return;
  }

  const request = backend.protocol === "https:" ? httpsRequest : httpRequest;
  const proxyReq = request(
    {
      hostname: backend.hostname,
      port: backend.port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${backend.hostname}:${backend.port}`,
        "accept-encoding": "identity",
        ...(sessionApiKey && isLoopbackBackendUrl(backendUrl)
          ? { "x-session-api-key": sessionApiKey }
          : {}),
      },
    },
    (proxyRes) => {
      const chunks = [];

      proxyRes.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });

      proxyRes.on("error", (err) => {
        if (!isBenignSocketError(err)) {
          console.error(`Upstream response error for ${req.url}:`, err.message);
        }
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(`Bad Gateway: ${err.message}`);
        } else {
          res.destroy();
        }
      });

      proxyRes.on("end", () => {
        const statusCode = proxyRes.statusCode ?? 502;
        const headers = { ...proxyRes.headers };
        const originalBody = Buffer.concat(chunks);

        if (statusCode < 200 || statusCode >= 300 || req.method === "HEAD") {
          res.writeHead(statusCode, headers);
          res.end(req.method === "HEAD" ? "" : originalBody);
          return;
        }

        try {
          const payload = JSON.parse(originalBody.toString("utf8"));
          let changed = false;
          if (runtimeServicesInfo !== null && isServerInfoRequest(req)) {
            const runtimeServices =
              typeof runtimeServicesInfo === "string"
                ? JSON.parse(runtimeServicesInfo)
                : runtimeServicesInfo;
            payload.runtime_services = runtimeServices;
            changed = true;
          }
          if (
            redactVSCodeUrl &&
            isVSCodeUrlRequest(req) &&
            typeof payload.vscode_url === "string"
          ) {
            payload.vscode_url = redactVSCodeToken(payload.vscode_url);
            changed = true;
          }
          if (!changed) {
            res.writeHead(statusCode, headers);
            res.end(originalBody);
            return;
          }

          const body = Buffer.from(JSON.stringify(payload), "utf8");

          delete headers["content-length"];
          delete headers["transfer-encoding"];
          headers["content-type"] = "application/json; charset=utf-8";
          headers["cache-control"] = "no-store";
          res.writeHead(statusCode, headers);
          res.end(body);
        } catch (err) {
          console.warn(
            `Could not transform Agent Server JSON response: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          res.writeHead(statusCode, headers);
          res.end(originalBody);
        }
      });
    },
  );

  proxyReq.on("error", (err) => {
    if (!isBenignSocketError(err)) {
      console.error(`Proxy error for ${req.url}:`, err.message);
    }
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(`Bad Gateway: ${err.message}`);
    } else {
      res.destroy();
    }
  });

  req.on("error", (err) => {
    if (!isBenignSocketError(err)) {
      console.error(`Client request error for ${req.url}:`, err.message);
    }
    proxyReq.destroy();
  });

  res.on("error", (err) => {
    if (!isBenignSocketError(err)) {
      console.error(`Client response error for ${req.url}:`, err.message);
    }
    proxyReq.destroy();
  });

  req.pipe(proxyReq, { end: true });
}

export function proxyServerInfoRequest(
  req,
  res,
  backendUrl,
  runtimeServicesInfo,
  { sessionApiKey = null } = {},
) {
  return proxyAgentServerJsonRequest(req, res, backendUrl, {
    runtimeServicesInfo,
    sessionApiKey,
  });
}

export function proxyVSCodeUrlRequest(
  req,
  res,
  backendUrl,
  { sessionApiKey = null } = {},
) {
  return proxyAgentServerJsonRequest(req, res, backendUrl, {
    sessionApiKey,
    redactVSCodeUrl: true,
  });
}

/**
 * An `onResponse` for createProxyHandlers' proxyHttp that rewrites a JSON
 * body through `transform` — buffered, re-serialized, and sent with a fixed
 * Content-Length, as proxyServerInfoRequest does. Any other response, an
 * encoded one, and a JSON body past `limit` bytes stream through untouched
 * (what was buffered first, then the rest), never truncated into broken
 * JSON.
 *
 * @param {(body: unknown) => unknown} transform
 * @param {{ limit: number }} options
 */
export function rewriteJsonResponse(transform, { limit }) {
  return (proxyRes, req, res) => {
    const status = proxyRes.statusCode ?? 502;
    const headers = { ...proxyRes.headers };
    const encoding = headers["content-encoding"];
    const isJson = /\bapplication\/json\b/i.test(headers["content-type"] ?? "");
    if (
      !isJson ||
      req.method === "HEAD" ||
      (encoding && encoding !== "identity")
    ) {
      res.writeHead(status, headers);
      proxyRes.pipe(res);
      return;
    }
    const chunks = [];
    let size = 0;
    let streaming = false;
    proxyRes.on("data", (chunk) => {
      if (streaming) return;
      size += chunk.length;
      if (size <= limit) {
        chunks.push(chunk);
        return;
      }
      streaming = true;
      res.writeHead(status, headers);
      for (const buffered of chunks.splice(0)) res.write(buffered);
      res.write(chunk);
      proxyRes.pipe(res);
    });
    proxyRes.on("end", () => {
      if (streaming) return;
      let body = Buffer.concat(chunks);
      try {
        body = Buffer.from(
          JSON.stringify(transform(JSON.parse(body.toString("utf8")))),
        );
      } catch {
        // Not JSON after all; pass it through as received.
      }
      delete headers["transfer-encoding"];
      headers["content-length"] = String(body.length);
      res.writeHead(status, headers);
      res.end(body);
    });
  };
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return;
    called = true;
    fn(...args);
  };
}

function textErrorBody(message) {
  return {
    contentType: "text/plain; charset=utf-8",
    body: `Bad Gateway: ${message}`,
  };
}

function writeProxyError(res, message, errorBody) {
  if (res.destroyed) return;
  if (!res.headersSent) {
    const { contentType, body } = errorBody(message);
    res.writeHead(502, { "Content-Type": contentType });
    res.end(body);
    return;
  }
  res.destroy();
}

export function createProxyHandlers({
  label = "proxy",
  timeout = DEFAULT_PROXY_TIMEOUT_MS,
  proxyTimeout = DEFAULT_PROXY_TIMEOUT_MS,
  sessionApiKey = /** @type {string | null} */ (null),
  serverSideSessionAuth = false,
  vscodeBasePath = /** @type {string | null} */ (null),
  xfwd = true,
  errorBody = textErrorBody,
  onProxySocket,
} = {}) {
  const proxy = createProxyServer({
    ws: true,
    changeOrigin: true,
    xfwd,
    timeout,
    proxyTimeout,
  });
  if (onProxySocket) proxy.on("proxySocket", onProxySocket);
  const metrics = {
    activeHttpRequests: 0,
    activeWebSockets: 0,
    totalHttpRequests: 0,
    totalWebSockets: 0,
    totalErrors: 0,
  };
  function isVSCodeRoute(url) {
    if (!vscodeBasePath) return false;
    const pathname = new URL(url ?? "/", "http://localhost").pathname;
    return (
      matchesPathPrefix(pathname, vscodeBasePath) ||
      pathname.includes(`${vscodeBasePath}/`) ||
      pathname.endsWith(vscodeBasePath)
    );
  }

  function prepareServerSideProxyOptions(req, target) {
    if (!serverSideSessionAuth) return {};
    delete req.headers["x-session-api-key"];
    const trustedWebgenTarget =
      isWebgenControlBackendUrl(target) && isWebgenControlRequest(req.url);
    if (
      !sessionApiKey ||
      (!isLoopbackBackendUrl(target) && !trustedWebgenTarget)
    ) {
      return {};
    }
    if (isVSCodeRoute(req.url)) {
      try {
        const url = new URL(req.url || "/", "http://localhost");
        url.searchParams.set("tkn", sessionApiKey);
        req.url = `${url.pathname}${url.search}`;
      } catch {
        // Keep the original path; the upstream will return its normal error.
      }
    }
    return { headers: { "X-Session-API-Key": sessionApiKey } };
  }

  proxy.on("proxyRes", (proxyRes, req) => {
    if (!serverSideSessionAuth || !isVSCodeRoute(req.url)) return;
    const location = proxyRes.headers.location;
    if (typeof location === "string") {
      proxyRes.headers.location = redactVSCodeToken(location);
    }
  });

  /** Per-request `onResponse` handlers; see proxyHttp. */
  const responseHandlers = new WeakMap();
  proxy.on("proxyRes", (proxyRes, req, res) => {
    responseHandlers.get(req)?.(proxyRes, req, res);
  });

  proxy.on("error", (err, _req, resOrSocket, target) => {
    metrics.totalErrors += 1;
    const targetText = target ? ` -> ${target}` : "";
    if (!isBenignSocketError(err)) {
      console.error(`[${label}] Proxy error${targetText}: ${err.message}`);
    }
    if (resOrSocket && typeof resOrSocket.writeHead === "function") {
      writeProxyError(resOrSocket, err.message, errorBody);
    } else if (resOrSocket && typeof resOrSocket.destroy === "function") {
      resOrSocket.destroy();
    }
  });

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} target
   * @param {object} [options]
   * @param {Record<string, string>} [options.headers] Set on the upstream request
   * @param {(proxyRes: import("node:http").IncomingMessage, req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void} [options.onResponse]
   *   Writes the response itself instead of it being piped through (e.g.
   *   rewriteJsonResponse).
   */
  function proxyHttp(req, res, target, { headers, onResponse } = {}) {
    metrics.activeHttpRequests += 1;
    metrics.totalHttpRequests += 1;
    const finish = once(() => {
      metrics.activeHttpRequests = Math.max(0, metrics.activeHttpRequests - 1);
    });
    res.on("close", finish);
    res.on("finish", finish);
    res.on("error", finish);

    const handleProxyError = (err) => {
      metrics.totalErrors += 1;
      if (!isBenignSocketError(err)) {
        console.error(
          `[${label}] Proxy error for ${req.url} -> ${target}:`,
          err,
        );
      }
      writeProxyError(
        res,
        err instanceof Error ? err.message : String(err),
        errorBody,
      );
      finish();
    };

    const options = { target, headers };
    if (onResponse) {
      responseHandlers.set(req, onResponse);
      options.selfHandleResponse = true;
    }
    try {
      const serverSideOptions = prepareServerSideProxyOptions(req, target);
      const isLongWebgenAction = isWebgenLifecycleActionRequest(req, target);
      proxy
        .web(req, res, {
          ...options,
          ...serverSideOptions,
          headers: { ...headers, ...serverSideOptions.headers },
          ...(isLongWebgenAction
            ? {
                timeout: WEBGEN_ACTION_TIMEOUT_MS,
                proxyTimeout: WEBGEN_ACTION_TIMEOUT_MS,
              }
            : {}),
        })
        .catch(handleProxyError);
    } catch (err) {
      handleProxyError(err);
    }
  }

  function proxyWebSocket(req, socket, head, target) {
    metrics.activeWebSockets += 1;
    metrics.totalWebSockets += 1;
    const finish = once(() => {
      metrics.activeWebSockets = Math.max(0, metrics.activeWebSockets - 1);
    });
    socket.on("close", finish);
    socket.on("error", finish);

    try {
      const serverSideOptions = prepareServerSideProxyOptions(req, target);
      proxy
        .ws(req, socket, { target, ...serverSideOptions }, head)
        .catch((err) => {
          metrics.totalErrors += 1;
          if (!isBenignSocketError(err)) {
            console.error(
              `[${label}] WebSocket proxy error for ${req.url} -> ${target}:`,
              err,
            );
          }
          socket.destroy();
          finish();
        });
    } catch (err) {
      metrics.totalErrors += 1;
      if (!isBenignSocketError(err)) {
        console.error(
          `[${label}] WebSocket proxy error for ${req.url} -> ${target}:`,
          err,
        );
      }
      socket.destroy();
      finish();
    }
  }

  function dumpMetrics() {
    console.log(
      `[${label}] active_http=${metrics.activeHttpRequests} ` +
        `active_ws=${metrics.activeWebSockets} ` +
        `total_http=${metrics.totalHttpRequests} ` +
        `total_ws=${metrics.totalWebSockets} ` +
        `total_errors=${metrics.totalErrors}`,
    );
  }

  function installDiagnostics(signal = "SIGUSR1") {
    process.on(signal, dumpMetrics);
    return () => {
      process.off(signal, dumpMetrics);
    };
  }

  return {
    proxyHttp,
    proxyWebSocket,
    dumpMetrics,
    installDiagnostics,
    metrics,
  };
}
