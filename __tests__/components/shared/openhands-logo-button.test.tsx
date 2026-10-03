import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OpenHandsLogoButton } from "#/components/shared/buttons/openhands-logo-button";

function renderLogo(props?: Parameters<typeof OpenHandsLogoButton>[0]) {
  return render(
    <MemoryRouter>
      <OpenHandsLogoButton {...props} />
    </MemoryRouter>,
  );
}

describe("OpenHandsLogoButton", () => {
  it("renders only the crown mark (no wordmark) when useMark is set", () => {
    renderLogo({ useMark: true });
    // Collapsed rail: the square crown mark with no product wordmark beside it.
    expect(screen.queryByText("DCK Agentic")).not.toBeInTheDocument();
    // The link still exposes an accessible name for the logo.
    expect(
      screen.getByRole("link", { name: /dck|openhands|logo/i }),
    ).toBeInTheDocument();
  });

  it("renders the crown mark with the product wordmark by default", () => {
    renderLogo();
    // Expanded rail: same mark, plus the product name as a wordmark.
    expect(screen.getByText("DCK Agentic")).toBeInTheDocument();
  });
});
