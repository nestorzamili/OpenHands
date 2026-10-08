import { spawn } from "node:child_process";
import { createServer, type RequestListener } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/dck-beszel-token.mjs",
);
const servers: ReturnType<typeof createServer>[] = [];
const tempDirectories: string[] = [];

function runTokenScript(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dck-beszel-token-"));
  tempDirectories.push(directory);
  return directory;
}

function startMockHub(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  return new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("No server port");
      }
      resolve(address.port);
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Beszel token initializer", () => {
  it("fetches the Hub public key, enables a permanent token, and persists both", async () => {
    let authPayload: { identity?: string; password?: string } | undefined;
    let universalTokenCalls = 0;
    const port = await startMockHub(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/api/health") {
        res.end(JSON.stringify({ code: 200 }));
        return;
      }
      if (req.url === "/api/collections/users/auth-with-password") {
        authPayload = JSON.parse(body) as typeof authPayload;
        res.end(JSON.stringify({ token: "mock-user-jwt" }));
        return;
      }
      if (req.url === "/api/beszel/getkey") {
        expect(req.headers.authorization).toBe("Bearer mock-user-jwt");
        res.end(
          JSON.stringify({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAATEST" }),
        );
        return;
      }
      if (req.url?.startsWith("/api/beszel/universal-token")) {
        universalTokenCalls += 1;
        expect(req.headers.authorization).toBe("Bearer mock-user-jwt");
        if (!req.url.includes("enable=1")) {
          res.end(
            JSON.stringify({ active: false, permanent: false, token: "" }),
          );
          return;
        }
        const query = new URL(req.url, "http://localhost").searchParams;
        expect(query.get("permanent")).toBe("1");
        res.end(
          JSON.stringify({
            active: true,
            permanent: true,
            token: "generated-universal-token",
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    const directory = await temporaryDirectory();
    const keyFile = path.join(directory, "public-key");
    const tokenFile = path.join(directory, "universal-token");
    const result = await runTokenScript({
      BESZEL_HUB_URL: `http://127.0.0.1:${port}`,
      BESZEL_ADMIN_EMAIL: "admin@example.test",
      BESZEL_ADMIN_PASSWORD: "do-not-print-this-password",
      BESZEL_AGENT_KEY: "",
      BESZEL_AGENT_KEY_FILE: keyFile,
      BESZEL_AGENT_TOKEN: "",
      BESZEL_AGENT_TOKEN_FILE: tokenFile,
    });

    expect(result.code).toBe(0);
    expect(authPayload).toEqual({
      identity: "admin@example.test",
      password: "do-not-print-this-password",
    });
    expect(universalTokenCalls).toBe(2);
    expect(await readFile(keyFile, "utf8")).toBe(
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAATEST\n",
    );
    expect(await readFile(tokenFile, "utf8")).toBe(
      "generated-universal-token\n",
    );
    expect(result.stdout + result.stderr).not.toContain(
      "do-not-print-this-password",
    );
  });

  it("writes configured key and token without contacting the Hub", async () => {
    const directory = await temporaryDirectory();
    const keyFile = path.join(directory, "public-key");
    const tokenFile = path.join(directory, "universal-token");
    const result = await runTokenScript({
      BESZEL_HUB_URL: "http://127.0.0.1:1",
      BESZEL_AGENT_KEY: "ssh-ed25519 configured-public-key",
      BESZEL_AGENT_KEY_FILE: keyFile,
      BESZEL_AGENT_TOKEN: "configured-token",
      BESZEL_AGENT_TOKEN_FILE: tokenFile,
    });

    expect(result.code).toBe(0);
    expect(await readFile(keyFile, "utf8")).toBe(
      "ssh-ed25519 configured-public-key\n",
    );
    expect(await readFile(tokenFile, "utf8")).toBe("configured-token\n");
  });

  it("reuses persisted key and token on restart without contacting the Hub", async () => {
    const directory = await temporaryDirectory();
    const keyFile = path.join(directory, "public-key");
    const tokenFile = path.join(directory, "universal-token");
    await writeFile(keyFile, "ssh-ed25519 persisted-public-key\n", {
      mode: 0o600,
    });
    await writeFile(tokenFile, "persisted-token\n", { mode: 0o600 });
    const result = await runTokenScript({
      BESZEL_HUB_URL: "http://127.0.0.1:1",
      BESZEL_ADMIN_EMAIL: "",
      BESZEL_ADMIN_PASSWORD: "",
      BESZEL_AGENT_KEY: "",
      BESZEL_AGENT_KEY_FILE: keyFile,
      BESZEL_AGENT_TOKEN: "",
      BESZEL_AGENT_TOKEN_FILE: tokenFile,
    });

    expect(result.code).toBe(0);
    expect(await readFile(keyFile, "utf8")).toBe(
      "ssh-ed25519 persisted-public-key\n",
    );
    expect(await readFile(tokenFile, "utf8")).toBe("persisted-token\n");
    expect(result.stdout).toContain(
      "existing persistent Beszel agent key and token",
    );
  });

  it("fills a missing public key while reusing an existing token", async () => {
    let universalTokenCalls = 0;
    const port = await startMockHub(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/api/health") {
        res.end(JSON.stringify({ code: 200 }));
      } else if (req.url === "/api/collections/users/auth-with-password") {
        res.end(JSON.stringify({ token: "mock-user-jwt" }));
      } else if (req.url === "/api/beszel/getkey") {
        expect(req.headers.authorization).toBe("Bearer mock-user-jwt");
        res.end(JSON.stringify({ key: "ssh-ed25519 recovered-public-key" }));
      } else if (req.url?.startsWith("/api/beszel/universal-token")) {
        universalTokenCalls += 1;
        res.writeHead(500).end();
      } else {
        res.writeHead(404).end();
      }
    });

    const directory = await temporaryDirectory();
    const keyFile = path.join(directory, "public-key");
    const tokenFile = path.join(directory, "universal-token");
    await writeFile(tokenFile, "persisted-token\n", { mode: 0o600 });
    const result = await runTokenScript({
      BESZEL_HUB_URL: `http://127.0.0.1:${port}`,
      BESZEL_ADMIN_EMAIL: "admin@example.test",
      BESZEL_ADMIN_PASSWORD: "test-password",
      BESZEL_AGENT_KEY: "",
      BESZEL_AGENT_KEY_FILE: keyFile,
      BESZEL_AGENT_TOKEN: "",
      BESZEL_AGENT_TOKEN_FILE: tokenFile,
    });

    expect(result.code).toBe(0);
    expect(universalTokenCalls).toBe(0);
    expect(await readFile(keyFile, "utf8")).toBe(
      "ssh-ed25519 recovered-public-key\n",
    );
    expect(await readFile(tokenFile, "utf8")).toBe("persisted-token\n");
  });
});
