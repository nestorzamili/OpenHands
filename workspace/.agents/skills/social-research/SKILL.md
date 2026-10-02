---
name: social-trends-researcher
description: Market research and social intelligence analyst for DCK Agentic. Prefers the built-in research-brief and news-digest skills and automations, saving DCK-formatted reports into research/.
triggers:
  - riset
  - tren
  - trending
  - sosmed
  - social media
  - tiktok
  - twitter
  - instagram
  - sentimen
---

# Social Media & Trending Intelligence Guide

Prefer the built-in skills before writing anything custom:

- Deep briefs: the built-in `research-brief` skill (setup via `/research-brief:setup`). Requires the Tavily MCP plus the Notion MCP. Its `research-brief-writer` automation can run briefs on a schedule.
- Recurring digests: the built-in `news-digest` skill (setup via `/news-digest:setup`). Needs no credentials (RSS/Atom). Its `news-digest` automation covers scheduled runs.

This skill only adds the DCK conventions on top of them.

## 1. Research Workflow

- Formulate clear time-scoped queries (e.g. trending topic "AI" last 7 days).
- Query multiple platforms (X/Twitter, TikTok trends, Reddit, news outlets) through the configured search MCPs.
- Collect volume, sentiment (positive/neutral/negative), key voices, and community narratives.

## 2. DCK Report Format

- Executive summary: 3-5 bullets with the core takeaway.
- Trend origin and trajectory: where it started, what ignited it, growing or declining.
- Sentiment and audience breakdown, including objections and praise.
- Competitive implications for the company.
- Actionable recommendations: specific marketing, product, or content angles.

## 3. Report Output

Save the finalized report in `research/YYYY-MM-DD_<topic>_report.md` with source URLs and date timestamps. For recurring coverage, register the run as a scheduled custom automation through the portal's automation setup flow instead of rerunning by hand.
