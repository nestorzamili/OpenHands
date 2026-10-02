import { PinnedAutomationsDashboard } from "#/components/features/home/featured-automations/pinned-automations-dashboard";
import { RecommendedAutomationsLauncher } from "#/components/features/automations/recommended-automations-launcher";
import { RunningAutomationsList } from "#/components/features/home/featured-automations/running-automations-list";

export function DckAutomationsSection() {
  return (
    <section
      data-testid="dck-automations-section"
      className="flex w-full flex-col gap-8"
    >
      <RecommendedAutomationsLauncher variant="rail" />
      <PinnedAutomationsDashboard />
      <RunningAutomationsList />
    </section>
  );
}
