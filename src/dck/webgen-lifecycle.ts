export type WebgenLifecycleAction = "deploy" | "rebuild" | "stop" | "delete";

export interface WebgenLifecycleContext {
  appName: string;
  port: number | null;
  ownerSeedVerificationKey?: string;
}

function appDir(appName: string): string {
  return `webgen/${appName}`;
}

function verifySuffix(port: number | null): string {
  const healthCheck =
    port === null
      ? "curl -s http://localhost:<port>/"
      : `curl -s http://localhost:${port}/`;
  return [
    "docker compose ps",
    "docker compose logs -n 50 app",
    healthCheck,
  ].join(" && ");
}

export function addWebgenOwnerSeedVerificationKey(
  command: string,
  verificationKey: string,
): string {
  return [
    command,
    "",
    "DCK owner-seed integration: ensure the app has the signed one-time Better Auth owner-bootstrap route from the web-generator skill and advertises its verification key from the health endpoint. Use only this public key (never a password or other credential):",
    verificationKey,
    "Disable public sign-up and use Better Auth server APIs to create the first owner only after the authenticated DCK deploy flow posts a valid signature. Never ask for or place credential values in this conversation, source, .env, logs, or analytics.",
  ].join("\n");
}

function withOwnerSeedInstructions(
  command: string,
  context: WebgenLifecycleContext,
): string {
  return context.ownerSeedVerificationKey
    ? addWebgenOwnerSeedVerificationKey(
        command,
        context.ownerSeedVerificationKey,
      )
    : command;
}

export function buildWebgenLifecycleCommand(
  action: WebgenLifecycleAction,
  context: WebgenLifecycleContext,
): string {
  const dir = appDir(context.appName);
  const enter = `cd ${dir}`;

  switch (action) {
    case "deploy":
      return withOwnerSeedInstructions(
        [
          `Deploy the "${context.appName}" webgen app via its conversation (containerized, never on the host):`,
          `${enter} && docker compose up -d --build`,
          `then verify: ${verifySuffix(context.port)}`,
          `then update ${dir}/.dck.json: set "lastStatus" to "running" if healthy (else "error") and "lastCheckedAt" to the current ISO-8601 UTC time.`,
        ].join("\n"),
        context,
      );
    case "rebuild":
      return withOwnerSeedInstructions(
        [
          `Rebuild the "${context.appName}" webgen app with a clean restart (containerized, never on the host):`,
          `${enter} && docker compose down && docker compose up -d --build`,
          `then verify: ${verifySuffix(context.port)}`,
          `then update ${dir}/.dck.json: set "lastStatus" to "running" if healthy (else "error") and "lastCheckedAt" to the current ISO-8601 UTC time.`,
        ].join("\n"),
        context,
      );
    case "stop":
      return [
        `Stop the "${context.appName}" webgen app:`,
        `${enter} && docker compose down`,
        `then update ${dir}/.dck.json: set "lastStatus" to "stopped" and "lastCheckedAt" to the current ISO-8601 UTC time.`,
      ].join("\n");
    case "delete":
      return [
        `Delete the "${context.appName}" webgen app and all of its local containers, volumes, and locally built images:`,
        `${enter} && docker compose down -v --rmi local`,
        "This is destructive and irreversible for this app's data. Confirm the app name before running.",
      ].join("\n");
    default:
      return "";
  }
}
