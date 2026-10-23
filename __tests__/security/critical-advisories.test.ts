import { describe, expect, it } from "vitest";
import { quote } from "shell-quote";
import { createRequire } from "node:module";
import createDOMPurify from "dompurify";

// This transitive CommonJS dependency does not bundle TypeScript declarations.
const proxyaddr = createRequire(import.meta.url)("proxy-addr") as {
  (
    request: {
      headers: Record<string, string>;
      socket: { remoteAddress: string };
    },
    trust: (address: string) => boolean,
  ): string;
  compile(subnet: string): (address: string) => boolean;
};

describe("critical dependency advisory regressions", () => {
  it("rejects line terminators in shell-quote tokens after a comment token", () => {
    expect(() => quote(["echo", "ok", { comment: "x" }, "a\nid;#"])).toThrow(
      TypeError,
    );
  });

  it("removes template expressions reconstituted in an attached shadow root", () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.append(document.createTextNode("$"));
    shadowRoot.append(document.createElement("object"));
    shadowRoot.append(document.createTextNode("{alert(document.domain)}"));

    createDOMPurify(window).sanitize(host, {
      IN_PLACE: true,
      SAFE_FOR_TEMPLATES: true,
    });

    expect(shadowRoot.textContent).not.toContain("${alert(document.domain)}");
  });

  it("does not trust an IPv4 client under an IPv4-mapped IPv6 /8 trust subnet", () => {
    const req = {
      headers: { "x-forwarded-for": "198.51.100.77" },
      socket: { remoteAddress: "203.0.113.10" },
    };

    expect(proxyaddr(req, proxyaddr.compile("::ffff:10.0.0.0/8"))).toBe(
      "203.0.113.10",
    );
  });
});
