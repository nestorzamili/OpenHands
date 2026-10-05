import { describe, expect, it } from "vitest";
import {
  buildPreviewUrl,
  buildPublishedUrl,
  parseDckProjectMeta,
  projectUrlForPort,
} from "#/dck/project-metadata";

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
      previewPath: null,
      subdomain: null,
      lastStatus: null,
      lastCheckedAt: null,
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
      previewPath: null,
      subdomain: null,
      lastStatus: null,
      lastCheckedAt: null,
    });
  });

  it("parses the preview path and published subdomain when present", () => {
    const result = parseDckProjectMeta(
      JSON.stringify({
        name: "shop",
        port: 3100,
        stack: "nextjs",
        previewPath: "/preview/shop",
        subdomain: "shop.dckautoposting.com",
      }),
    );
    expect(result?.previewPath).toBe("/preview/shop");
    expect(result?.subdomain).toBe("shop.dckautoposting.com");
  });

  it("coerces blank or non-string preview/subdomain values to null", () => {
    const result = parseDckProjectMeta(
      JSON.stringify({
        name: "shop",
        port: 3100,
        previewPath: "   ",
        subdomain: 123,
      }),
    );
    expect(result?.previewPath).toBeNull();
    expect(result?.subdomain).toBeNull();
  });

  it("parses the agent-written runtime status and verification timestamp", () => {
    const result = parseDckProjectMeta(
      JSON.stringify({
        name: "shop",
        port: 3100,
        stack: "nextjs",
        lastStatus: "RUNNING",
        lastCheckedAt: "2026-01-15T09:30:00Z",
      }),
    );
    expect(result?.lastStatus).toBe("running");
    expect(result?.lastCheckedAt).toBe("2026-01-15T09:30:00Z");
  });

  it("ignores an unrecognized runtime status", () => {
    const result = parseDckProjectMeta(
      JSON.stringify({ name: "shop", port: 3100, lastStatus: "exploded" }),
    );
    expect(result?.lastStatus).toBeNull();
  });

  it("returns null fields and no url when values are missing or invalid", () => {
    const result = parseDckProjectMeta(JSON.stringify({ port: 0, stack: "" }));
    expect(result).toEqual({
      name: null,
      port: null,
      stack: null,
      url: null,
      previewPath: null,
      subdomain: null,
      lastStatus: null,
      lastCheckedAt: null,
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

describe("buildPreviewUrl", () => {
  it("composes the preview path against the browser origin with a single trailing slash", () => {
    expect(
      buildPreviewUrl("/preview/shop", "https://agent.dckautoposting.com"),
    ).toBe("https://agent.dckautoposting.com/preview/shop/");
  });

  it("adds a leading slash and strips a trailing origin slash", () => {
    expect(
      buildPreviewUrl("preview/shop/", "https://agent.dckautoposting.com/"),
    ).toBe("https://agent.dckautoposting.com/preview/shop/");
  });

  it("returns null when the path or origin is missing", () => {
    expect(buildPreviewUrl(null, "https://agent.dckautoposting.com")).toBeNull();
    expect(buildPreviewUrl("   ", "https://agent.dckautoposting.com")).toBeNull();
    expect(buildPreviewUrl("/preview/shop", null)).toBeNull();
    expect(buildPreviewUrl("/preview/shop", "   ")).toBeNull();
  });
});

describe("buildPublishedUrl", () => {
  it("wraps a full subdomain FQDN in https with a trailing slash", () => {
    expect(buildPublishedUrl("shop.dckautoposting.com")).toBe(
      "https://shop.dckautoposting.com/",
    );
  });

  it("strips any trailing slash from the stored subdomain", () => {
    expect(buildPublishedUrl("shop.dckautoposting.com/")).toBe(
      "https://shop.dckautoposting.com/",
    );
  });

  it("returns null for a missing or blank subdomain", () => {
    expect(buildPublishedUrl(null)).toBeNull();
    expect(buildPublishedUrl("   ")).toBeNull();
  });
});
