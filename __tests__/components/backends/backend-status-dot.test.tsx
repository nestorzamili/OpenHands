import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils";
import { BackendStatusDot } from "#/components/features/backends/backend-status-dot";

describe("BackendStatusDot", () => {
  it("marks a reachable but degraded backend distinctly from connected", () => {
    renderWithProviders(
      <BackendStatusDot isConnected isDegraded lastCheckedAt={null} />,
    );

    expect(screen.getByRole("status").getAttribute("data-status")).toBe(
      "degraded",
    );
  });
});
