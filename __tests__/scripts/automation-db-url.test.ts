// @vitest-environment node

import { describe, expect, it } from "vitest";
import { requireAutomationDbUrl as requireDbUrlAutomation } from "../../scripts/dev-with-automation.mjs";
import { requireAutomationDbUrl as requireDbUrlStatic } from "../../scripts/dev-static.mjs";

const PG_URL = "postgresql+asyncpg://user:pass@localhost:5432/dck_automation";

describe.each([
  ["dev-with-automation", requireDbUrlAutomation],
  ["dev-static", requireDbUrlStatic],
])("%s requireAutomationDbUrl", (_name, requireAutomationDbUrl) => {
  it("returns a valid postgresql+asyncpg URL unchanged", () => {
    expect(requireAutomationDbUrl({ AUTOMATION_DB_URL: PG_URL })).toBe(PG_URL);
  });

  it("throws when AUTOMATION_DB_URL is missing", () => {
    expect(() => requireAutomationDbUrl({})).toThrow("AUTOMATION_DB_URL");
  });

  it("throws when AUTOMATION_DB_URL is blank", () => {
    expect(() => requireAutomationDbUrl({ AUTOMATION_DB_URL: "  " })).toThrow(
      "AUTOMATION_DB_URL",
    );
  });

  it("throws for non-PostgreSQL drivers", () => {
    expect(() =>
      requireAutomationDbUrl({
        AUTOMATION_DB_URL: "sqlite+aiosqlite:///tmp/automations.db",
      }),
    ).toThrow("postgresql+asyncpg");
  });
});
