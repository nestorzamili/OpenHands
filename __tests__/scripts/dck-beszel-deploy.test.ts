import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tempDirectories: string[] = [];

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dck-beszel-deploy-"));
  tempDirectories.push(root);
  const stage = path.join(root, "stage");
  const target = path.join(root, "target");
  const bin = path.join(root, "bin");
  await Promise.all([
    mkdir(path.join(stage, "scripts"), { recursive: true }),
    mkdir(path.join(stage, "workspace", ".agents"), { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(stage, "docker-compose.yml"), "services: {}\n"),
    writeFile(path.join(stage, ".env.production.sample"), ""),
    writeFile(path.join(stage, "workspace", "AGENTS.md"), "# Workspace\n"),
    writeFile(
      path.join(stage, "workspace", ".agents", "README.md"),
      "skills\n",
    ),
    writeFile(path.join(stage, "scripts", "dck-deploy.sh"), "#!/bin/sh\n"),
    writeFile(
      path.join(stage, "scripts", "migrate-automation-db.sh"),
      "#!/bin/sh\n",
    ),
    writeFile(
      path.join(stage, "scripts", "dck-beszel-token.mjs"),
      "// helper\n",
    ),
  ]);
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -e
if [[ "$1 $2" == "compose version" ]]; then exit 0; fi
if [[ "$1 $2" == "compose pull" ]]; then exit 0; fi
if [[ "$1 $2" == "compose up" ]]; then printf 'generated-test-token\\n' > beszel-agent-data/universal-token; exit 0; fi
if [[ "$1" == "images" ]]; then exit 0; fi
exit 2
`,
  );
  await writeFile(path.join(bin, "curl"), "#!/bin/sh\nprintf 200\n");
  await writeFile(path.join(bin, "chown"), "#!/bin/sh\nexit 0\n");
  await Promise.all(
    ["docker", "curl", "chown"].map((name) =>
      import("node:fs/promises").then(({ chmod }) =>
        chmod(path.join(bin, name), 0o755),
      ),
    ),
  );
  return { root, stage, target, bin };
}

async function readEnv(file: string) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  return Object.fromEntries(
    lines
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Beszel production deploy bootstrap", () => {
  it("generates first-run credentials and reuses them and the token on redeploy", async () => {
    const { stage, target, bin } = await createFixture();
    await writeFile(
      path.join(stage, ".env.production.sample"),
      [
        "CANVAS_IMAGE=ghcr.io/dck-ai/dck-agentic",
        "CANVAS_IMAGE_TAG=sha-REPLACE_ME",
        "BESZEL_ADMIN_EMAIL=",
        "BESZEL_ADMIN_PASSWORD=",
        "BESZEL_AGENT_TOKEN=",
        "POSTGRES_USER=",
        "POSTGRES_PASSWORD=",
        "POSTGRES_DB=",
        "AUTOMATION_DB_URL=",
      ].join("\n") + "\n",
    );
    const deployScript = path.join(repositoryRoot, "scripts/dck-deploy.sh");

    const { stdout, stderr } = await execFileAsync(
      "bash",
      [deployScript, "sha-test", stage],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          IMAGE_OWNER: "dck-ai",
        },
      },
    );

    const env = await readEnv(path.join(target, ".env"));
    expect(env.BESZEL_ADMIN_EMAIL).toBe("beszel-admin@dckautoposting.com");
    expect(env.BESZEL_ADMIN_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(env.BESZEL_AGENT_TOKEN).toBe("generated-test-token");
    expect(env.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
    const envStat = await stat(path.join(target, ".env"));
    expect(envStat.mode & 0o777).toBe(0o600);
    expect(`${stdout}${stderr}`).not.toContain(env.BESZEL_ADMIN_PASSWORD);
    expect(`${stdout}${stderr}`).not.toContain(env.BESZEL_AGENT_TOKEN);

    await execFileAsync("bash", [deployScript, "sha-next", stage], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TARGET_DIR: target,
        IMAGE_OWNER: "dck-ai",
      },
    });

    const redeployedEnv = await readEnv(path.join(target, ".env"));
    expect(redeployedEnv.CANVAS_IMAGE_TAG).toBe("sha-next");
    expect(redeployedEnv.BESZEL_ADMIN_EMAIL).toBe(env.BESZEL_ADMIN_EMAIL);
    expect(redeployedEnv.BESZEL_ADMIN_PASSWORD).toBe(env.BESZEL_ADMIN_PASSWORD);
    expect(redeployedEnv.BESZEL_AGENT_TOKEN).toBe(env.BESZEL_AGENT_TOKEN);
  });
});
