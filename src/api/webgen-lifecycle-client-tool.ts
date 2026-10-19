import type { ClientToolSpec } from "./canvas-ui-client-tool";
import { WEBGEN_LIFECYCLE_TOOL_NAME } from "#/constants/webgen-lifecycle";

export const WEBGEN_LIFECYCLE_CLIENT_TOOL: ClientToolSpec = {
  name: WEBGEN_LIFECYCLE_TOOL_NAME,
  description:
    "Manage the current WebGen app when the user requests a lifecycle operation. Use this tool autonomously for status, deployment, start/stop/restart/rebuild, publish, and unpublish; do not deflect the user to the UI. Operate only on the app belonging to this conversation. Never delete an app, access or change secrets, target another project, or bypass the WebGen controller with Docker/compose commands. Keep Canvas connected. The immediate acknowledgment is not completion: wait for the WebGen lifecycle result message before claiming success. If the controller is unavailable, report that honestly. Status/readiness is not a test-suite run; use an isolated container for actual project tests.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [
          "status",
          "run",
          "deploy",
          "start",
          "rebuild",
          "restart",
          "stop",
          "publish",
          "unpublish",
        ],
        description: "Lifecycle operation for this conversation's WebGen app.",
      },
      subdomain: {
        type: "string",
        description:
          "Optional explicit subdomain to publish when action is publish.",
      },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};
