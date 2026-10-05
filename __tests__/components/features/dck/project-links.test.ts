import { describe, expect, it } from "vitest";
import { getDckProjectLinks } from "#/components/features/dck/project-links";
import type { DckProjectMeta } from "#/dck/project-metadata";

const ORIGIN = "https://agent.dckautoposting.com";

function makeMeta(overrides: Partial<DckProjectMeta>): DckProjectMeta {
  return {
    name: "shop",
    port: 3100,
    stack: "nextjs",
    url: "http://localhost:3100",
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

  it("returns only the localhost link when neither preview nor subdomain is set", () => {
    expect(getDckProjectLinks(makeMeta({}), ORIGIN)).toEqual([
      { kind: "local", url: "http://localhost:3100" },
    ]);
  });

  it("returns only the preview link when previewPath is set", () => {
    expect(
      getDckProjectLinks(makeMeta({ previewPath: "/preview/shop" }), ORIGIN),
    ).toEqual([
      { kind: "preview", url: "https://agent.dckautoposting.com/preview/shop/" },
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

  it("returns both the live and preview links, live first, when both are set", () => {
    expect(
      getDckProjectLinks(
        makeMeta({
          previewPath: "/preview/shop",
          subdomain: "shop.dckautoposting.com",
        }),
        ORIGIN,
      ),
    ).toEqual([
      { kind: "live", url: "https://shop.dckautoposting.com/" },
      {
        kind: "preview",
        url: "https://agent.dckautoposting.com/preview/shop/",
      },
    ]);
  });

  it("does not fall back to localhost once a published or preview link exists", () => {
    const links = getDckProjectLinks(
      makeMeta({ subdomain: "shop.dckautoposting.com" }),
      ORIGIN,
    );
    expect(links.some((link) => link.kind === "local")).toBe(false);
  });

  it("omits the preview link when no origin is available", () => {
    expect(
      getDckProjectLinks(makeMeta({ previewPath: "/preview/shop" }), null),
    ).toEqual([{ kind: "local", url: "http://localhost:3100" }]);
  });

  it("returns no links when there is no url, preview, or subdomain", () => {
    expect(
      getDckProjectLinks(makeMeta({ port: null, url: null }), ORIGIN),
    ).toEqual([]);
  });
});
