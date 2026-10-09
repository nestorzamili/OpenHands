import { beforeEach, describe, expect, it, vi } from "vitest";

const { listeners, proxy } = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const fakeProxy = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    web: vi.fn(() => Promise.resolve()),
    ws: vi.fn(() => Promise.resolve()),
  };
  return { listeners: handlers, proxy: fakeProxy };
});

vi.mock("httpxy", () => ({
  createProxyServer: vi.fn(() => proxy),
}));

import { createProxyHandlers } from "../../scripts/proxy-utils.mjs";

const internalKey = "server-only-session-key";
const response = { on: vi.fn() };

beforeEach(() => {
  Object.keys(listeners).forEach((event) => delete listeners[event]);
  proxy.on.mockClear();
  proxy.web.mockClear();
  proxy.ws.mockClear();
  response.on.mockClear();
});

describe("server-side proxy authentication", () => {
  it("replaces a browser-supplied key for loopback Agent Server requests", () => {
    const handlers = createProxyHandlers({
      label: "server-side-auth-test",
      sessionApiKey: internalKey,
      serverSideSessionAuth: true,
    });
    const req = {
      method: "GET",
      url: "/api/workspace",
      headers: { "x-session-api-key": "browser-supplied-value" },
    };
    const target = "http://127.0.0.1:18101";

    handlers.proxyHttp(req as never, response as never, target);

    expect(req.headers["x-session-api-key"]).toBeUndefined();
    expect(proxy.web).toHaveBeenCalledWith(req, response, {
      target,
      headers: { "X-Session-API-Key": internalKey },
    });
  });

  it("does not forward browser credentials to a non-loopback target", () => {
    const handlers = createProxyHandlers({
      label: "server-side-auth-test",
      sessionApiKey: internalKey,
      serverSideSessionAuth: true,
    });
    const req = {
      method: "GET",
      url: "/api/workspace",
      headers: { "x-session-api-key": "browser-supplied-value" },
    };
    const target = "https://agent.example.com";

    handlers.proxyHttp(req as never, response as never, target);

    expect(req.headers["x-session-api-key"]).toBeUndefined();
    expect(proxy.web).toHaveBeenCalledWith(req, response, { target });
  });

  it("adds the internal tkn only to proxied VS Code URLs and redacts redirects", () => {
    const handlers = createProxyHandlers({
      label: "server-side-auth-test",
      sessionApiKey: internalKey,
      serverSideSessionAuth: true,
      vscodeBasePath: "/vscode",
    });
    const req = {
      method: "GET",
      url: "/vscode/workbench?view=1",
      headers: {},
    };
    const target = "http://127.0.0.1:18101";

    handlers.proxyHttp(req as never, response as never, target);

    expect(req.url).toContain(`tkn=${internalKey}`);
    expect(proxy.web).toHaveBeenCalledWith(req, response, {
      target,
      headers: { "X-Session-API-Key": internalKey },
    });

    const proxyResponse = {
      headers: { location: `/vscode/?tkn=${internalKey}` },
    };
    listeners.proxyRes(proxyResponse, req);
    expect(proxyResponse.headers.location).toBe("/vscode/");
  });
});
