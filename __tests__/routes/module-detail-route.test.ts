import { describe, expect, it } from "vitest";
import routes from "#/routes";

describe("module detail route config", () => {
  it("registers the /modules/:moduleId path", () => {
    const rootLayout = routes.find(
      (route) => route.file === "routes/root-layout.tsx",
    );
    const moduleRoute = rootLayout?.children?.find(
      (route) => route.file === "routes/module-detail.tsx",
    );
    expect(moduleRoute?.path).toBe("modules/:moduleId");
  });
});
