import { describe, expect, it } from "vitest";
import { parseDckProjectMeta, projectUrlForPort } from "#/dck/project-metadata";

describe("parseDckProjectMeta", () => {
  it("parses a complete .dck.json and derives the localhost url", () => {
    const result = parseDckProjectMeta(
      JSON.stringify({ name: "dck-landing", port: 3000, stack: "nextjs" }),
    );
    expect(result).toEqual({
      name: "dck-landing",
      port: 3000,
      stack: "nextjs",
      url: "http://localhost:3000",
    });
  });

  it("coerces a stringified port and trims strings", () => {
    const result = parseDckProjectMeta(
      JSON.stringify({ name: "  shop  ", port: "3100", stack: "  nextjs " }),
    );
    expect(result).toEqual({
      name: "shop",
      port: 3100,
      stack: "nextjs",
      url: "http://localhost:3100",
    });
  });

  it("returns null fields and no url when values are missing or invalid", () => {
    const result = parseDckProjectMeta(JSON.stringify({ port: 0, stack: "" }));
    expect(result).toEqual({
      name: null,
      port: null,
      stack: null,
      url: null,
    });
  });

  it("returns null for malformed JSON", () => {
    expect(parseDckProjectMeta("{ not json")).toBeNull();
  });

  it("returns null for empty or missing input", () => {
    expect(parseDckProjectMeta("")).toBeNull();
    expect(parseDckProjectMeta(null)).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseDckProjectMeta(JSON.stringify(["a", "b"]))).toBeNull();
    expect(parseDckProjectMeta(JSON.stringify("string"))).toBeNull();
  });
});

describe("projectUrlForPort", () => {
  it.each([
    [3000, "http://localhost:3000"],
    [8080, "http://localhost:8080"],
    [null, null],
  ])("maps port %s to %s", (port, expected) => {
    expect(projectUrlForPort(port)).toBe(expected);
  });
});
