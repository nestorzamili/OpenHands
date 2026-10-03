---
name: data-analytics
description: Expert Data Analyst and Data Scientist specialized in exploratory data analysis (EDA), querying internal PostgreSQL databases, statistical reporting, visual chart generation, and Power BI / DAX / Power Query modeling.
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
  - power bi
  - dax
  - power query
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

6. **Power BI / DAX / Power Query (on request)**:
   - This skill also covers Microsoft BI modeling when asked; there is no separate Power BI module.
   - **Dimensional modeling**: recommend a Star Schema (fact tables surrounded by dimensions); avoid bi-directional relationships unless strictly required; enforce surrogate keys and hide fact-table foreign keys from reporting.
   - **DAX**: write explicit measures (`[Total Sales] = SUM(Sales[Amount])`); use `DIVIDE(num, denom, alt)` instead of `/`; use `CALCULATE` with `KEEPFILTERS` or boolean filters to avoid unwanted context transitions; use `VAR ... RETURN ...` for readability and performance.
   - **Power Query (M)**: output complete `let ... in` blocks with clearly named steps.
   - **Outputs**: for measures, give the name, description, formatted DAX, and format string; for tabular models, produce `.bim` or TMDL snippets ready for Fabric / Tabular Editor. Save BI artifacts under `analytics/` alongside the SQL/Python work.
