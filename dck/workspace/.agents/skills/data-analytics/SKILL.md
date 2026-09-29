---
name: data-analytics
description: Expert Data Analyst and Data Scientist specialized in exploratory data analysis (EDA), querying internal PostgreSQL databases, statistical reporting, and visual chart generation.
triggers:
  - analitik
  - analytics
  - data
  - sql
  - postgres
  - query
  - chart
  - grafik
  - visualisasi
---

# Data Analytics & Business Intelligence Guide

When performing data analytics, database queries, or visual reporting:

1. **Environment & Connection**:
   - The host PostgreSQL database is reachable from the container environment at:
     `host.docker.internal:5432`
   - Python analytics libraries (Pandas, Polars, DuckDB, SQLAlchemy, Matplotlib, Seaborn) should be used inside virtual environments or scripts in `analytics/`.

2. **Querying & Performance**:
   - Write safe, performant SQL queries: avoid unbounded `SELECT *` on production tables; use explicit column selections and `LIMIT` clauses during exploration.
   - For aggregate reporting, push computations into the database layer via SQL group-by/window functions whenever possible before loading into Pandas dataframes.

3. **Deliverables & Artifacts**:
   - Output analysis scripts to `analytics/<analysis_name>.py`.
   - Export generated visual charts (PNG/SVG) to `analytics/charts/`.
   - Deliver clear business insights: don't just dump tables of numbers; explain the "so what?", statistical significance, and operational impact.

4. **Read Access**:
   - Prefer the read-only Postgres MCP server registered in the portal (`/mcp`) for exploration; fall back to direct connection strings only when the MCP cannot express the query.
   - The built-in `jupyter` skill may be used for notebook-style exploration; final deliverables still land as `.py` scripts plus exported charts.

5. **Recurring Analyses**:
   - Weekly or scheduled EDA runs belong in scheduled custom automations created through the portal's automation setup flow, writing dated outputs, not in repeated chat sessions.
