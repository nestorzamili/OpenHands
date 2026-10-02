export type WebgenLifecycleAction = "deploy" | "rebuild" | "stop" | "delete";

export interface WebgenLifecycleContext {
  appName: string;
  port: number | null;
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

export function buildWebgenLifecycleCommand(
  action: WebgenLifecycleAction,
  context: WebgenLifecycleContext,
): string {
  const dir = appDir(context.appName);
  const enter = `cd ${dir}`;

  switch (action) {
    case "deploy":
      return [
        `Deploy the "${context.appName}" webgen app via its conversation (containerized, never on the host):`,
        `${enter} && docker compose up -d --build`,
        `then verify: ${verifySuffix(context.port)}`,
      ].join("\n");
    case "rebuild":
      return [
        `Rebuild the "${context.appName}" webgen app with a clean restart (containerized, never on the host):`,
        `${enter} && docker compose down && docker compose up -d --build`,
        `then verify: ${verifySuffix(context.port)}`,
      ].join("\n");
    case "stop":
      return [
        `Stop the "${context.appName}" webgen app:`,
        `${enter} && docker compose down`,
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
