import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import HomeScreen from "#/routes/home";

vi.mock("#/components/features/dck/dck-modules-section", () => ({
  DckModulesSection: () => <div data-testid="dck-modules-section" />,
}));

vi.mock("#/components/features/home/dck-automations-section", () => ({
  DckAutomationsSection: () => <div data-testid="dck-automations-section" />,
}));

vi.mock("#/components/features/home/llm-not-configured-banner", () => ({
  LlmNotConfiguredBanner: () => null,
}));

describe("HomeScreen (module-first)", () => {
  it("renders the modules and automations sections", () => {
    renderWithProviders(<HomeScreen />);

    expect(screen.getByTestId("dck-modules-section")).toBeInTheDocument();
    expect(screen.getByTestId("dck-automations-section")).toBeInTheDocument();
  });

  it("does not render the recent-conversations card (the sidebar owns that)", () => {
    renderWithProviders(<HomeScreen />);

    expect(
      screen.queryByTestId("dck-recent-conversations"),
    ).not.toBeInTheDocument();
  });

  it("does not render the free-form chat launcher on home", () => {
    renderWithProviders(<HomeScreen />);

    expect(screen.queryByTestId("home-chat-launcher")).not.toBeInTheDocument();
  });
});
