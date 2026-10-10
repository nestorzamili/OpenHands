import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { PortalAccountFooter } from "#/components/features/backends/portal-account-footer";
import * as portalService from "#/api/portal-auth-service";

vi.mock("#/api/portal-auth-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/api/portal-auth-service")>()),
  getPortalUser: vi.fn(),
  logoutPortal: vi.fn(),
}));

const getPortalUser = vi.mocked(portalService.getPortalUser);
const logoutPortal = vi.mocked(portalService.logoutPortal);

beforeEach(() => {
  getPortalUser.mockReset();
  logoutPortal.mockReset();
});

describe("PortalAccountFooter", () => {
  it("renders nothing when portal auth is not active", async () => {
    getPortalUser.mockResolvedValue(null);
    renderWithProviders(<PortalAccountFooter />);
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(
      screen.queryByTestId("portal-account-footer"),
    ).not.toBeInTheDocument();
  });

  it("shows the username and admin badge and logs out on click", async () => {
    getPortalUser.mockResolvedValue({ username: "grok", isAdmin: true });
    logoutPortal.mockResolvedValue();
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    });
    const user = userEvent.setup();

    renderWithProviders(<PortalAccountFooter />);

    expect(
      await screen.findByTestId("portal-account-footer-user"),
    ).toHaveTextContent("grok");

    await user.click(screen.getByTestId("portal-logout-button"));
    await waitFor(() => expect(logoutPortal).toHaveBeenCalledTimes(1));
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("shows Settings and Logout in the sidebar account dropdown", async () => {
    getPortalUser.mockResolvedValue({ username: "grok", isAdmin: true });
    const navigate = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<PortalAccountFooter inSidebar />, {
      navigation: { navigate },
    });

    await user.click(await screen.findByTestId("portal-account-menu-trigger"));

    const menu = screen.getByTestId("portal-account-menu");
    expect(menu).toHaveClass("w-full");
    expect(menu).toHaveTextContent("grok");
    expect(
      within(menu).getByTestId("portal-settings-button"),
    ).toBeInTheDocument();
    expect(
      within(menu).getByTestId("portal-logout-button"),
    ).toBeInTheDocument();

    await user.click(within(menu).getByTestId("portal-settings-button"));
    expect(navigate).toHaveBeenCalledWith("/settings", { replace: false });
    expect(screen.queryByTestId("portal-account-menu")).not.toBeInTheDocument();
  });

  it("keeps Settings and Logout available from the collapsed account trigger", async () => {
    getPortalUser.mockResolvedValue({ username: "grok", isAdmin: true });
    const user = userEvent.setup();

    renderWithProviders(<PortalAccountFooter collapsed inSidebar />);

    await user.click(
      await screen.findByRole("button", { name: "Account menu for grok" }),
    );

    const menu = screen.getByTestId("portal-account-menu");
    expect(menu).toHaveClass("w-75");
    expect(
      within(menu).getByTestId("portal-settings-button"),
    ).toBeInTheDocument();
    expect(
      within(menu).getByTestId("portal-logout-button"),
    ).toBeInTheDocument();
  });
});
