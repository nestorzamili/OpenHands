// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileClient } from "@openhands/typescript-client/clients";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { server } from "#/mocks/node";
import {
  readDckModulesConfig,
  writeDckModulesConfig,
} from "#/hooks/query/use-dck-modules-config";

vi.hoisted(() => {
  vi.stubGlobal("window", undefined);
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("creates the module registry as a file and reads it back through the SDK", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "dck-upload-"));
  temporaryDirectories.push(workspace);
  vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", workspace);
  const registryPath = join(workspace, ".dck", "modules.json");
  const host = "http://dck-upload.test";
  server.use(
    http.post(`${host}/api/file/upload`, async ({ request }) => {
      const target = new URL(request.url).searchParams.get("path");
      // The Agent Server writes to exactly `path`; multipart filename does
      // not turn a directory destination into a full file destination.
      if (target !== registryPath) {
        return HttpResponse.json(
          { detail: "Expected the full registry path" },
          { status: 400 },
        );
      }
      const form = await request.formData();
      const file = form.get("file") as File;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, await file.text());
      return HttpResponse.json({ success: true });
    }),
    http.get(`${host}/api/file/download`, ({ request }) => {
      const target = new URL(request.url).searchParams.get("path");
      if (target !== registryPath)
        return new HttpResponse(null, { status: 404 });
      return new HttpResponse(readFileSync(target, "utf8"));
    }),
  );
  const client = new FileClient({ host, apiKey: "test-key" });
  const config = {
    modules: [],
    builtinOverrides: [{ id: "research", name: "My research" }],
  };
  try {
    await writeDckModulesConfig(config, client);
    expect(await readDckModulesConfig(client)).toEqual(config);
    expect(JSON.parse(readFileSync(registryPath, "utf8"))).toMatchObject(
      config,
    );
  } finally {
    client.close();
    vi.stubGlobal("window", {});
  }
});
