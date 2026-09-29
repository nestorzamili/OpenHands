# DCK Agentic

**DCK Agentic** is an internal multi-agent AI portal designed to automate and augment organizational workflows across multiple domains:

1. **Web Generator** — Rapid application scaffolding, fullstack prototyping, and landing page generation (React, Vite, Tailwind CSS, Dockerized).
2. **Dashboard Generator** — Interactive web analytics dashboards, charting components, and reporting UIs.
3. **Social Media & Trends Research** — Automated market intelligence, trend tracking, and executive sentiment summaries.
4. **Power BI Assistant** — Dimensional modeling (Star Schema), optimized DAX measures, and Power Query (M) transformations.
5. **Data Analytics** — Exploratory data analysis (EDA), visual chart exports, and SQL queries against internal databases (PostgreSQL).

---

## Architecture & Layout

The platform is built on top of **OpenHands Agent Canvas** as its autonomous execution core:

```
dck/
├── docker-compose.yml       # Production-ready DCK Agentic container definition
│   ├── config/                  # Runtime state (created on first run, never committed)
│   └── workspace/               # Domain workspace for all agent outputs & active skills
│       ├── .agents/skills/      # [CANONICAL] Standard OpenHands skills directory
│       │   ├── web-generator/   # Next.js single-service scaffolding rules
│       │   ├── dashboard-generator/ # Canvas Extension dashboard rules
│       │   ├── power-bi/        # DAX & Star Schema optimization guide
│       │   ├── social-research/ # Trend research wrapper (research-brief/news-digest)
│       │   └── data-analytics/  # PostgreSQL querying & visualization standards
│       ├── webgen/              # Next.js apps, one Docker Compose stack each
│       ├── dashboards/          # Canvas Extension dashboard packages
│       ├── research/            # Market intelligence and social research reports
│       ├── powerbi/             # DAX measures, M scripts, and model schemas
│       ├── analytics/           # Data analytics scripts, queries, and charts
│       └── AGENTS.md            # Universal repository instructions for all agents
└── README.md
```

---

## Quick Start (Portal Access)

The DCK Agentic engine (`dck-agentic:dev`, built from the OpenHands fork `dev`
branch) runs on the server. It is PostgreSQL-only: create the automation
database once, then export its URL before starting the stack:

```bash
docker exec postgres psql -U nestor -d samunudb -c "CREATE DATABASE dck_automation;"
export AUTOMATION_DB_URL="postgresql+asyncpg://nestor:<pass>@postgres:5432/dck_automation"
```

- **Portal (internal only, auto-authenticated, no key prompt)**: [http://localhost:8000/canvas](http://localhost:8000/canvas)
- **Skills Management**: [http://localhost:8000/canvas/skills](http://localhost:8000/canvas/skills)
- **API Key**: Found in `dck/config/agent-canvas/api-key.txt` (only needed if you ever expose a public port)

There is deliberately no public mode: port `8000` is loopback-bound and the
public login port (`8002`) is removed. The API-key login screen from the
designs remains in the product purely as a safety net — it appears only if a
future deployment strips the session key (non-loopback exposure) or the
backend returns 401.

### Managing the Service

From the `dck/` directory:

```bash
# Check status and logs
docker compose logs -f

# Restart container
docker compose restart

# Stop container
docker compose down
```

---

## Database Connectivity

The container is configured with `host.docker.internal:host-gateway`. All agents have direct access to the host PostgreSQL instance:

```text
Host: host.docker.internal
Port: 5432
```
