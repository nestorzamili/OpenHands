import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_HUB_URL = "http://beszel:8090";
const DEFAULT_KEY_FILE = "/agent-data/public-key";
const DEFAULT_TOKEN_FILE = "/agent-data/universal-token";
const HUB_WAIT_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 8_000;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Beszel returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForHub(hubUrl) {
  const deadline = Date.now() + HUB_WAIT_TIMEOUT_MS;
  let lastStatus = "not reachable";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${hubUrl}/api/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch {
      lastStatus = "not reachable";
    }
    await delay(2_000);
  }

  throw new Error(`Beszel Hub did not become ready (${lastStatus})`);
}

async function persistCredential(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${value}\n`, { mode: 0o600 });
  await chmod(temporaryFile, 0o600);
  await rename(temporaryFile, filePath);
}

async function readPersistedCredential(filePath) {
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function authenticateHubUser(hubUrl, email, password) {
  if (!email || !password) {
    throw new Error(
      "BESZEL_ADMIN_EMAIL and BESZEL_ADMIN_PASSWORD are required to initialize the Beszel agent key and token. For an existing Hub, set these to a Hub user account in .env.",
    );
  }

  await waitForHub(hubUrl);
  const auth = await request(
    `${hubUrl}/api/collections/users/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    },
  );
  if (typeof auth?.token !== "string" || auth.token.length === 0) {
    throw new Error("Beszel Hub did not return a user authentication token");
  }

  return auth.token;
}

async function fetchPublicKey(hubUrl, authToken) {
  const result = await request(`${hubUrl}/api/beszel/getkey`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (typeof result?.key !== "string" || result.key.trim().length === 0) {
    throw new Error("Beszel Hub did not return an agent public key");
  }
  return result.key.trim();
}

async function ensurePermanentToken(hubUrl, authToken) {
  const tokenEndpoint = `${hubUrl}/api/beszel/universal-token`;
  const headers = { Authorization: `Bearer ${authToken}` };
  const current = await request(tokenEndpoint, { headers });
  if (
    current?.active === true &&
    current?.permanent === true &&
    typeof current?.token === "string" &&
    current.token.length > 0
  ) {
    return current.token;
  }

  const enableUrl = new URL(tokenEndpoint);
  enableUrl.searchParams.set("enable", "1");
  enableUrl.searchParams.set("permanent", "1");
  if (current?.active === true && typeof current?.token === "string") {
    enableUrl.searchParams.set("token", current.token);
  }
  const result = await request(enableUrl, { headers });
  if (
    result?.active !== true ||
    result?.permanent !== true ||
    typeof result?.token !== "string" ||
    result.token.length === 0
  ) {
    throw new Error("Beszel Hub did not enable a permanent universal token");
  }
  return result.token;
}

async function main() {
  const hubUrl = (process.env.BESZEL_HUB_URL || DEFAULT_HUB_URL).replace(
    /\/$/,
    "",
  );
  const keyFile = process.env.BESZEL_AGENT_KEY_FILE || DEFAULT_KEY_FILE;
  const tokenFile = process.env.BESZEL_AGENT_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  const configuredKey = process.env.BESZEL_AGENT_KEY?.trim() || "";
  const configuredToken = process.env.BESZEL_AGENT_TOKEN?.trim() || "";

  if (configuredKey) await persistCredential(keyFile, configuredKey);
  if (configuredToken) await persistCredential(tokenFile, configuredToken);

  let publicKey =
    configuredKey || (await readPersistedCredential(keyFile));
  let token =
    configuredToken || (await readPersistedCredential(tokenFile));

  if (publicKey && token) {
    console.log(
      configuredKey && configuredToken
        ? "Using the configured Beszel agent key and token."
        : "Using the existing persistent Beszel agent key and token.",
    );
    return;
  }

  const authToken = await authenticateHubUser(
    hubUrl,
    process.env.BESZEL_ADMIN_EMAIL,
    process.env.BESZEL_ADMIN_PASSWORD,
  );

  if (!publicKey) {
    publicKey = await fetchPublicKey(hubUrl, authToken);
    await persistCredential(keyFile, publicKey);
    console.log("Fetched and persisted the Beszel agent public key.");
  }

  if (!token) {
    token = await ensurePermanentToken(hubUrl, authToken);
    await persistCredential(tokenFile, token);
    console.log("Created and persisted a permanent Beszel agent token.");
  }
}

main().catch((error) => {
  console.error(`[beszel-token-init] ${error.message}`);
  process.exitCode = 1;
});
