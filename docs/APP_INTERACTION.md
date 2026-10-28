# App interaction routes

Sophon prefers a matching connected app/API tool, then browser DOM, Windows
accessibility, and screenshot-directed input. This is not a mandatory sequence
of four probes. The model chooses from permitted capabilities, respecting an
explicitly requested app and account. A denial stops the operation; uncertainty
requires inspecting the original target before a retry or route change.

## Connected app tools

App APIs are exposed through the existing MCP connection system in Settings >
Plugins. No service is assumed connected or authenticated. `plugins_list` accepts
an optional literal app/capability query and includes up to eight matching cached
tool descriptions for each enabled connection. `mcp_catalog` accepts a tool query
and returns exact schemas with pagination. These discovery operations do not
connect servers or execute service actions. Related schemas stay loaded so a
discovered operation does not require repeated tool-instruction discovery.

Calls retain existing schema validation, connection binding, per-operation
approval and untrusted-result handling. An MCP success reports the service's
response; the model must assess whether it establishes the requested effect.
This does not add a Discord user-account API or invent a connector.

Validation: `node scripts/smoke-app-routing.cjs` and `npm run smoke:plugins`.
