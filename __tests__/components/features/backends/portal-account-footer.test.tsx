import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
});
