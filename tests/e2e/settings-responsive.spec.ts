import { expect, test, type Page } from "@playwright/test";

const e2eSessionApiKey = process.env.E2E_SESSION_API_KEY ?? "";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((sessionApiKey) => {
    localStorage.setItem("analytics-consent", "false");
    localStorage.setItem("openhands-telemetry-consent", "denied");
    localStorage.setItem("openhands-telemetry-first-use", "true");
    localStorage.setItem("openhands-onboarded", "1");
    localStorage.setItem(
      "openhands-sidebar",
      JSON.stringify({ state: { collapsed: false }, version: 0 }),
    );
    localStorage.setItem(
      "openhands-backends",
      JSON.stringify([
        {
          id: "default-local",
          name: "Local QA",
          host: location.origin,
          apiKey: sessionApiKey,
          kind: "local",
        },
      ]),
    );
    localStorage.setItem(
      "openhands-active-backend",
      JSON.stringify({ backendId: "default-local", orgId: null }),
    );
  }, e2eSessionApiKey);
});

async function openMockPage(
  page: Page,
  route: string,
  handleConsent = false,
) {
  await page.goto(route);
  if (!handleConsent) return;
  const consent = page.getByRole("dialog", { name: "Help improve OpenHands" });
  await expect(consent).toBeVisible({ timeout: 30000 });
  await consent.getByRole("checkbox").uncheck();
  await consent.getByRole("button", { name: "Confirm preferences" }).click();
  await expect(consent).toBeHidden();
}

for (const width of [390, 767, 768, 820, 1023, 1024, 1440]) {
  test(`settings and customization remain usable at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1024 });
    await openMockPage(page, "/customize", true);
    const compact = width < 1024;
    if (compact) {
      await expect(page.getByTestId("extensions-mobile-hub")).toBeVisible();
      // Keyboard navigation out of the hub remains available.
      await page
        .getByTestId("extensions-mobile-hub")
        .getByRole("link", { name: "MCP Servers", exact: true })
        .press("Enter");
    }
    await expect(page.getByTestId("mcp-add-custom-server")).toBeVisible();
    const nav = page.getByTestId("extensions-navbar-desktop");
    if (compact) await expect(nav).toBeHidden();
    else await expect(nav).toBeVisible();
    const search = page.getByPlaceholder("Search MCP servers");
    await expect(search).toBeVisible();
    expect((await search.boundingBox())!.width).toBeGreaterThan(150);
    await search.fill("GitHub");
    await expect(
      page.getByRole("heading", { name: "GitHub", exact: true }),
    ).toBeVisible();
    await page.getByTestId("mcp-add-custom-server").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    for (const route of ["/skills", "/plugins", "/apps", "/settings/app"]) {
      await openMockPage(page, route);
      const main = page.locator("main").last();
      await expect(main).toBeVisible({ timeout: 30000 });
      await expect
        .poll(async () => (await main.boundingBox())?.width ?? 0, {
          timeout: 30000,
        })
        .toBeGreaterThan(340);
      await expect
        .poll(
          () => main.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          { timeout: 30000 },
        )
        .toBe(true);
    }
    if (compact) {
      // As on Customize, Settings' main fills the column and scrolls itself,
      // so a popover inside it is not clipped on a short page (#18255).
      for (const [route, scrolls] of [
        ["/settings/secrets", false],
        ["/settings/app", true],
      ] as const) {
        await openMockPage(page, route);
        const main = page.locator("main").last();
        await expect(main).toBeVisible();
        const fit = await main.evaluate((el) => ({
          bottom: el.getBoundingClientRect().bottom,
          scrolls: el.scrollHeight > el.clientHeight,
        }));
        expect(Math.abs(fit.bottom - 1024)).toBeLessThanOrEqual(1);
        expect(fit.scrolls).toBe(scrolls);
      }
    }
    await openMockPage(page, "/settings");
    if (compact)
      await expect(page.getByTestId("settings-mobile-hub")).toBeVisible({
        timeout: 30000,
      });
    else
      await expect(page.getByTestId("settings-navbar-desktop")).toBeVisible({
        timeout: 30000,
      });
  });
}
