import { describe, it, expect } from "vitest";
import {
  buildWebgenScaffoldPrompt,
  validateWebgenAppName,
} from "#/dck/webgen-new-project";
import { I18nKey } from "#/i18n/declaration";

describe("validateWebgenAppName", () => {
  it("rejects an empty / whitespace-only name as required", () => {
    expect(validateWebgenAppName("", [])).toEqual({
      valid: false,
      errorKey: I18nKey.DCK$NEW_PROJECT_NAME_REQUIRED,
    });
    expect(validateWebgenAppName("   ", [])).toEqual({
      valid: false,
      errorKey: I18nKey.DCK$NEW_PROJECT_NAME_REQUIRED,
    });
  });

  it("rejects names that break the slug rule", () => {
    // Uppercase, spaces, leading hyphen, and underscores are all invalid.
    for (const bad of ["Shop", "my app", "-shop", "my_app", "shop!"]) {
      expect(validateWebgenAppName(bad, []).errorKey).toBe(
        I18nKey.DCK$NEW_PROJECT_NAME_INVALID,
      );
    }
  });

  it("rejects a name longer than 64 characters", () => {
    expect(validateWebgenAppName("a".repeat(65), []).errorKey).toBe(
      I18nKey.DCK$NEW_PROJECT_NAME_INVALID,
    );
  });

  it("rejects a name that collides with an existing project (case-insensitive)", () => {
    expect(validateWebgenAppName("shop", ["Shop"]).errorKey).toBe(
      I18nKey.DCK$NEW_PROJECT_NAME_TAKEN,
    );
  });

  it("accepts a valid, unique slug", () => {
    expect(validateWebgenAppName("my-shop-2", ["other"])).toEqual({
      valid: true,
      errorKey: null,
    });
  });
});

describe("buildWebgenScaffoldPrompt", () => {
  it("names the app and tells the agent not to ask again", () => {
    const prompt = buildWebgenScaffoldPrompt({
      name: "my-shop",
      description: "",
      needsDatabase: false,
      needsAuth: false,
    });
    expect(prompt).toContain('"my-shop"');
    expect(prompt).toMatch(/do not ask/i);
    expect(prompt).toContain("- App name: my-shop");
  });

  it("reflects the database and auth toggles in the spec lines", () => {
    const withBoth = buildWebgenScaffoldPrompt({
      name: "shop",
      description: "",
      needsDatabase: true,
      needsAuth: true,
    });
    expect(withBoth).toMatch(/Database: yes/);
    expect(withBoth).toMatch(/Auth \/ login: yes/);

    const withNeither = buildWebgenScaffoldPrompt({
      name: "shop",
      description: "",
      needsDatabase: false,
      needsAuth: false,
    });
    expect(withNeither).toMatch(/Database: no/);
    expect(withNeither).toMatch(/Auth \/ login: no/);
  });

  it("includes a trimmed description only when provided", () => {
    const withDesc = buildWebgenScaffoldPrompt({
      name: "shop",
      description: "  a store for shoes  ",
      needsDatabase: false,
      needsAuth: false,
    });
    expect(withDesc).toContain("- Purpose: a store for shoes");

    const withoutDesc = buildWebgenScaffoldPrompt({
      name: "shop",
      description: "   ",
      needsDatabase: false,
      needsAuth: false,
    });
    expect(withoutDesc).not.toMatch(/Purpose:/);
  });
});
