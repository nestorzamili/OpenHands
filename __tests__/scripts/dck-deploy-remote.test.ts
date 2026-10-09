import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
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
  const root = await mkdtemp(path.join(os.tmpdir(), "dck-deploy-remote-"));
  tempDirectories.push(root);
  const stage = path.join(root, "stage");
  const bin = path.join(root, "bin");
  await Promise.all([
    mkdir(path.join(stage, "scripts"), { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  const loginInfo = path.join(root, "login-info");
  const deployInfo = path.join(root, "deploy-info");
  await writeFile(
    path.join(stage, "scripts", "dck-deploy.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
[[ -f "$DOCKER_CONFIG/config.json" ]]
echo "$DOCKER_CONFIG" > "$DEPLOY_INFO"
echo "$*" > "${deployInfo}"
`,
  );
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  login)
    token=""
    IFS= read -r token || true
    [[ "$token" == "$EXPECTED_GHCR_TOKEN" ]]
    mkdir -p "$DOCKER_CONFIG"
    printf 'temporary credentials' > "$DOCKER_CONFIG/config.json"
    echo "$DOCKER_CONFIG" > "$LOGIN_INFO"
    ;;
  logout) ;;
  *) exit 2 ;;
esac
`,
  );
  await writeFile(
    path.join(bin, "sudo"),
    `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "-n" ]]
shift
exec "$@"
`,
  );
  await Promise.all(
    ["docker", "sudo"].map((name) =>
      import("node:fs/promises").then(({ chmod }) =>
        chmod(path.join(bin, name), 0o755),
      ),
    ),
  );
  return { root, stage, bin, loginInfo, deployInfo };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("GHCR remote deploy wrapper", () => {
  it("streams the token to docker login and removes its temporary Docker config", async () => {
    const { stage, bin, loginInfo, deployInfo } = await createFixture();
    const wrapper = path.join(repositoryRoot, "scripts/dck-deploy-remote.sh");
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      EXPECTED_GHCR_TOKEN: "temporary-test-token",
      LOGIN_INFO: loginInfo,
      DEPLOY_INFO: deployInfo,
      TEST_STREAM_TOKEN: "temporary-test-token",
      TEST_TAG: "sha-abc1234",
      TEST_IMAGE: "ghcr.io/example/custom-image",
      TEST_USERNAME: "example-user",
      TEST_STAGE: stage,
    };
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [
        "-c",
        'echo "$TEST_STREAM_TOKEN" | bash "$WRAPPER" "$TEST_TAG" "$TEST_IMAGE" "$TEST_USERNAME" "$TEST_STAGE"',
      ],
      { env: { ...env, WRAPPER: wrapper } },
    );

    const configDir = (await readFile(loginInfo, "utf8")).trim();
    expect(configDir).toMatch(/^\/tmp\/dck-ghcr\./);
    expect(await readFile(deployInfo, "utf8")).toBe(
      "sha-abc1234 " + stage + " ghcr.io/example/custom-image\n",
    );
    await expect(access(configDir)).rejects.toThrow();
    expect(`${stdout}${stderr}`).not.toContain("temporary-test-token");
  });
});
