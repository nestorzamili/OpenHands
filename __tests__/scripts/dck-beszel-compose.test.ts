import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type ComposeService = {
  image?: string;
  ports?: string[];
  volumes?: string[];
  networks?: string[];
  network_mode?: string;
  profiles?: string[];
  environment?: string[];
  command?: string[];
  depends_on?: Record<string, { condition?: string }>;
  group_add?: string[];
  privileged?: boolean;
};

const compose = parse(
  readFileSync(path.resolve(process.cwd(), "docker-compose.yml"), "utf8"),
) as { services: Record<string, ComposeService> };

describe("Beszel Compose integration", () => {
  it("grants Canvas Docker access through the host socket without privileged mode", () => {
    const canvas = compose.services.canvas;

    expect(canvas.privileged).not.toBe(true);
    expect(canvas.group_add).toContain(
      "${DOCKER_GID:?Run scripts/dck-deploy.sh to configure Docker socket access}",
    );
    expect(canvas.volumes).toContain(
      "/var/run/docker.sock:/var/run/docker.sock",
    );
  });

  it("keeps the Hub private and persists its data", () => {
    const hub = compose.services.beszel;

    expect(hub.image).toBe("henrygd/beszel:0.21.0");
    expect(hub.ports).toContain("127.0.0.1:${BESZEL_PORT:-8090}:8090");
    expect(hub.volumes).toContain("./beszel-data:/beszel_data");
    expect(hub.networks).toContain("dck");
    expect(hub.environment).toContain("USER_EMAIL=${BESZEL_ADMIN_EMAIL:-}");
    expect(hub.environment).toContain(
      "USER_PASSWORD=${BESZEL_ADMIN_PASSWORD:-}",
    );
  });

  it("initializes the key and token before starting the default-stack host agent", () => {
    const initializer = compose.services["beszel-token-init"];
    const agent = compose.services["beszel-agent"];

    expect(initializer.image).toBe("node:22-alpine");
    expect(initializer.command).toContain("/app/dck-beszel-token.mjs");
    expect(initializer.volumes).toContain("./beszel-agent-data:/agent-data");
    expect(initializer.environment).toContain(
      "BESZEL_AGENT_KEY_FILE=/agent-data/public-key",
    );
    expect(initializer.environment).toContain(
      "BESZEL_AGENT_TOKEN_FILE=/agent-data/universal-token",
    );
    expect(agent.profiles).toBeUndefined();
    expect(agent.depends_on?.["beszel-token-init"]?.condition).toBe(
      "service_completed_successfully",
    );
    expect(agent.image).toBe("henrygd/beszel-agent:0.21.0");
    expect(agent.network_mode).toBe("host");
    expect(agent.environment).toContain(
      "HUB_URL=http://127.0.0.1:${BESZEL_PORT:-8090}",
    );
    expect(agent.environment).toContain(
      "KEY_FILE=/var/lib/beszel-agent/public-key",
    );
    expect(agent.environment).toContain(
      "TOKEN_FILE=/var/lib/beszel-agent/universal-token",
    );
    expect(agent.environment).toContain("DISABLE_SSH=true");
    expect(agent.environment).toContain("SYSTEM_NAME=DCK Agentic host");
    expect(agent.volumes).toContain(
      "./beszel-agent-data:/var/lib/beszel-agent",
    );
    expect(
      agent.volumes?.some((volume) => volume.includes("docker.sock")),
    ).toBe(false);
    expect(agent.ports).toBeUndefined();
  });
});
