import { describe, expect, it } from "vitest";
import { getDckProjectLinks } from "#/components/features/dck/project-links";
import type { DckProjectMeta } from "#/dck/project-metadata";

const ORIGIN = "https://agent.dckautoposting.com";

function makeMeta(overrides: Partial<DckProjectMeta>): DckProjectMeta {
  return {
    name: "shop",
    port: 3100,
    stack: "nextjs",

    previewPath: null,
    subdomain: null,
    lastStatus: null,
    lastCheckedAt: null,
    ...overrides,
  };
}

describe("getDckProjectLinks", () => {
  it("returns no links when meta is null", () => {
    expect(getDckProjectLinks(null, ORIGIN)).toEqual([]);
  });

  it("does not send production users to their own localhost", () => {
    expect(getDckProjectLinks(makeMeta({}), ORIGIN)).toEqual([]);
  });

  it("does not infer a localhost URL for a local browser", () => {
    expect(getDckProjectLinks(makeMeta({}), "http://localhost:3001")).toEqual(
      [],
    );
  });

  it("returns only the preview link when previewPath is set", () => {
    expect(
      getDckProjectLinks(makeMeta({ previewPath: "/preview/shop" }), ORIGIN),
    ).toEqual([
      { kind: "preview", url: "https://agent.dckautoposting.com/preview/shop" },
    ]);
  });

  it("returns only the live link when subdomain is set", () => {
    expect(
      getDckProjectLinks(
        makeMeta({ subdomain: "shop.dckautoposting.com" }),
        ORIGIN,
      ),
    ).toEqual([{ kind: "live", url: "https://shop.dckautoposting.com/" }]);
  });

  it("does not show a stale preview link for a published build", () => {
    expect(
      getDckProjectLinks(
        makeMeta({
          previewPath: "/preview/shop",
          subdomain: "shop.dckautoposting.com",
        }),
        ORIGIN,
      ),
    ).toEqual([{ kind: "live", url: "https://shop.dckautoposting.com/" }]);
  });

  it("omits the preview link when no origin is available", () => {
    expect(
      getDckProjectLinks(makeMeta({ previewPath: "/preview/shop" }), null),
    ).toEqual([]);
  });

  it.each(["stopped", "error"] as const)(
    "hides inactive %s links",
    (lastStatus) => {
      expect(
        getDckProjectLinks(
          makeMeta({ lastStatus, previewPath: "/preview/shop" }),
          ORIGIN,
        ),
      ).toEqual([]);
    },
  );

  it("returns no links when there is no preview or subdomain", () => {
    expect(getDckProjectLinks(makeMeta({ port: null }), ORIGIN)).toEqual([]);
  });
});
