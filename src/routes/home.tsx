import { PrefetchPageLinks, useLocation } from "react-router";
import { DckModulesSection } from "#/components/features/dck/dck-modules-section";
import { DckRecentConversations } from "#/components/features/dck/dck-recent-conversations";
import { HomeChatLauncher } from "#/components/features/home/home-chat-launcher";
import { LlmNotConfiguredBanner } from "#/components/features/home/llm-not-configured-banner";
import {
  isOnboardingPreviewActive,
  OnboardingHost,
} from "#/components/features/onboarding";

<PrefetchPageLinks page="/conversations/:conversationId" />;

function HomeScreen() {
  const location = useLocation();
  const isPreview = isOnboardingPreviewActive(location.search);

  return (
    <div
      data-testid="home-screen"
      className="custom-scrollbar-always h-full overflow-y-auto rounded-xl bg-transparent px-4 md:px-0 lg:px-10.5"
    >
      <div className="md:px-4 lg:px-0">
        <LlmNotConfiguredBanner />
      </div>

      <div className="flex w-full flex-col gap-6 pt-6">
        <DckModulesSection />
        <DckRecentConversations />
      </div>

      <HomeChatLauncher />

      {!isPreview ? <OnboardingHost /> : null}
    </div>
  );
}

export default HomeScreen;
