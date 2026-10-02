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
  it("renders the square DCK crown mark when useMark is set", () => {
    renderLogo({ useMark: true });
    // dck-mark.svg carries role="img" aria-label="DCK".
    expect(screen.getByRole("img", { name: "DCK" })).toBeInTheDocument();
  });

  it("renders the wordmark (no square mark) by default", () => {
    renderLogo();
    // The wide crown+wordmark has no "DCK" image role, so the square mark is absent.
    expect(screen.queryByRole("img", { name: "DCK" })).not.toBeInTheDocument();
  });
});
