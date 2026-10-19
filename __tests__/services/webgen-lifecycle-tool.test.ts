import { beforeEach, describe, expect, it, vi } from "vitest";
const { resolveDir, projects, run, post, backend } = vi.hoisted(() => ({
  resolveDir: vi.fn(),
  projects: vi.fn(),
  run: vi.fn(),
  post: vi.fn(),
  backend: vi.fn(),
}));
vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({ default: { resolveConversationWorkingDir: resolveDir } }),
);
vi.mock("#/api/backend-registry/active-store", () => ({
  getActiveBackend: backend,
  isNoBackend: (value: { id: string }) => value.id === "no-backend",
}));
vi.mock("#/dck/webgen-service", async (original) => ({
  ...(await original<object>()),
  fetchWebgenProjects: projects,
  runWebgenLifecycleAction: run,
}));
vi.mock("#/services/client-tool-result", () => ({
  postClientToolResult: post,
}));
import {
  handleWebgenLifecycleAction,
  performWebgenLifecycle,
} from "#/services/webgen-lifecycle-tool";
import { WebgenServiceError } from "#/dck/webgen-service";
import { getDckWorkspaceRoot } from "#/dck/modules";
const appDir = `${getDckWorkspaceRoot()}/webgen/demo-app`;
const project = {
  slug: "demo-app",
  path: "/projects/webgen/demo-app",
  status: "running",
  has_deployment: true,
  subdomain: null,
  port: 3000,
  name: null,
  stack: null,
  auth_provider: null,
  preview_path: null,
  last_checked_at: null,
  containers: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  backend.mockReturnValue({
    backend: {
      id: "local-test",
      kind: "local",
      host: "http://local-test",
      apiKey: "fixture-key",
    },
  });
  resolveDir.mockResolvedValue(appDir);
  projects.mockResolvedValue({ projects: [project] });
  run.mockResolvedValue({ project });
  post.mockResolvedValue(undefined);
});
describe("webgen lifecycle client tool", () => {
  it.each([
    [{ has_deployment: false }, "deploy"],
    [{ status: "stopped" }, "start"],
    [{ status: "running" }, null],
  ])(
    "selects the real run capability from status %j",
    async (state, action) => {
      projects.mockResolvedValue({ projects: [{ ...project, ...state }] });
      const result = await performWebgenLifecycle("c1", { action: "run" });
      expect(result.ok).toBe(true);
      if (action)
        expect(run).toHaveBeenCalledWith(
          "demo-app",
          {
            action,
            conversation_id: "c1",
          },
          {
            host: "http://local-test",
            apiKey: "fixture-key",
            workingDir: getDckWorkspaceRoot(),
          },
        );
      else expect(run).not.toHaveBeenCalled();
      expect(projects).toHaveBeenCalledWith({
        host: "http://local-test",
        apiKey: "fixture-key",
        workingDir: getDckWorkspaceRoot(),
      });
    },
  );
  it.each(["error", "unknown", "starting"])(
    "does not claim run succeeded for %s",
    async (status) => {
      projects.mockResolvedValue({ projects: [{ ...project, status }] });
      expect((await performWebgenLifecycle("c1", { action: "run" })).ok).toBe(
        false,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );
  it.each(["../other-app", "demo-app/nested", "demo-app/../other-app", ""])(
    "rejects workspace escapes %s before controller access",
    async (path) => {
      resolveDir.mockResolvedValue(`${getDckWorkspaceRoot()}/webgen/${path}`);
      expect((await performWebgenLifecycle("c1", { action: "stop" })).ok).toBe(
        false,
      );
      expect(projects).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("does not substitute another controller project for the conversation project", async () => {
    resolveDir.mockResolvedValue(`${getDckWorkspaceRoot()}/webgen/another-app`);
    expect((await performWebgenLifecycle("c1", { action: "stop" })).ok).toBe(
      false,
    );
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    { action: "delete" },
    { action: "status", slug: "other-app" },
    { action: "publish" },
    { action: "publish", subdomain: "../bad" },
  ])("rejects unsafe or underspecified request %j", async (request) => {
    expect((await performWebgenLifecycle("c1", request)).ok).toBe(false);
    expect(projects).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("requires a connected local DCK backend", async () => {
    backend.mockReturnValue({ backend: { id: "cloud-test", kind: "cloud" } });
    expect((await performWebgenLifecycle("c1", { action: "status" })).ok).toBe(
      false,
    );
    expect(resolveDir).not.toHaveBeenCalled();
  });
  it("does not act after the backend changes while resolving the project", async () => {
    resolveDir.mockImplementation(async () => {
      backend.mockReturnValue({ backend: { id: "other", kind: "local" } });
      return appDir;
    });
    expect((await performWebgenLifecycle("c1", { action: "stop" })).ok).toBe(
      false,
    );
    expect(projects).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("does not submit an action if the backend changes while fetching projects", async () => {
    projects.mockImplementation(async () => {
      backend.mockReturnValue({ backend: { id: "other", kind: "local" } });
      return { projects: [project] };
    });
    expect((await performWebgenLifecycle("c1", { action: "stop" })).ok).toBe(
      false,
    );
    expect(run).not.toHaveBeenCalled();
  });
  it("does not submit against a backend whose host or credentials changed under the same id", async () => {
    projects.mockImplementation(async () => {
      backend.mockReturnValue({
        backend: {
          id: "local-test",
          kind: "local",
          host: "http://changed-host",
          apiKey: "changed-key",
        },
      });
      return { projects: [project] };
    });
    expect((await performWebgenLifecycle("c1", { action: "stop" })).ok).toBe(
      false,
    );
    expect(run).not.toHaveBeenCalled();
  });
  it("returns only lifecycle metadata, not environment or controller payload extras", async () => {
    run.mockResolvedValue({
      project: { ...project, environment: { PRIVATE: "sentinel" } },
      secret: "sentinel",
    });
    const result = await performWebgenLifecycle("c1", { action: "restart" });
    expect(result).toEqual({
      ok: true,
      action: "restart",
      project: {
        status: "running",
        has_deployment: true,
        port: 3000,
        subdomain: null,
        preview_path: "/preview/demo-app",
      },
    });
    expect(JSON.stringify(result)).not.toContain("sentinel");
  });
  it.each([401, 404, 503, 410, 422])(
    "reports unavailable capability safely for HTTP %s",
    async (status) => {
      projects.mockRejectedValue(new WebgenServiceError(status));
      const result = await performWebgenLifecycle("c1", { action: "status" });
      expect(result.ok).toBe(false);
      expect(result.error).not.toContain("click");
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("does not expose controller exception details", async () => {
    projects.mockRejectedValue(new Error("secret env value / bearer token"));
    expect(await performWebgenLifecycle("c1", { action: "status" })).toEqual({
      ok: false,
      error:
        "The WebGen controller is unavailable or could not complete this operation.",
    });
  });
  it("submits the real result and does not execute a replayed action twice", async () => {
    const action = { kind: "ClientAction_webgen_lifecycle", action: "stop" };
    await handleWebgenLifecycleAction(action, "c1", "tc1");
    await handleWebgenLifecycleAction(action, "c1", "tc1");
    expect(run).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "c1",
      "WebGen lifecycle result: ",
      expect.objectContaining({ ok: true, action: "stop" }),
    );
  });
  it("executes a concurrent replay of the same tool call only once", async () => {
    let finishRun!: (value: { project: typeof project }) => void;
    run.mockImplementation(
      () => new Promise((resolve) => (finishRun = resolve)),
    );
    const action = { kind: "ClientAction_webgen_lifecycle", action: "stop" };
    const first = handleWebgenLifecycleAction(action, "c1", "tc-concurrent");
    const replay = handleWebgenLifecycleAction(action, "c1", "tc-concurrent");
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    finishRun({ project });
    await Promise.all([first, replay]);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("forwards the authorized publish subdomain and conversation id through the bound backend", async () => {
    await performWebgenLifecycle("c-publish", {
      kind: "ClientAction_webgen_lifecycle",
      action: "publish",
      subdomain: "authorized-app",
    });
    expect(run).toHaveBeenCalledWith(
      "demo-app",
      {
        action: "publish",
        subdomain: "authorized-app",
        conversation_id: "c-publish",
      },
      {
        host: "http://local-test",
        apiKey: "fixture-key",
        workingDir: getDckWorkspaceRoot(),
      },
    );
  });
});
