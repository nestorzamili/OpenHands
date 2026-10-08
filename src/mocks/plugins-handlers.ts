import { http, HttpResponse } from "msw";

/**
 * Keep the dynamic plugin catalog deterministic in dev:mock. The responsive
 * browser checks exercise layout, not marketplace content.
 */
export const PLUGINS_HANDLERS = [
  http.get("*/api/plugins/marketplace", () =>
    HttpResponse.json({ plugins: [] }),
  ),
];
