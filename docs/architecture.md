# Agent Canvas architecture

Agent Canvas is a React and TypeScript frontend for running and managing OpenHands agents across local, remote, and hosted environments. It is adapted from the OpenHands frontend to talk directly to the OpenHands Agent Server and related automation services.

## System boundaries

Agent Canvas is responsible for:

- Rendering the agent conversation, terminal, browser, files, settings, and automation UI.
- Managing frontend state for conversations, backend selection, settings, profiles, and local metadata.
- Translating UI actions into OpenHands Agent Server API calls.
- Packaging the UI both as a standalone app and as library entrypoints for host applications.

Agent Canvas is not responsible for:

- Executing agent actions directly.
- Providing the sandbox or workspace isolation layer.
- Hosting LLM provider credentials outside the configured backend.
- Running scheduled or event-triggered automations without an automation backend.

## Runtime services

The primary backend is the [OpenHands Agent Server](https://github.com/OpenHands/software-agent-sdk/tree/main/openhands-agent-server/openhands/agent_server). Agent Canvas can connect to one or more Agent Server instances and switch between them from the UI.

Optional runtime services include:

- An ingress service that routes frontend, Agent Server, and automation traffic behind one local origin.
- An Automation Server for scheduled or event-triggered agent runs.
- OpenHands Cloud APIs for hosted sandbox and organization workflows.

Agent Canvas stack launchers expose runtime service information through the backend `/server_info.runtime_services` field. The frontend forwards that backend-provided information into new conversations as an agent context suffix so agents can use the correct URLs instead of guessing ports.

## Frontend modules

The most important source areas are:

- `src/api/`: service adapters for Agent Server, cloud, settings, git, skills, automations, and backend registry behavior.
- `src/components/`: route and feature UI, including conversation, chat, browser, files, settings, backend, automation, and onboarding components.
- `src/hooks/`: reusable React Query, state, and feature hooks.
- `src/stores/`: Zustand state stores for conversation and UI state.
- `src/i18n/`: translation resources and generated bundles.
- `src/mocks/`: MSW handlers for mock-mode development and tests.
- `bin/` and `scripts/`: CLI and development stack launchers.

## Runtime modes

Agent Canvas supports several modes:

| Mode | Purpose |
|---|---|
| `npm run dev` | Starts the full local stack directly on the host: agent-server and automation backend via `uvx`, the Vite dev server, and an ingress proxy. The agent has host filesystem access; use only in trusted environments. |
| `npm run dev:minimal` | Starts just the agent-server plus Vite dev server, without the automation backend. |
| `npm run dev:static` | Same as `dev`, but serves a production build of the frontend instead of the Vite dev server. |
| `npm run dev:mock` | Runs the frontend against MSW mocks for UI development and tests. |
| `npm run build` | Builds the standalone application. |
| `npm run build:lib` | Builds library entrypoints for embedding Agent Canvas components. |

## Agent Profile skills: Local and Cloud

The Skills page toggles global skill settings via `useSkillEnablement()` (`src/hooks/use-skill-enablement.ts`); these are not the per-profile controls. Local Agent Profiles can separately select public skills per profile: the editor saves profile-level `public_skills` / `disabled_skills` fields, enforced by the Agent Server when that profile is used. A new Local profile starts from the global Skills-page selection, but later changes to global toggles do not automatically select a newly authored/custom skill for an already chosen profile. Configure that skill in Settings → Agent Profiles for the profile that will launch it. DCK module assignment can explicitly select a profile—including the `default` profile—and launches with that profile ID (`src/routes/module-detail.tsx`, `src/hooks/use-dck-module-agent-profiles.ts`); it does not substitute global Skills-page toggles for that profile's skill selection. The UI capability gate is `agentProfileSupportsSkills()` in `src/api/agent-profiles-service/profile-field-support.ts`, with editing and save behavior in `src/routes/agent-settings.tsx` and `src/components/features/settings/agent-profiles/agent-profiles-local-view.tsx`.

Cloud currently has frontend transport for agent-profile CRUD/activation through `src/api/cloud/agent-profiles-service.api.ts`, but **not per-profile skills**. The capability gate excludes Cloud profiles from the skill editor; Cloud skill enablement uses global settings/catalog behavior (`src/hooks/use-skill-enablement.ts`) and does not apply a profile's `public_skills` / `disabled_skills` selection. Cloud-global skills and skills available in a Cloud conversation are distinct from per-profile skill assignment. Do not assume selecting or persisting Local-style profile skill fields in Cloud will change what a Cloud run loads. This is a code-level capability assessment only; live Cloud behavior/parity has not been verified. Cloud per-profile skill enforcement remains a gap until the Cloud launch path applies the selection and corresponding UI/API support is enabled.

## Packaging and distribution

The npm package is `@openhands/agent-canvas`. The package exposes:

- The `agent-canvas` binary for launching a local stack.
- A standalone app build.
- Library entrypoints for browser, conversation, files, settings, sidebar, terminal, and i18n modules.

Tagged releases are published through the `Publish to npm` GitHub Actions workflow using npm trusted publishing and provenance.

## Quality gates

The main CI workflow installs dependencies with `npm ci` and runs:

- Typecheck, ESLint, and Prettier through `npm run lint`.
- Unit and component tests through `npm test`.
- Standalone app build through `npm run build`.
- Library build through `npm run build:lib`.
- Package verification through `npm pack --dry-run`.

Additional workflows run optional live end-to-end QA.

## Security posture

Local operation can give agents access to user workspaces. The README and self-hosting guide call out this risk and recommend Docker sandbox mode for laptop usage. Self-hosted deployments should use normal server hardening practices, authentication, HTTPS, firewall rules, and careful workspace scoping.
