import { describe, expect, it } from "vitest";
import {
  isOwnerSeedReentryRequired,
  WebgenOwnerSeedServiceError,
} from "#/dck/webgen-owner-seed-service";

describe("Webgen owner-seed service error handling", () => {
  it("requests fresh credentials only when the staged capability has expired", () => {
    expect(
      isOwnerSeedReentryRequired(new WebgenOwnerSeedServiceError(410)),
    ).toBe(true);
    expect(
      isOwnerSeedReentryRequired(new WebgenOwnerSeedServiceError(409)),
    ).toBe(false);
    expect(isOwnerSeedReentryRequired(new Error("request failed"))).toBe(false);
  });

  it("uses fixed safe messages rather than reflecting request or server bodies", () => {
    const error = new WebgenOwnerSeedServiceError(500);
    expect(error.message).toBe(
      "Secure owner provisioning could not be prepared. Please try again.",
    );
    expect(error.message).not.toContain("dummy-password-123456");
  });
});
