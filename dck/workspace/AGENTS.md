# DCK Agentic — Multi-Agent Workspace Guidelines

Welcome to the internal **DCK Agentic** workspace. This repository is organized into dedicated domain modules:

- `webgen/` — Full Stack web applications, landing pages, and prototypes (Dockerized).
- `dashboards/` — Interactive React/Tailwind analytics dashboards.
- `research/` — Market research reports, social media trend analysis, and competitor monitoring.
- `powerbi/` — DAX measure libraries, Power Query (M) transformations, and semantic model definitions.
- `analytics/` — Exploratory data analysis, SQL queries against host PostgreSQL, and visual charts.

---

## Zero Host Pollution & Production Standards (MANDATORY)

1. **Fullstack Containerization**:
   - For all web apps and backends generated in `webgen/`, always build and run them as single-service Next.js **Docker Compose** applications per the `web-generator` skill.
   - Do NOT run bare development processes or install packages directly on the host VM — no `npm`, `pip`, `node`, or `prisma` outside containers.
   - All ephemeral files, databases, and dependencies (`node_modules`, `.next`, `site-packages`) must stay inside Docker containers or image layers. Every app ships a `.dockerignore`.
   - Secrets come from the portal Secret Manager and are materialized into gitignored `.env` at deploy time; never commit or log values.
   - Deleting an app means `docker compose down -v --rmi local`. Verify `git status` shows only intended files after every task.
2. **Network & Database Connectivity**:
   - Host system services (PostgreSQL on port 5432, internal APIs) are reachable from within containers via `host.docker.internal:<port>`.
3. **Quality & Verification**:
   - Verify every Docker stack with `docker compose up -d --build` followed by `docker compose ps` and endpoint health checks.
   - For data scripts: ensure scripts run cleanly and output visual artifacts directly into the appropriate folder.
   - For research & BI: structure reports cleanly using GitHub-flavored Markdown.
