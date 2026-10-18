import { expect, test, type Locator, type Page } from "@playwright/test";

const e2eSessionApiKey = process.env.E2E_SESSION_API_KEY ?? "";
const RESPONSIVE_WIDTHS = [390, 767, 768, 820, 1023, 1024, 1440] as const;
const COMPACT_WIDTHS = RESPONSIVE_WIDTHS.filter((width) => width < 1024);

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

async function openMockPage(page: Page, route: string) {
  // Wait for the document shell; route-specific assertions below wait for SPA hydration.
  await page.goto(route, { waitUntil: "domcontentloaded" });
}

async function expectMainFitsAtWidths(page: Page) {
  const main = page.getByRole("main").last();

  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 1024 });
    await expect
      .poll(async () => (await main.boundingBox())?.width ?? 0, {
        timeout: 5_000,
      })
      .toBeGreaterThan(340);
    await expect
      .poll(
        () =>
          main.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        {
          timeout: 5_000,
        },
      )
      .toBe(true);
  }
}

async function navigateCompactExtension(
  page: Page,
  path: "/skills" | "/plugins" | "/apps",
  screenTestId: string,
) {
  const compactNavigation = page.getByTestId("extensions-compact-navigation");
  await expect(compactNavigation).toBeVisible();
  await compactNavigation.getByRole("button").click();
  await compactNavigation.getByTestId(`sidebar-extensions-${path}`).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 90_000 });
  // Lazy route modules compile on first use in the mock dev server, especially in Firefox.
  await expect(page.getByTestId(screenTestId)).toBeVisible({ timeout: 90_000 });
}

async function navigateCompactSetting(
  page: Page,
  path: "/settings/app" | "/settings/secrets",
  screenTestId: string,
) {
  const compactNavigation = page.getByTestId("settings-compact-navigation");
  await expect(compactNavigation).toBeVisible();
  await compactNavigation.getByRole("button").click();
  await compactNavigation.getByTestId(`sidebar-settings-${path}`).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 90_000 });
  await expect(page.getByTestId(screenTestId)).toBeVisible({
    timeout: 90_000,
  });
}

test("switch thumbs stay inside their tracks in a right-to-left language", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await openMockPage(page, "/settings/app");
  await page.getByTestId("language-input").click();
  await page.getByRole("option", { name: "Arabic" }).click();
  await page.getByTestId("submit-button").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // Thumbs slide for 200ms after a toggle or a direction change, so wait
  // for the slide to finish before measuring.
  const thumbOverflow = (track: Locator) =>
    track.evaluate(async (element) => {
      const thumb = element.firstElementChild!;
      await Promise.all(thumb.getAnimations().map((slide) => slide.finished));
      const outer = element.getBoundingClientRect();
      const inner = thumb.getBoundingClientRect();
      return Math.max(outer.left - inner.left, inner.right - outer.right);
    });

  // Settings switches (`md`). The checklist switch starts on and the sound
  // switch off, so both thumb positions are covered.
  for (const [testId, checked] of [
    ["show-getting-started-checklist-switch", true],
    ["enable-sound-notifications-switch", false],
  ] as const) {
    const input = page.getByTestId(testId);
    if (checked) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
    const track = page
      .locator("label", { has: input })
      .locator("span[aria-hidden='true']");
    expect(await thumbOverflow(track)).toBeLessThanOrEqual(0);
  }

  // Menu-row switch (`sm`): hide older conversations, off and then on.
  await page.getByTestId("conversation-layouts-toggle").click();
  await page.getByTestId("advanced-options-row").click();
  const hideOlder = page.getByTestId("toggle-older-conversations");
  const compactTrack = hideOlder.locator(":scope > span[aria-hidden='true']");
  for (const checked of ["false", "true"]) {
    if (checked === "true") await compactTrack.click();
    await expect(hideOlder).toHaveAttribute("aria-checked", checked);
    expect(await thumbOverflow(compactTrack)).toBeLessThanOrEqual(0);
  }
});

async function expectSettingsMainToScroll(
  page: Page,
  widths: readonly number[],
) {
  const main = page.getByRole("main").last();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1024 });
    const fit = await main.evaluate((element) => ({
      bottom: element.getBoundingClientRect().bottom,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(Math.abs(fit.bottom - 1024)).toBeLessThanOrEqual(1);
    expect(fit.overflowY).toBe("auto");
  }
}

test("customization navigation and MCP remain usable across breakpoints", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 1024 });
  await openMockPage(page, "/customize");

  const mobileHub = page.getByTestId("extensions-mobile-hub");
  await expect(mobileHub).toBeVisible({ timeout: 60_000 });

  // `/customize` is a compact-only chooser and redirects to `/mcp` at desktop
  // widths, so leave it before exercising responsive navigation.
  await mobileHub.getByTestId("sidebar-extensions-/mcp").press("Enter");
  await expect(page).toHaveURL(/\/mcp$/);
  await expect(page.getByTestId("mcp-add-custom-server")).toBeVisible({
    timeout: 60_000,
  });

  const desktopNavigation = page.getByTestId("extensions-navbar-desktop");
  const search = page.getByPlaceholder("Search MCP servers");
  await expect(search).toBeVisible();
  expect((await search.boundingBox())?.width ?? 0).toBeGreaterThan(150);
  await search.fill("GitHub");
  await expect(
    page.getByRole("heading", { name: "GitHub", exact: true }),
  ).toBeVisible();
  await page.getByTestId("mcp-add-custom-server").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Test the stable MCP route across breakpoints. Phone widths use the global
  // drawer; compact section navigation is available from tablet width upward.
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 1024 });
    if (width < 1024) await expect(desktopNavigation).toBeHidden();
    else await expect(desktopNavigation).toBeVisible();
  }
  await expectMainFitsAtWidths(page);

  // Navigate through the real compact menu instead of full-document reloads.
  await page.setViewportSize({ width: 820, height: 1024 });
  const compactNavigation = page.getByTestId("extensions-compact-navigation");
  await expect(compactNavigation).toBeVisible();
  await navigateCompactExtension(page, "/skills", "skills-settings-screen");
  await expectMainFitsAtWidths(page);

  await page.setViewportSize({ width: 820, height: 1024 });
  await navigateCompactExtension(page, "/plugins", "skills-plugins-screen");
  await expectMainFitsAtWidths(page);

  await page.setViewportSize({ width: 820, height: 1024 });
  await navigateCompactExtension(page, "/apps", "canvas-extensions-screen");
  await expectMainFitsAtWidths(page);
});

test("settings hub and scroll containers remain usable across breakpoints", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 767, height: 1024 });
  await openMockPage(page, "/settings");

  const mobileHub = page.getByTestId("settings-mobile-hub");
  await expect(mobileHub).toBeVisible({ timeout: 60_000 });
  await mobileHub.getByTestId("sidebar-settings-/settings/agents").click();
  await expect(page).toHaveURL(/\/settings\/agents$/);
  await expect(
    page.getByRole("heading", { name: "Available Profiles", exact: true }),
  ).toBeVisible({ timeout: 90_000 });

  const desktopNavigation = page.getByTestId("settings-navbar-desktop");
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 1024 });
    if (width < 1024) await expect(desktopNavigation).toBeHidden();
    else await expect(desktopNavigation).toBeVisible();
  }

  await expectMainFitsAtWidths(page);
  await expectSettingsMainToScroll(page, COMPACT_WIDTHS);

  // At phone widths the section menu is intentionally replaced by the global
  // drawer. Use tablet width for the compact Settings section menu.
  await page.setViewportSize({ width: 820, height: 1024 });
  await navigateCompactSetting(
    page,
    "/settings/secrets",
    "secrets-settings-screen",
  );
  await expectMainFitsAtWidths(page);
  await expectSettingsMainToScroll(page, COMPACT_WIDTHS);
});
