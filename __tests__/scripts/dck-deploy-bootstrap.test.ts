import { execFile } from "node:child_process";
import {
  chmod,
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
  const root = await mkdtemp(path.join(os.tmpdir(), "dck-deploy-bootstrap-"));
  tempDirectories.push(root);
  const stage = path.join(root, "stage");
  const target = path.join(root, "target");
  const bin = path.join(root, "bin");
  await Promise.all([
    mkdir(path.join(stage, "scripts"), { recursive: true }),
    mkdir(path.join(stage, "workspace", ".agents"), { recursive: true }),
    mkdir(path.join(stage, "services", "webgen-control"), { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(stage, "docker-compose.yml"), "services: {}\n"),
    writeFile(path.join(stage, ".env.production.sample"), ""),
    writeFile(path.join(stage, "workspace", "AGENTS.md"), "# Workspace\n"),
    writeFile(path.join(stage, "workspace", ".agents", "README.md"), "skills\n"),
    writeFile(path.join(stage, "scripts", "dck-deploy.sh"), "#!/bin/sh\n"),
    writeFile(path.join(stage, "scripts", "migrate-automation-db.sh"), "#!/bin/sh\n"),
    writeFile(path.join(stage, "services", "webgen-control", "webgen_control.py"), "# service\n"),
    writeFile(path.join(stage, "services", "webgen-control", "requirements.txt"), "cryptography==50.0.2\nPyYAML==6.0.3\n"),
    writeFile(path.join(stage, "services", "webgen-control", "webgen-control.service"), "[Service]\n"),
  ]);
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -e
if [[ "$1 $2" == "compose version" ]]; then exit 0; fi
if [[ "$1 $2" == "compose pull" ]]; then exit 0; fi
if [[ "$1 $2" == "compose up" ]]; then exit 0; fi
if [[ "$1 $2" == "network inspect" ]]; then printf '172.17.0.1\\n'; exit 0; fi
if [[ "$1" == "images" ]]; then exit 0; fi
exit 2
`,
  );
  await writeFile(path.join(bin, "curl"), "#!/bin/sh\nprintf 200\n");
  await writeFile(
    path.join(bin, "chown"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$CHOWN_LOG\"\nexit 0\n",
  );
  await writeFile(path.join(bin, "systemctl"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(bin, "install"), "#!/bin/sh\nexit 0\n");
  await writeFile(
    path.join(bin, "python3"),
    `#!/usr/bin/env bash
set -e
if [[ "$1 $2" == "-m venv" ]]; then
  mkdir -p "$3/bin"
  printf '#!/bin/sh\\nexit 0\\n' > "$3/bin/python"
  printf '#!/bin/sh\\nexit 0\\n' > "$3/bin/pip"
  chmod +x "$3/bin/python" "$3/bin/pip"
  exit 0
fi
exit 2
`,
  );
  await Promise.all(
    ["docker", "curl", "chown", "systemctl", "install", "python3"].map((name) =>
      chmod(path.join(bin, name), 0o755),
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

describe("DCK production deploy bootstrap", () => {
  it("installs the private WebGen service without chowning the project workspace recursively", async () => {
    const { stage, target, bin, root } = await createFixture();
    const chownLog = path.join(root, "chown.log");
    await writeFile(
      path.join(stage, ".env.production.sample"),
      [
        "CANVAS_IMAGE=ghcr.io/dck-ai/dck-agentic",
        "CANVAS_IMAGE_TAG=sha-REPLACE_ME",
        "POSTGRES_USER=",
        "POSTGRES_PASSWORD=",
        "POSTGRES_DB=",
        "AUTOMATION_DB_URL=",
        "WEBGEN_CONTROL_HOST_IP=",
      ].join("\n") + "\n",
    );
    const deployScript = path.join(repositoryRoot, "scripts/dck-deploy.sh");

    const { stdout, stderr } = await execFileAsync(
      "bash",
      [deployScript, "sha-test", stage, "ghcr.io/example/dck-agentic"],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          CHOWN_LOG: chownLog,
        },
      },
    );

    const env = await readEnv(path.join(target, ".env"));
    expect(env.CANVAS_IMAGE).toBe("ghcr.io/example/dck-agentic");
    expect(env.WEBGEN_CONTROL_HOST_IP).toBe("172.17.0.1");
    expect(env.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
    const envStat = await stat(path.join(target, ".env"));
    expect(envStat.mode & 0o777).toBe(0o600);
    expect(`${stdout}${stderr}`).not.toContain(env.POSTGRES_PASSWORD);
    expect(await readFile(path.join(target, "services/webgen-control/webgen_control.py"), "utf8")).toContain("service");
    expect(await readFile(path.join(target, "webgen-control.env"), "utf8")).toContain("WEBGEN_BIND_HOST=172.17.0.1");

    await execFileAsync(
      "bash",
      [deployScript, "sha-next", stage, "ghcr.io/example/custom-dck"],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          CHOWN_LOG: chownLog,
        },
      },
    );

    const redeployedEnv = await readEnv(path.join(target, ".env"));
    expect(redeployedEnv.CANVAS_IMAGE).toBe("ghcr.io/example/custom-dck");
    expect(redeployedEnv.CANVAS_IMAGE_TAG).toBe("sha-next");
    expect(redeployedEnv.WEBGEN_CONTROL_HOST_IP).toBe("172.17.0.1");
    const chownCommands = await readFile(chownLog, "utf8");
    expect(chownCommands).toContain(`${target}/workspace/.agents`);
    expect(chownCommands).not.toMatch(/-R [^\n]*\/workspace(?:\s|$)/);
  });
});
