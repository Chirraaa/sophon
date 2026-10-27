# Plugins, MCP and Windows integration

## What is implemented

Sophon supports user-imported plugins through **Settings > Plugins**. No third-party plugin packages ship with the app. It uses the official MCP TypeScript SDK as a production dependency. The existing Windows UI Automation and screenshot tools remain available alongside service-specific MCP tools.

The loader reads `.claude-plugin/plugin.json`, server declarations in that manifest or `.mcp.json`, and skill/reference Markdown. Imports snapshot content, reject filesystem links escaping the package, limit file sizes and counts, and do not execute hooks or scripts. Imported packages start disabled. Empty endpoints and unsupported declarations appear as import notes. Third-party OAuth client registrations are not adopted.

The MCP client supports local **stdio** and remote **Streamable HTTP**. It discovers tools with JSON schemas and supports resources, resource templates and prompts. It does not expose model sampling, elicitation or host filesystem roots to servers. Results are bounded untrusted text; binary media is not rendered as model images in this version.

| Model tool     | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `plugins_list` | Discover enabled plugin documents and MCP connections.                          |
| `plugin_read`  | Load an exact skill or reference document on demand.                            |
| `mcp_catalog`  | Discover tools, resources, templates or prompts. Tool catalogues are paginated. |
| `mcp_call`     | Call a discovered tool with JSON arguments, validated against its schema.       |
| `mcp_read`     | Read a resource or retrieve a prompt.                                           |

This avoids inserting hundreds of schemas and entire skill packages into every prompt. Skill descriptions, prompts, tool annotations and results cannot grant permissions or change the user request.

## Connect a service

1. Open **Settings > Plugins**. Optionally import a plugin folder and enable it to make its skills available.
2. Use **Add MCP connection** and select a preset, or **Configure** on a connection declared by an imported plugin. Save its endpoint/command and credentials. Editing replaces the configuration and disables it; re-enter any credentials to retain.
3. Enable the connection and review its destination or local launch command. Local MCPs have the Windows account's access, including outside Sophon's working folder and protected-app list.
4. Select **Connect**. A successful handshake discovers tools and shows their count.
5. Ask Sophon to perform a task. It discovers matching capabilities and previews each tool call before execution.

Connections do not start automatically at app startup. **Disconnect** closes the transport; closing Sophon terminates its local MCP process trees. Disabling a plugin disables its server declarations. Reconnect to refresh a changed tool catalogue.

For HTTP, Authorization accepts the full header value, such as `Bearer <token>` or `Basic <encoded credentials>`. Other headers can be set in the JSON `headers` object. Local servers accept a string-valued `env` object. Keep secrets in these fields, not command arguments or endpoint URLs.

GitHub's hosted endpoint is `https://api.githubcopilot.com/mcp/`; token configuration follows [GitHub's remote MCP documentation](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md).

The Jira / Confluence preset uses `https://mcp.atlassian.com/v2/mcp`. Where the organization enables token authentication, personal tokens use Basic auth for base64-encoded `email:token`; service account keys use Bearer auth. See [Atlassian's token authentication guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-authentication-via-api-token/).

Example local configuration:

```json
{
  "type": "stdio",
  "command": "node",
  "args": ["C:\\Tools\\my-mcp\\server.js"],
  "cwd": "C:\\Tools\\my-mcp",
  "env": { "SERVICE_TOKEN": "your-token" }
}
```

Browser OAuth sign-in, legacy SSE, marketplace updates, executable hooks and arbitrary plugin UI code are not implemented. OAuth-only services need an authenticated local bridge or supported token configuration. Adding a preset does not connect an external account. Transport behavior follows the [official MCP client guide](https://ts.sdk.modelcontextprotocol.io/client).

## Task and credential boundaries

- Configuration and snapshots are encrypted through Electron `safeStorage` in `<userData>/plugins/registry.enc`. Credential values are omitted from renderer summaries and model catalogues. Known configured secrets are redacted from returned tool text; this is not a general data-loss-prevention filter.
- The renderer uses explicit validated IPC. The model cannot create, enable, connect or reconfigure servers. Enabling reviews the exact command/endpoint.
- `mcp_call` and `mcp_read` always require one-use approval, even if their generic permission says Always allow. Run, connection identity and configuration are checked after approval. Blocked tools remain blocked.
- Research and offline tasks cannot access MCPs. Legacy desktop-only mode cannot use MCPs because servers may access the network. Standard assistant mode supports them.
- HTTP requests go only to the configured endpoint, without redirects or browser cookies. HTTPS is required except for explicit loopback HTTP. Private HTTPS endpoints are supported as user-configured destinations.
- Local processes inherit the SDK's restricted environment plus configured variables. Stderr is discarded rather than logged with possible secrets. Windows process trees use kill-on-close jobs. This controls lifetime; it is not an OS sandbox.
- Tool requests time out after 30 seconds; initialization after 20 seconds. Stop aborts and closes that connection. A cancelled or timed-out remote operation might already have changed data. The harness marks this uncertain and does not replay it. Successful MCP calls are reported results, not independently verified changes.
- Import, protocol-buffer, catalogue and result limits bound normal workloads. These do not make arbitrary third-party code trustworthy or prevent all resource exhaustion in malicious payloads.

## Verification

`npm run smoke:plugins` runs real stdio and loopback HTTP MCP fixtures: discovery, calls, resources/prompts, schema validation, cancellation, stale bindings, redirect blocking, secret omission/redaction and approval enforcement. It creates an isolated plugin fixture and checks empty initial registries, explicit imports, disabled defaults and path confinement. Its storage unit fixture substitutes encryption; the Electron UI test exercises Windows encryption.

`npm run smoke:plugins:ui` runs the production Electron UI with an isolated profile and a local fixture server. It exercises configuration, actual approval UI, encrypted storage, connecting, disconnecting and removal. It does not authenticate with third-party services.
