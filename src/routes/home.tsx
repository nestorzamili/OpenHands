import { PrefetchPageLinks } from "react-router";
import { DckAutomationsSection } from "#/components/features/home/dck-automations-section";
import { DckModulesSection } from "#/components/features/dck/dck-modules-section";
import { DckRecentConversations } from "#/components/features/dck/dck-recent-conversations";
import { LlmNotConfiguredBanner } from "#/components/features/home/llm-not-configured-banner";

<PrefetchPageLinks page="/conversations/:conversationId" />;

function HomeScreen() {
  return (
    <div
      data-testid="home-screen"
      className="custom-scrollbar-always h-full overflow-y-auto rounded-xl bg-transparent px-4 md:px-0 lg:px-10.5"
    >
      <div className="md:px-4 lg:px-0">
        <LlmNotConfiguredBanner />
      </div>

      <div className="flex w-full flex-col gap-8 pt-6 pb-10">
        <DckModulesSection />
        <DckRecentConversations />
        <DckAutomationsSection />
      </div>
    </div>
  );
}

export default HomeScreen;
