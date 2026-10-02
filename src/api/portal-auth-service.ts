/**
 * Browser-side client for the portal-auth endpoints served by the static
 * server / ingress (scripts/portal-auth.mjs). These are same-origin and
 * authenticated by the HttpOnly session cookie, so they are plain `fetch`
 * calls rather than agent-server client calls.
 *
 * `getPortalUser()` doubles as the "is portal auth active?" probe: a 200 means
 * the portal is gating this origin and returns the current user; any non-200
 * (including 404 when the request is proxied to an agent-server without these
 * routes) means portal auth is not active here.
 */

export interface PortalUser {
  username: string;
  isAdmin: boolean;
}

export interface PortalUserListEntry extends PortalUser {
  createdAt: string | null;
}

const BASE = "/api/portal-auth";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

/** Current portal user, or null when portal auth is not active on this origin. */
export async function getPortalUser(): Promise<PortalUser | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/me`, { credentials: "include" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = await res.json();
    if (typeof data?.username !== "string") return null;
    return { username: data.username, isAdmin: Boolean(data.isAdmin) };
  } catch {
    return null;
  }
}

export async function listPortalUsers(): Promise<PortalUserListEntry[]> {
  const res = await fetch(`${BASE}/users`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(await parseError(res, "Failed to load users."));
  }
  const data = await res.json();
  return Array.isArray(data?.users) ? data.users : [];
}

export async function createPortalUser(input: {
  username: string;
  password: string;
  isAdmin: boolean;
}): Promise<void> {
  const res = await fetch(`${BASE}/users`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, "Failed to create user."));
  }
}

export async function deletePortalUser(username: string): Promise<void> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res, "Failed to delete user."));
  }
}

export async function logoutPortal(): Promise<void> {
  await fetch(`${BASE}/logout`, { method: "POST", credentials: "include" });
}
