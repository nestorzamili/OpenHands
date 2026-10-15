# WebGen and DCK reliability

WebGen uses the host runtime API for project status and lifecycle actions. Module definitions remain workspace-owned; profile assignments remain settings-owned. Owner credentials are never persisted.

| ID | Required behavior |
| --- | --- |
| WR-001 | Reserve first-admin setup before body reads and hashing across processes sharing the store; release on handled failure and disconnect. |
| WR-002 | Malformed HTTP targets return 400; portal exceptions cannot terminate ingress or static server. |
| WR-003 | Internal workspace/secret reads validate API keys upstream; public ingress remains cookie-gated. |
| WR-004 | Deployment updates only unchanged, previously shipped skill files; unknown files and user edits survive. |
| WR-005 | Preview routing, readiness, and owner provisioning use the running build's basePath during transitions. |
| WR-006 | Readiness and publication rollback poll against a monotonic deadline. |
| WR-007 | Unavailable owner seeds return 410 and permit reentry on the same project conversation. |
| WR-008 | Delete preflights PostgreSQL, uses its configured user and the postgres maintenance database, and skips explicitly database-free projects. |
| WR-009 | nginx validation and reload work with the shipped filesystem sandbox. |
| WR-010 | Both scaffold entrypoints create conversations in the individual project workspace. |
| WR-011 | Only registry 404 initializes empty state; other read/parse failures block writes. |
| WR-012 | Skill creation checks storage slug and target existence; existing files require editing. |
| WR-013 | Conversation rows navigate by the selected ID. |
| WR-014 | Pagination loads every page, deduplicates IDs, rejects repeated cursors, and blocks new fallback conversations until complete. |
| WR-015 | Assignment removal sends explicit null tombstones through settings deep merge. |
| WR-016 | Project names satisfy service slug grammar before scaffold or seed side effects. |
| WR-017 | Failed publication recovery is explicit; readiness and recovery messages are localized. |
| WR-018 | Preview lives at the Canvas origin under `/preview/<slug>`; only Publish accepts a subdomain. One deployment exposes one active mode and link. |
| WR-019 | WebGen badges and lifecycle metadata use the runtime API; no file fallback. Links are visible only while running. |
| WR-020 | App runtime secrets use a distinct encrypted per-project store and host-private master key; values never enter Agent Secret Manager, agent-readable workspace, prompts, logs, status/list responses, Git, or builds. Migration is explicit, never deletes the source automatically, and activates only after a user removes it and an authenticated read confirms absence. |

## Runtime configuration

- DCK enables `WEBGEN_INTERNAL_PROXY=true`. Container port 18002 is published only as `127.0.0.1:8012`. It forwards only GET workspace/secret requests to the loopback Agent Server, retaining upstream API-key validation. Legacy migration has no proxy write/delete capability. Never publish it to a public interface.
- `/var/lib/dck-webgen-control` contains the master key and encrypted store, is root-only, and is never mounted into Canvas. Plaintext runtime env files exist only under the systemd-managed volatile `/run/dck-webgen-control` directory.
- `WEBGEN_CANVAS_AUTH_URL` uses `http://127.0.0.1:8012/api/workspaces`. Deploy the image, Compose file, and systemd unit together.
- `WEBGEN_READINESS_TIMEOUT` defaults to 120 seconds, maximum 300. Proxy/client lifecycle timeouts are 45 minutes to cover build, readiness, and rollback.
- Deployment propagates `POSTGRES_USER` as `WEBGEN_POSTGRES_USER`; cleanup uses database `postgres`.
- The systemd unit retains `ProtectSystem=strict` and adds `/var/log/nginx` to writable paths; deployment creates this directory.

## Preservation and recovery

`config/managed-skills.json` records deployment-owned file hashes. Files without a recorded hash require explicit adoption. Conflicting incoming files go to `config/skill-update-candidates`. Upstream deletions remove only files matching the recorded hash.

Setup holds an exclusive `<portal-store>.setup-lock`. Normal completion, errors, and disconnects release it. An unclean process termination deliberately fails closed: stop all portal processes sharing the store, inspect persisted admin state, and remove the stale lock before restarting. Never remove a live lock.

Project-workspace conversations are reused. Owner-seed reentry recovers missing temporary credentials without saving passwords.

Skill create checks target existence using the existing FileClient contract. This is not cross-client atomic creation; that guarantee would require an SDK contract change.

## Verification and rollout

Follow [deployment](DEPLOYMENT.md) for release preparation and deployment. Runtime configuration and lifecycle details live in [WebGen control](webgen-control.md).

Run focused portal/ingress, DCK settings, skill, module-detail, and scaffold tests; then lint, full Vitest, app/library builds, and the direct API-call guard. Regenerate translation declarations and verify locale completeness.

Run `python -m unittest discover -s services/webgen-control/tests -v` with pinned requirements on Linux. When nginx is installed, the suite starts real nginx and verifies preview page/asset/owner URIs and query preservation. Both bare and trailing-slash preview paths are proxied so Next.js can canonicalize URLs without a redirect loop. Filesystem ownership and symlink checks must run on Linux.

Before production rollout, back up configuration, skills, metadata, PostgreSQL, and `/var/lib/dck-webgen-control` with its master key and encrypted store as one root-only pair. Verify the actual unit on staging, then exercise a disposable Next.js app through preview, owner bootstrap, publish, unpublish, restart, and delete. The HTTP fixture test is not a full Next.js deployment test.

DCK persistence and scaffold changes affect local backends. Enumeration retains Local/Cloud service routing and backend/organization cache isolation. Shared standard/planning/delegated and OpenHands/ACP conversation builders are unchanged. Code comments/spec tags are omitted at the user's request.

Run deployment/bootstrap fixtures on Linux. Windows Bash, filesystem paths, and symlink permissions can affect those tests. A passing focused suite or fixture does not establish that the full suite, production systemd orchestration, or real Better Auth account provisioning has passed; verify each relevant release path before rollout.
