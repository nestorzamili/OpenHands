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
  const dockerSocketPath = path.join(root, "docker.sock");
  await execFileAsync("python3", [
    "-c",
    "import socket, sys; s = socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()",
    dockerSocketPath,
  ]);
  await chmod(dockerSocketPath, 0o660);
  await Promise.all([
    mkdir(path.join(stage, "scripts"), { recursive: true }),
    mkdir(path.join(stage, "workspace", ".agents"), { recursive: true }),
    mkdir(path.join(stage, "services", "webgen-control"), { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(stage, "docker-compose.yml"),
      "services:\n  postgres:\n    container_name: dck-postgres\n",
    ),
    writeFile(path.join(stage, ".env.production.sample"), ""),
    writeFile(path.join(stage, "workspace", "AGENTS.md"), "# Workspace\n"),
    writeFile(
      path.join(stage, "workspace", ".agents", "README.md"),
      "skills\n",
    ),
    writeFile(path.join(stage, "scripts", "dck-deploy.sh"), "#!/bin/sh\n"),
    writeFile(path.join(stage, "scripts", "sync-managed-skills.py"), ""),
    writeFile(
      path.join(stage, "services", "webgen-control", "webgen_control.py"),
      "# service\n",
    ),
    writeFile(
      path.join(stage, "services", "webgen-control", "webgen_migrations.py"),
      "# migrations\n",
    ),
    writeFile(
      path.join(stage, "services", "webgen-control", "requirements.txt"),
      "cryptography==50.0.2\nPyYAML==6.0.3\n",
    ),
    writeFile(
      path.join(stage, "services", "webgen-control", "webgen-control.service"),
      "[Service]\n",
    ),
  ]);
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${root}/docker.log"
if [[ "$1 $2 $3 $4 $5" == "compose exec -T canvas docker" ]]; then exit "\${DOCKER_CLI_PROBE_EXIT:-0}"; fi
if [[ "$1 $2 $3" == "compose exec -T" ]]; then exit "\${WEBGEN_PROBE_EXIT:-0}"; fi
if [[ "$1 $2" == "compose version" ]]; then exit 0; fi
if [[ "$1 $2" == "compose pull" ]]; then exit 0; fi
if [[ "$1 $2" == "compose up" ]]; then exit 0; fi
if [[ "$1 $2" == "network inspect" ]]; then
  if [[ "$3" == "bridge" ]]; then printf '172.17.0.1\\n';
  elif [[ "$5" == *'.Id'* ]]; then printf 'abc123def4567890\\n';
  elif [[ "$5" == *'.Subnet'* ]]; then printf '172.21.0.0/16\\n';
  elif [[ "$5" == *'.Options'* ]]; then printf '\\n';
  else exit 2; fi
  exit 0
fi
if [[ "$1" == "images" ]]; then exit 0; fi
exit 2
`,
  );
  await writeFile(
    path.join(bin, "ufw"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${root}/ufw.log"
if [[ "$1" == "status" ]]; then printf 'Status: %s\\n' "\${UFW_STATE:-inactive}"; fi
`,
  );
  await writeFile(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(bin, "curl"), "#!/bin/sh\nprintf 200\n");
  await writeFile(
    path.join(bin, "chown"),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$CHOWN_LOG"\nexit 0\n',
  );
  await writeFile(
    path.join(bin, "systemctl"),
    `#!/usr/bin/env bash
set -e
if [[ "$1 $2" == "restart webgen-control.service" && ! -e "$WEBGEN_STATE_DIR/webgen-control.key" ]]; then
  mkdir -p "$WEBGEN_STATE_DIR"
  head -c 32 /dev/zero > "$WEBGEN_STATE_DIR/webgen-control.key"
  chmod 600 "$WEBGEN_STATE_DIR/webgen-control.key"
fi
`,
  );
  await writeFile(
    path.join(bin, "install"),
    `#!/usr/bin/env bash
set -e
target="\${@: -1}"
if [[ "$1" == "-d" ]]; then
  for argument in "$@"; do
    if [[ "$argument" == "$WEBGEN_STATE_DIR" ]]; then mkdir -p "$argument"; chmod 700 "$argument"; fi
  done
  exit 0
fi
if [[ "$target" == "$WEBGEN_STATE_DIR"/* ]]; then
  source="\${@: -2:1}"
  cp "$source" "$target"
  chmod 600 "$target"
fi
exit 0
`,
  );
  await writeFile(
    path.join(bin, "stat"),
    `#!/usr/bin/env bash
if [[ "$1" == "-c" && "$2" == "%a:%u" && "$3" == "$WEBGEN_STATE_DIR/webgen-control.key" ]]; then echo 600:0; exit 0; fi
if [[ "$1" == "-c" && "$2" == "%s" && "$3" == "$WEBGEN_STATE_DIR/webgen-control.key" ]]; then wc -c < "$3"; exit 0; fi
if [[ "$1" == "-c" && "$2" == "%g" && "$3" == "$DOCKER_SOCKET_PATH" ]]; then echo "\${TEST_SOCKET_GID:-23456}"; exit 0; fi
exec /usr/bin/stat "$@"
`,
  );
  await writeFile(
    path.join(bin, "python3"),
    `#!/usr/bin/env bash
set -e
if [[ "$1" == */sync-managed-skills.py ]]; then mkdir -p "$3"; exit 0; fi
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
    [
      "docker",
      "curl",
      "chown",
      "systemctl",
      "install",
      "stat",
      "python3",
      "ufw",
      "sleep",
    ].map((name) => chmod(path.join(bin, name), 0o755)),
  );
  return { root, stage, target, bin, dockerSocketPath };
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
    const { stage, target, bin, root, dockerSocketPath } =
      await createFixture();
    await mkdir(path.join(target, "config"), { recursive: true });
    const legacyKey = Buffer.alloc(32, 23);
    await writeFile(
      path.join(target, "config", "webgen-control.key"),
      legacyKey,
    );
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
          DOCKER_SOCKET_PATH: dockerSocketPath,
          WEBGEN_STATE_DIR: path.join(root, "webgen-state"),
          CHOWN_LOG: chownLog,
          UFW_STATE: "active",
        },
      },
    );

    expect(await readFile(path.join(root, "ufw.log"), "utf8")).toContain(
      "allow in on br-abc123def456 from 172.21.0.0/16 to 172.17.0.1 port 8769 proto tcp",
    );
    expect(await readFile(path.join(root, "docker.log"), "utf8")).toContain(
      "compose exec -T canvas python",
    );
    const dockerLog = await readFile(path.join(root, "docker.log"), "utf8");
    expect(dockerLog).toContain("compose exec -T canvas docker version");
    expect(dockerLog).toContain("compose exec -T canvas docker ps");
    const env = await readEnv(path.join(target, ".env"));
    expect(env.DOCKER_SOCKET_PATH).toBe(dockerSocketPath);
    expect(env.DOCKER_SOCKET_GID).toBe("23456");
    expect(env.CANVAS_IMAGE).toBe("ghcr.io/example/dck-agentic");
    expect(env.WEBGEN_CONTROL_HOST_IP).toBe("172.17.0.1");
    expect(env.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
    const migratedKey = path.join(root, "webgen-state", "webgen-control.key");
    expect(await readFile(migratedKey)).toEqual(legacyKey);
    expect((await stat(migratedKey)).mode & 0o777).toBe(0o600);
    await expect(
      readFile(path.join(target, "config", "webgen-control.key")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const envStat = await stat(path.join(target, ".env"));
    expect(envStat.mode & 0o777).toBe(0o600);
    expect(`${stdout}${stderr}`).not.toContain(env.POSTGRES_PASSWORD);
    expect(
      await readFile(
        path.join(target, "services/webgen-control/webgen_control.py"),
        "utf8",
      ),
    ).toContain("service");
    expect(
      await readFile(path.join(target, "webgen-control.env"), "utf8"),
    ).toContain("WEBGEN_BIND_HOST=172.17.0.1");
    const deploySource = await readFile(deployScript, "utf8");
    const nginxDirectoryProvisioning = deploySource.indexOf(
      "install -d -m 0755 /etc/nginx/dck-apps",
    );
    const serviceRestart = deploySource.indexOf(
      "systemctl restart webgen-control.service",
    );
    expect(nginxDirectoryProvisioning).toBeGreaterThanOrEqual(0);
    expect(nginxDirectoryProvisioning).toBeLessThan(serviceRestart);

    await execFileAsync(
      "bash",
      [deployScript, "sha-next", stage, "ghcr.io/example/custom-dck"],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          DOCKER_SOCKET_PATH: dockerSocketPath,
          WEBGEN_STATE_DIR: path.join(root, "webgen-state"),
          CHOWN_LOG: chownLog,
          UFW_STATE: "active",
          TEST_SOCKET_GID: "34567",
        },
      },
    );

    const redeployedEnv = await readEnv(path.join(target, ".env"));
    expect(redeployedEnv.CANVAS_IMAGE).toBe("ghcr.io/example/custom-dck");
    expect(redeployedEnv.CANVAS_IMAGE_TAG).toBe("sha-next");
    expect(redeployedEnv.WEBGEN_CONTROL_HOST_IP).toBe("172.17.0.1");
    expect(redeployedEnv.DOCKER_SOCKET_GID).toBe("34567");
    const chownCommands = await readFile(chownLog, "utf8");
    expect(chownCommands).toContain(`${target}/workspace/.agents`);
    expect(chownCommands).not.toMatch(/-R [^\n]*\/workspace(?:\s|$)/);
  });
});

it("stops before Canvas config ownership changes when legacy and private keys conflict", async () => {
  const { stage, target, bin, root, dockerSocketPath } = await createFixture();
  const state = path.join(root, "webgen-state");
  const config = path.join(target, "config");
  await Promise.all([
    mkdir(config, { recursive: true }),
    mkdir(state, { recursive: true }),
  ]);
  const privateKey = Buffer.alloc(32, 1);
  const legacyKey = Buffer.alloc(32, 2);
  await Promise.all([
    writeFile(path.join(state, "webgen-control.key"), privateKey),
    writeFile(path.join(config, "webgen-control.key"), legacyKey),
  ]);

  await expect(
    execFileAsync(
      "bash",
      [
        path.join(repositoryRoot, "scripts/dck-deploy.sh"),
        "sha-test",
        stage,
        "ghcr.io/example/dck-agentic",
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          DOCKER_SOCKET_PATH: dockerSocketPath,
          WEBGEN_STATE_DIR: state,
          CHOWN_LOG: path.join(root, "chown.log"),
        },
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
  expect(await readFile(path.join(state, "webgen-control.key"))).toEqual(
    privateKey,
  );
  expect(await readFile(path.join(config, "webgen-control.key"))).toEqual(
    legacyKey,
  );
  expect(await readFile(path.join(root, "chown.log"), "utf8")).not.toContain(
    config,
  );
});

it("rolls back when Canvas cannot reach WebGen even though host health checks pass", async () => {
  const { stage, target, bin, root, dockerSocketPath } = await createFixture();
  await mkdir(target, { recursive: true });
  await writeFile(
    path.join(target, ".env"),
    "CANVAS_IMAGE=ghcr.io/example/dck-agentic\nCANVAS_IMAGE_TAG=sha-old\nPOSTGRES_USER=dck\n",
  );
  await expect(
    execFileAsync(
      "bash",
      [path.join(repositoryRoot, "scripts/dck-deploy.sh"), "sha-new", stage],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          DOCKER_SOCKET_PATH: dockerSocketPath,
          WEBGEN_STATE_DIR: path.join(root, "webgen-state"),
          CHOWN_LOG: path.join(root, "chown.log"),
          UFW_STATE: "inactive",
          WEBGEN_PROBE_EXIT: "1",
        },
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
  expect((await readEnv(path.join(target, ".env"))).CANVAS_IMAGE_TAG).toBe(
    "sha-old",
  );
  expect(await readFile(path.join(root, "ufw.log"), "utf8")).not.toContain(
    "allow",
  );
});

describe("Docker socket prerequisite", () => {
  it.each(["missing", "regular-file"])(
    "rejects a %s socket before creating the target",
    async (invalidSocket) => {
      const { stage, target, bin, root, dockerSocketPath } =
        await createFixture();
      let configuredSocket = dockerSocketPath;
      if (invalidSocket === "missing") {
        configuredSocket = path.join(root, "missing.sock");
      } else if (invalidSocket === "regular-file") {
        await rm(dockerSocketPath);
        await writeFile(dockerSocketPath, "not a socket");
      }

      await expect(
        execFileAsync(
          "bash",
          [
            path.join(repositoryRoot, "scripts/dck-deploy.sh"),
            "sha-test",
            stage,
          ],
          {
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              TARGET_DIR: target,
              DOCKER_SOCKET_PATH: configuredSocket,
              WEBGEN_STATE_DIR: path.join(root, "webgen-state"),
              CHOWN_LOG: path.join(root, "chown.log"),
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("adds only missing group read/write bits to a valid socket", async () => {
    const { stage, target, bin, root, dockerSocketPath } =
      await createFixture();
    await chmod(dockerSocketPath, 0o640);
    await writeFile(
      path.join(stage, ".env.production.sample"),
      [
        "CANVAS_IMAGE=ghcr.io/example/dck-agentic",
        "CANVAS_IMAGE_TAG=sha-test",
        "POSTGRES_USER=dck",
        "POSTGRES_PASSWORD=fixture-password",
        "POSTGRES_DB=dck_agentic",
        "AUTOMATION_DB_URL=postgresql+asyncpg://dck:fixture-password@postgres:5432/dck_agentic",
        "WEBGEN_CONTROL_HOST_IP=",
      ].join("\n") + "\n",
    );

    await execFileAsync(
      "bash",
      [
        path.join(repositoryRoot, "scripts/dck-deploy.sh"),
        "sha-test",
        stage,
        "ghcr.io/example/dck-agentic",
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          DOCKER_SOCKET_PATH: dockerSocketPath,
          WEBGEN_STATE_DIR: path.join(root, "webgen-state"),
          CHOWN_LOG: path.join(root, "chown.log"),
          UFW_STATE: "inactive",
        },
      },
    );

    const mode = (await stat(dockerSocketPath)).mode & 0o777;
    expect(mode & 0o060).toBe(0o060);
    expect(mode & 0o707).toBe(0o600);
  });
});

it("rolls back when the in-container Docker CLI probe fails", async () => {
  const { stage, target, bin, root, dockerSocketPath } = await createFixture();
  await mkdir(target, { recursive: true });
  await writeFile(
    path.join(target, ".env"),
    "CANVAS_IMAGE=ghcr.io/example/dck-agentic\nCANVAS_IMAGE_TAG=sha-old\nPOSTGRES_USER=dck\n",
  );
  await expect(
    execFileAsync(
      "bash",
      [path.join(repositoryRoot, "scripts/dck-deploy.sh"), "sha-new", stage],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TARGET_DIR: target,
          DOCKER_SOCKET_PATH: dockerSocketPath,
          WEBGEN_STATE_DIR: path.join(root, "webgen-state"),
          CHOWN_LOG: path.join(root, "chown.log"),
          UFW_STATE: "inactive",
          DOCKER_CLI_PROBE_EXIT: "1",
        },
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
  expect((await readEnv(path.join(target, ".env"))).CANVAS_IMAGE_TAG).toBe(
    "sha-old",
  );
});
