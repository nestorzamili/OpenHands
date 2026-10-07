/**
 * Self-contained portal auth for the Agent Canvas static server.
 *
 * When `--portal-auth <store>` is passed to scripts/static-server.mjs, every
 * request -- static assets, SPA navigation, proxied API traffic and WebSocket
 * upgrades alike -- is gated behind a session cookie. This lets the web UI be
 * exposed publicly without leaving the agent server, automations and
 * conversations open to anyone who can reach the port.
 *
 * Wired by scripts/static-server.mjs (invoked directly, and by the Docker
 * entrypoint via the AGENT_CANVAS_PORTAL_AUTH env var). The non-Docker split
 * launcher routes /api and /sockets through a standalone ingress that bypasses
 * this gate, so the portal is not supported on that path yet.
 *
 * Behavior:
 * - First run (no admin user in the store): every request redirects to
 *   `/setup`. `POST /api/portal-auth/setup` creates the first admin account.
 *   After creation the operator can log in.
 * - `GET /login` serves a self-contained login page.
 * - `POST /api/portal-auth/login` validates credentials and sets an
 *   HttpOnly, SameSite=Strict session cookie.
 * - `POST /api/portal-auth/users` (admin-only) creates additional users.
 * - `POST /api/portal-auth/logout` clears the session.
 * - Everything else requires a valid session, otherwise it is redirected to
 *   `/login` (browser navigations) or rejected with 401 (API/asset calls).
 *
 * Passwords are stored as scrypt hashes with a per-user random salt. Sessions
 * are opaque random tokens stored hashed (sha256) in the store with a TTL, so
 * a store leak does not yield usable sessions or passwords.
 *
 * The module has zero dependencies beyond node:crypto and node:fs, so it works
 * in any launcher that already depends on this repo.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PORTAL_AUTH_SETUP_PATH = "/api/portal-auth/setup";
const PORTAL_AUTH_LOGIN_PATH = "/api/portal-auth/login";
const PORTAL_AUTH_LOGOUT_PATH = "/api/portal-auth/logout";
const PORTAL_AUTH_USERS_PATH = "/api/portal-auth/users";
const PORTAL_AUTH_ME_PATH = "/api/portal-auth/me";
export const PORTAL_AUTH_SESSION_COOKIE = "openhands_portal_session";
const PORTAL_AUTH_SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h
const PORTAL_AUTH_RETURN_TO_ORIGIN = "http://portal-auth.invalid";

function sanitizeReturnTo(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }

  try {
    const target = new URL(value, PORTAL_AUTH_RETURN_TO_ORIGIN);
    if (target.origin !== PORTAL_AUTH_RETURN_TO_ORIGIN) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function escapeHtmlAttribute(value) {
  return value.replace(/[&<>\"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

// Login/setup brute-force throttle: per key (IP + username), allow a small
// burst then reject with 429 until the window elapses. In-memory and
// dependency-free; sufficient for a single-process server.
const PORTAL_AUTH_MAX_ATTEMPTS = 10;
const PORTAL_AUTH_ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 min

const SCRYPT_KEYLEN = 64;
const SESSION_BYTES = 32;
const SALT_BYTES = 16;

const scryptAsync = promisify(scrypt);

async function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return derived.toString("hex");
}

function randomToken() {
  return randomBytes(SESSION_BYTES).toString("hex");
}

function tokenDigest(token) {
  return createHash("sha256").update(token).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

function defaultStoreShape() {
  return {
    version: 1,
    users: {}, // username -> { salt, passwordHash, isAdmin, createdAt }
    sessions: {}, // tokenDigest -> { username, expiresAt }
  };
}

/**
 * A JSON-file backed credential + session store with atomic-ish writes
 * (write temp file, then rename over the target).
 */
export class PortalAuthStore {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.data = this.#load();
    // Scrub any sessions that already expired at rest to avoid unbounded growth.
    this.#pruneExpired();
  }

  #load() {
    let raw;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      // Absent store = legitimate first run; any other read failure must fail
      // closed rather than silently downgrade a configured instance to "no
      // admin" and re-expose /setup.
      if (err?.code === "ENOENT") {
        return defaultStoreShape();
      }
      throw new PortalAuthError(
        500,
        `Portal auth store at ${this.filePath} exists but could not be read ` +
          `(${err?.code ? err.code : err}). Refusing to start to avoid ` +
          `re-exposing first-run setup. Fix the file/permissions or remove it ` +
          `to start fresh.`,
      );
    }

    if (raw.trim() === "") {
      return defaultStoreShape();
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PortalAuthError(
        500,
        `Portal auth store at ${this.filePath} is not valid JSON. Refusing to ` +
          `start to avoid re-exposing first-run setup. Restore a valid store ` +
          `or remove the file to start fresh.`,
      );
    }

    const base = defaultStoreShape();
    return {
      ...base,
      ...parsed,
      users: { ...base.users, ...(parsed.users ?? {}) },
      sessions: { ...(parsed.sessions ?? {}) },
    };
  }

  #persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  #pruneExpired() {
    const now = Date.now();
    let changed = false;
    for (const [digest, session] of Object.entries(this.data.sessions)) {
      if (session.expiresAt <= now) {
        delete this.data.sessions[digest];
        changed = true;
      }
    }
    if (changed) this.#persist();
  }

  get hasAdmin() {
    return Object.values(this.data.users).some((u) => u.isAdmin);
  }

  async createUser(username, password, { isAdmin = false } = {}) {
    const name = username.trim();
    if (!name || !password)
      throw new PortalAuthError(400, "Username and password are required.");
    if (name.length > 64) throw new PortalAuthError(400, "Username too long.");
    if (password.length < 8) {
      throw new PortalAuthError(400, "Password must be at least 8 characters.");
    }
    if (this.data.users[name]) {
      throw new PortalAuthError(409, "User already exists.");
    }
    const salt = randomBytes(SALT_BYTES).toString("hex");
    this.data.users[name] = {
      salt,
      passwordHash: await hashPassword(password, salt),
      isAdmin: Boolean(isAdmin),
      createdAt: new Date().toISOString(),
    };
    this.#persist();
    return { username: name, isAdmin: Boolean(isAdmin) };
  }

  verifyUser(username) {
    const user = this.data.users[username];
    if (!user) return null;
    return { username, isAdmin: user.isAdmin };
  }

  listUsers() {
    return Object.entries(this.data.users)
      .map(([username, u]) => ({
        username,
        isAdmin: Boolean(u.isAdmin),
        createdAt: u.createdAt ?? null,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  #countAdmins() {
    return Object.values(this.data.users).filter((u) => u.isAdmin).length;
  }

  /**
   * Delete a user. Guards against lockout: an admin cannot delete their own
   * account while logged in, and the last remaining admin cannot be removed.
   */
  deleteUser(username, { actingUser } = {}) {
    const name = (username ?? "").trim();
    const user = this.data.users[name];
    if (!user) throw new PortalAuthError(404, "User not found.");
    if (actingUser && name === actingUser) {
      throw new PortalAuthError(400, "You cannot delete your own account.");
    }
    if (user.isAdmin && this.#countAdmins() <= 1) {
      throw new PortalAuthError(400, "Cannot delete the last admin.");
    }
    delete this.data.users[name];
    // Invalidate any live sessions belonging to the deleted user.
    for (const [digest, session] of Object.entries(this.data.sessions)) {
      if (session.username === name) delete this.data.sessions[digest];
    }
    this.#persist();
    return { username: name };
  }

  async authenticate(username, password) {
    const user = this.data.users[username];
    if (!user) return false;
    const candidate = await hashPassword(password, user.salt);
    const stored = Buffer.from(user.passwordHash, "hex");
    const provided = Buffer.from(candidate, "hex");
    if (stored.length !== provided.length) return false;
    return timingSafeEqual(stored, provided);
  }

  createSession(username) {
    const token = randomToken();
    const digest = tokenDigest(token);
    this.data.sessions[digest] = {
      username,
      expiresAt: Date.now() + PORTAL_AUTH_SESSION_TTL_SECONDS * 1000,
    };
    this.#persist();
    return token;
  }

  /**
   * @returns {string | null} username for a valid session token, else null.
   */
  resolveSession(token) {
    if (!token) return null;
    const session = this.data.sessions[tokenDigest(token)];
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      delete this.data.sessions[tokenDigest(token)];
      this.#persist();
      return null;
    }
    return session.username;
  }

  destroySession(token) {
    if (!token) return;
    if (this.data.sessions[tokenDigest(token)]) {
      delete this.data.sessions[tokenDigest(token)];
      this.#persist();
    }
  }
}

class PortalAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new PortalAuthError(413, "Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolvePromise(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new PortalAuthError(400, "Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function sendHtml(res, html) {
  const body = Buffer.from(html, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function setSessionCookie(res, req, token) {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${PORTAL_AUTH_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${PORTAL_AUTH_SESSION_TTL_SECONDS}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${PORTAL_AUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  );
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function isHtmlNavigation(req, urlPath) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  // Asset paths and explicitly fetched files (API responses) get a 401, not a
  // redirect, so XHR and asset loads fail cleanly instead of returning the
  // login page markup.
  const last = urlPath.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  const ext = dot >= 0 ? last.slice(dot + 1).toLowerCase() : "";
  if (ext && ["html", "htm"].includes(ext)) return true;
  if (ext) return false; // has an extension -> asset
  return !urlPath.startsWith("/api/");
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

// DCK brand mark (crown badge), inlined so the pre-auth login/setup pages stay
// self-contained — they are served before any session exists, so they cannot
// depend on bundled assets or network fetches. Mirrors
// src/assets/branding/dck-mark.svg.
const BRAND_NAME = "DCK Agentic";
const BRAND_MARK = `<svg class="brand-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="DCK"><rect width="64" height="64" rx="14" fill="#0b1e3b"/><path d="M18 42h28l-2.6-14.5-6.4 5.9L32 22l-4.9 11.4-6.5-5.9L18 42Z" fill="#c9b79a"/><rect x="19" y="45" width="26" height="4" rx="2" fill="#a6937c"/></svg>`;

// Same crown mark without the CSS class / role, sized for a favicon. Kept in
// sync with public/favicon.svg and src/assets/branding/dck-mark.svg so the
// portal tab icon matches the SPA tab icon exactly.
const BRAND_MARK_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1e3b"/><path d="M18 42h28l-2.6-14.5-6.4 5.9L32 22l-4.9 11.4-6.5-5.9L18 42Z" fill="#c9b79a"/><rect x="19" y="45" width="26" height="4" rx="2" fill="#a6937c"/></svg>`;

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0b0f19; color: #e6e9f0; min-height: 100vh; display: grid; place-items: center;
  }
  .brand { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 20px; }
  .brand-mark { width: 56px; height: 56px; display: block; }
  .brand-name { font-size: 15px; font-weight: 600; letter-spacing: 0.2px; color: #e6e9f0; }
  .card {
    background: #141a2a; border: 1px solid #2a3350; border-radius: 12px;
    padding: 32px 28px; width: min(360px, 92vw);
  }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 20px; color: #9aa3b8; font-size: 13px; }
  label { display: block; font-size: 13px; margin: 12px 0 6px; color: #b9c1d4; }
  input {
    width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #2f3a5c;
    background: #0e1424; color: #e6e9f0; font-size: 14px;
  }
  input:focus { outline: none; border-color: #5b7cfa; }
  input[aria-invalid="true"] { border-color: #ff7a85; }
  button {
    width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 8px;
    background: #5b7cfa; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #4a6bf0; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .error { margin-top: 14px; color: #ff7a85; font-size: 13px; min-height: 18px; white-space: pre-wrap; }
  small.hint { color: #8a93ab; font-size: 12px; line-height: 1.5; }
`;

function shellPage({ title, subtitle, body, script }) {
  // Inline the brand mark as the favicon via a data URI so it renders even
  // pre-auth (unauthenticated non-navigation asset requests are 401'd by the
  // gate below, so a `/favicon.svg` link would not load on the login page).
  const faviconHref = `data:image/svg+xml,${encodeURIComponent(BRAND_MARK_FAVICON)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<link rel="icon" type="image/svg+xml" href="${faviconHref}" />
<title>${title}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="card">
<div class="brand">${BRAND_MARK}<span class="brand-name">${BRAND_NAME}</span></div>
<h1>${title}</h1>
<p class="sub">${subtitle}</p>
${body}
</div>
<script>${script}</script>
</body>
</html>`;
}

function loginPageHtml(returnTo = "/") {
  const form = `
<form id="f" autocomplete="on" novalidate>
<input type="hidden" name="returnTo" value="${escapeHtmlAttribute(returnTo)}" />
<label for="username">Username</label>
<input id="username" name="username" autocomplete="username" required
  aria-describedby="err" />
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password"
  required aria-describedby="err" />
<button id="submit" type="submit">Sign in</button>
<div class="error" id="err" role="alert" aria-live="assertive"></div>
</form>`;
  const script = `
const f = document.getElementById('f');
const btn = document.getElementById('submit');
const err = document.getElementById('err');
function setError(msg) {
  err.textContent = msg || '';
  const invalid = Boolean(msg);
  f.username.setAttribute('aria-invalid', String(invalid));
  f.password.setAttribute('aria-invalid', String(invalid));
}
let submitting = false;
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;
  setError('');
  const username = f.username.value.trim();
  const password = f.password.value;
  if (!username || !password) {
    setError('Enter your username and password.');
    (username ? f.password : f.username).focus();
    return;
  }
  submitting = true;
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/portal-auth/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username, password, returnTo: f.elements.namedItem('returnTo').value })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(data.error || 'Login failed.');
      btn.disabled = false;
      btn.textContent = 'Sign in';
      submitting = false;
      f.password.focus();
      f.password.select();
      return;
    }
    window.location.href = data.returnTo || '/';
  } catch {
    setError('Network error. Check your connection and try again.');
    btn.disabled = false;
    btn.textContent = 'Sign in';
    submitting = false;
  }
});
document.addEventListener('DOMContentLoaded', () => f.username.focus());
`;
  return shellPage({
    title: "Sign in",
    subtitle: "Sign in to continue",
    body: form,
    script,
  });
}

function setupPageHtml(returnTo = "/") {
  const form = `
<form id="f" autocomplete="on" novalidate>
<input type="hidden" name="returnTo" value="${escapeHtmlAttribute(returnTo)}" />
<p class="sub">No admin account configured yet. Create one to lock down this instance.</p>
<label for="username">Admin username</label>
<input id="username" name="username" autocomplete="username" required
  maxlength="64" aria-describedby="err" />
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="new-password"
  required minlength="8" aria-describedby="pw-hint err" />
<small class="hint" id="pw-hint">At least 8 characters. This account can create additional users later.</small>
<label for="confirm">Confirm password</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password"
  required minlength="8" aria-describedby="err" />
<button id="submit" type="submit">Create admin</button>
<div class="error" id="err" role="alert" aria-live="assertive"></div>
</form>`;
  const script = `
const f = document.getElementById('f');
const btn = document.getElementById('submit');
const err = document.getElementById('err');
function setError(msg, field) {
  err.textContent = msg || '';
  const invalid = Boolean(msg);
  for (const el of [f.username, f.password, f.confirm]) {
    el.setAttribute('aria-invalid', 'false');
  }
  if (invalid && field) field.setAttribute('aria-invalid', 'true');
}
let submitting = false;
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;
  setError('');
  const username = f.username.value.trim();
  const password = f.password.value;
  const confirm = f.confirm.value;
  if (!username) { setError('Enter an admin username.', f.username); f.username.focus(); return; }
  if (password.length < 8) {
    setError('Password must be at least 8 characters.', f.password);
    f.password.focus();
    return;
  }
  if (password !== confirm) {
    setError('Passwords do not match.', f.confirm);
    f.confirm.focus();
    f.confirm.select();
    return;
  }
  submitting = true;
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const r = await fetch('/api/portal-auth/setup', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username, password, returnTo: f.elements.namedItem('returnTo').value })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(data.error || 'Failed to create admin.');
      btn.disabled = false;
      btn.textContent = 'Create admin';
      submitting = false;
      return;
    }
    window.location.href = data.returnTo || '/';
  } catch {
    setError('Network error. Check your connection and try again.');
    btn.disabled = false;
    btn.textContent = 'Create admin';
    submitting = false;
  }
});
document.addEventListener('DOMContentLoaded', () => f.username.focus());
`;
  return shellPage({
    title: "Set up admin",
    subtitle: "First-time configuration",
    body: form,
    script,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Request handler that front-runs the static/proxy router
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory brute-force throttle keyed by `${ip}:${username}`. Allows a short
 * burst then rejects with 429 until the window elapses. `ip` is derived from
 * `x-forwarded-for`, so it assumes a trusted reverse proxy (nginx) sets that
 * header; a directly-exposed port could be spoofed to evade the limit.
 */
function createAttemptThrottle({
  maxAttempts = PORTAL_AUTH_MAX_ATTEMPTS,
  windowMs = PORTAL_AUTH_ATTEMPT_WINDOW_MS,
} = {}) {
  const attempts = new Map(); // key -> { count, resetAt }
  const dropExpired = (now) => {
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
  };
  return {
    fail(key) {
      const now = Date.now();
      dropExpired(now);
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      entry.count += 1;
    },
    succeed(key) {
      attempts.delete(key);
    },
    isThrottled(key) {
      const entry = attempts.get(key);
      if (!entry) return false;
      if (entry.resetAt <= Date.now()) {
        attempts.delete(key);
        return false;
      }
      return entry.count >= maxAttempts;
    },
  };
}

function clientKey(req, username) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" && forwarded.split(",")[0].trim()) ||
    req.socket?.remoteAddress ||
    "unknown";
  return `${ip}:${username}`;
}

function requestIsHttps(req) {
  if (req.socket?.encrypted) return true;
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string") {
    return proto.split(",")[0].trim().toLowerCase() === "https";
  }
  return false;
}

/**
 * Handle a portal-auth request. Returns `true` if the request was fully
 * handled (response written), otherwise `false` to signal the caller should
 * continue serving the request normally (i.e. it is authenticated).
 *
 * @param {import("node:http").ClientRequest} req
 * @param {import("node:http").ServerResponse} res
 * @param {PortalAuthStore} store
 * @param {{ loginPath?: string, returnTo?: string }} [opts]
 */
export function createPortalAuthHandler(store, opts = {}) {
  const loginPath = opts.loginPath ?? "/login";
  const throttle = opts.throttle ?? createAttemptThrottle();
  return function handlePortalAuth(req, res) {
    const requestTarget = req.url ?? "/";
    const urlPath = requestTarget.split("?")[0];
    const requestUrl = new URL(requestTarget, PORTAL_AUTH_RETURN_TO_ORIGIN);
    const cookies = parseCookies(req);
    const sessionToken = cookies[PORTAL_AUTH_SESSION_COOKIE];
    const username = store.resolveSession(sessionToken);

    // ── First admin setup ────────────────────────────────────────────────────
    if (req.method === "POST" && urlPath === PORTAL_AUTH_SETUP_PATH) {
      if (store.hasAdmin) {
        sendJson(res, 409, { error: "Admin already configured." });
        return true;
      }
      return readBody(req)
        .then(async (body) => {
          const name = String(body.username ?? "").trim();
          const key = clientKey(req, name);
          if (throttle.isThrottled(key)) {
            sendJson(res, 429, {
              error: "Too many attempts. Try again later.",
            });
            return;
          }
          try {
            await store.createUser(name, String(body.password ?? ""), {
              isAdmin: true,
            });
          } catch (err) {
            throttle.fail(key);
            throw err;
          }
          throttle.succeed(key);
          const token = store.createSession(name);
          setSessionCookie(res, req, token);
          sendJson(res, 201, {
            ok: true,
            returnTo: sanitizeReturnTo(body.returnTo ?? opts.returnTo ?? "/"),
          });
        })
        .catch((err) => {
          const status = err instanceof PortalAuthError ? err.status : 500;
          sendJson(res, status, { error: err.message ?? "Internal error." });
        })
        .then(() => true);
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    if (req.method === "POST" && urlPath === PORTAL_AUTH_LOGIN_PATH) {
      return readBody(req)
        .then(async (body) => {
          const name = String(body.username ?? "").trim();
          const password = String(body.password ?? "");
          const key = clientKey(req, name);
          if (throttle.isThrottled(key)) {
            sendJson(res, 429, {
              error: "Too many attempts. Try again later.",
            });
            return;
          }
          const ok = await store.authenticate(name, password);
          if (!ok) {
            throttle.fail(key);
            throw new PortalAuthError(401, "Invalid username or password.");
          }
          throttle.succeed(key);
          const token = store.createSession(name);
          setSessionCookie(res, req, token);
          const returnTo = sanitizeReturnTo(
            body.returnTo ?? opts.returnTo ?? "/",
          );
          sendJson(res, 200, { ok: true, returnTo });
        })
        .catch((err) => {
          const status = err instanceof PortalAuthError ? err.status : 500;
          sendJson(res, status, { error: err.message ?? "Internal error." });
        })
        .then(() => true);
    }

    // ── Logout ────────────────────────────────────────────────────────────────
    if (req.method === "POST" && urlPath === PORTAL_AUTH_LOGOUT_PATH) {
      store.destroySession(sessionToken);
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // ── Current user (whoami) ───────────────────────────────────────────────────
    if (req.method === "GET" && urlPath === PORTAL_AUTH_ME_PATH) {
      const me = username ? store.verifyUser(username) : null;
      if (!me) {
        sendJson(res, 401, { error: "Authentication required." });
        return true;
      }
      sendJson(res, 200, { username: me.username, isAdmin: me.isAdmin });
      return true;
    }

    // ── Admin: list / create / delete users ─────────────────────────────────────
    if (
      urlPath === PORTAL_AUTH_USERS_PATH ||
      urlPath.startsWith(`${PORTAL_AUTH_USERS_PATH}/`)
    ) {
      const admin = username ? store.verifyUser(username) : null;
      if (!admin) {
        sendJson(res, 401, { error: "Authentication required." });
        return true;
      }
      if (!admin.isAdmin) {
        sendJson(res, 403, { error: "Admin role required." });
        return true;
      }

      if (req.method === "GET" && urlPath === PORTAL_AUTH_USERS_PATH) {
        sendJson(res, 200, { users: store.listUsers() });
        return true;
      }

      if (req.method === "POST" && urlPath === PORTAL_AUTH_USERS_PATH) {
        return readBody(req)
          .then(async (body) => {
            const created = await store.createUser(
              String(body.username ?? ""),
              String(body.password ?? ""),
              { isAdmin: Boolean(body.isAdmin) },
            );
            sendJson(res, 201, { ok: true, user: created });
          })
          .catch((err) => {
            const status = err instanceof PortalAuthError ? err.status : 500;
            sendJson(res, status, {
              error: err.message ?? "Failed to create user.",
            });
          })
          .then(() => true);
      }

      if (req.method === "DELETE") {
        // Target comes from the path (/users/<name>) or ?username=.
        const fromPath =
          urlPath === PORTAL_AUTH_USERS_PATH
            ? null
            : decodeURIComponent(
                urlPath.slice(PORTAL_AUTH_USERS_PATH.length + 1),
              );
        const query = new URL(req.url ?? "/", "http://localhost").searchParams;
        const target = fromPath || query.get("username") || "";
        try {
          store.deleteUser(target, { actingUser: username });
          sendJson(res, 200, { ok: true });
        } catch (err) {
          const status = err instanceof PortalAuthError ? err.status : 500;
          sendJson(res, status, {
            error: err.message ?? "Failed to delete user.",
          });
        }
        return true;
      }

      sendJson(res, 405, { error: "Method not allowed." });
      return true;
    }

    // ── Login / setup pages ─────────────────────────────────────────────────────
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      urlPath === loginPath
    ) {
      sendHtml(
        res,
        loginPageHtml(
          sanitizeReturnTo(
            requestUrl.searchParams.get("returnTo") ?? opts.returnTo ?? "/",
          ),
        ),
      );
      return true;
    }
    if (urlPath === "/setup" && !store.hasAdmin) {
      sendHtml(
        res,
        setupPageHtml(
          sanitizeReturnTo(
            requestUrl.searchParams.get("returnTo") ?? opts.returnTo ?? "/",
          ),
        ),
      );
      return true;
    }

    // ── Gating ───────────────────────────────────────────────────────────────
    if (!username) {
      const isNav = isHtmlNavigation(req, urlPath);
      if (isNav || urlPath.startsWith("/setup")) {
        const target = store.hasAdmin ? loginPath : "/setup";
        const returnTo =
          store.hasAdmin && urlPath === "/setup"
            ? sanitizeReturnTo(requestUrl.searchParams.get("returnTo") ?? "/")
            : sanitizeReturnTo(`${requestUrl.pathname}${requestUrl.search}`);
        res.writeHead(302, {
          Location: `${target}?returnTo=${encodeURIComponent(returnTo)}`,
        });
        res.end();
      } else {
        sendJson(res, 401, { error: "Authentication required." });
      }
      return true; // blocked
    }

    return false; // authenticated -> continue serving
  };
}
