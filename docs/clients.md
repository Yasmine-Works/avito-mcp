# Connect Avito.ma MCP to your client

Install [Node.js 22+](https://nodejs.org/) with npm on the machine where your client runs. Check `node --version` and `npx --version` in a terminal. This server uses **stdio**: your client starts a local process and communicates over its standard input and output. There is no server URL to paste.

Examples pin `avito-ma-mcp@0.2.0`. Public search works without credentials. Account features require the optional configuration below. The GitHub repository is named [`avito-mcp`](https://github.com/Yasmine-Works/avito-mcp); the npm package is named [`avito-ma-mcp`](https://www.npmjs.com/package/avito-ma-mcp).

## Claude Desktop

1. Open **Settings → Developer → Edit Config** in the desktop app.
2. Merge the `avito` entry below into `mcpServers`, preserving existing servers.
3. Save, fully quit, and reopen Claude Desktop.
4. Check the configured server's tools, then ask Claude to call `avito_session_status` or search public Avito listings.

The configuration file is:

| System | Location |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "avito": {
      "command": "npx",
      "args": ["-y", "avito-ma-mcp@0.2.0"]
    }
  }
}
```

On clients that cannot launch `npx` directly on Windows, use this server entry:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "avito-ma-mcp@0.2.0"]
}
```

Use the [environment-file setup](#keep-credentials-in-a-private-environment-file) below for account access. Connection logs are under `~/Library/Logs/Claude` on macOS and `%APPDATA%\Claude\logs` on Windows.

Sources: [official MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Claude Desktop local MCP help](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## Claude Code

Register a public-mode server for your user:

```sh
claude mcp add --transport stdio --scope user avito -- npx -y avito-ma-mcp@0.2.0
```

Check it with `claude mcp get avito`, or run `/mcp` inside Claude Code. For a shared project configuration, use `--scope project`; keep credentials out of the resulting `.mcp.json`.

For account access, install the package and create the private environment file described below, then register the Node command instead:

```sh
claude mcp add --transport stdio --scope user avito -- node --env-file=/absolute/path/avito.env /absolute/path/node_modules/avito-ma-mcp/dist/index.js
```

Use the actual installed path. If replacing an existing entry, remove it first with `claude mcp remove avito`. A native Windows setup that cannot launch `npx` directly can use `-- cmd /c npx -y avito-ma-mcp@0.2.0`.

Source: [Claude Code MCP reference](https://code.claude.com/docs/en/mcp).

## Cursor

Use `~/.cursor/mcp.json` for a personal configuration or `.cursor/mcp.json` in your project for a shared configuration. Add:

```json
{
  "mcpServers": {
    "avito": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "avito-ma-mcp@0.2.0"]
    }
  }
}
```

Enable the server in Cursor's MCP/customization settings and check that its tools load. Cursor also supports an `envFile` field for stdio servers:

```json
"envFile": "/absolute/path/avito.env"
```

Place the credentials in that private file, outside the repository. The Node `--env-file` setup below also works.

Source: [Cursor MCP documentation](https://cursor.com/docs/context/mcp).

## VS Code / GitHub Copilot

Run **MCP: Add Server** from the Command Palette, choose **Command (stdio)**, and enter:

```sh
npx -y avito-ma-mcp@0.2.0
```

Name it `avito`. For compatible Copilot harness sessions, a personal setup uses **Global → Copilot Global**; the portable file is `$COPILOT_HOME/mcp-config.json`, falling back to `~/.copilot/mcp-config.json`. A workspace portable configuration uses `.mcp.json`. These files use:

```json
{
  "mcpServers": {
    "avito": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "avito-ma-mcp@0.2.0"]
    }
  }
}
```

The VS Code format, supported for Local harness configurations, uses `.vscode/mcp.json` or a user-profile MCP file and a different top-level key:

```json
{
  "servers": {
    "avito": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "avito-ma-mcp@0.2.0"]
    }
  }
}
```

Approve the server trust prompt, enable its tools, and verify a public tool call. For account access across either format, replace `command` and `args` with the Node environment-file example below. Portable configurations do not support VS Code's `envFile` or interactive input variables.

Sources: [Add MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## Other MCP clients

Choose a **local / stdio / command** server and supply:

| Field | Value |
| --- | --- |
| Name | `avito` |
| Command | `npx` |
| Arguments | `-y`, `avito-ma-mcp@0.2.0` |
| Environment | Optional Avito credentials; see below |

Arguments must be separate array elements when the client expects JSON. Do not enter an HTTP or SSE URL. Clients with a `mcpServers` JSON format can use the Claude Desktop example; check your client's schema.

## Keep credentials in a private environment file

The server reads its process environment; it does **not** automatically load `.env`. Node's `--env-file` option explicitly loads the file before starting the server.

1. Install a fixed package version and locate it:

   ```sh
   npm install --global avito-ma-mcp@0.2.0
   npm root --global
   ```

   Append `/avito-ma-mcp/dist/index.js` to the directory reported by `npm root --global`. Use that full path in the configuration. A source checkout's `/absolute/path/avito-mcp/dist/index.js` works after `npm ci` and `npm run build`.

2. Create a file outside any shared repository, such as `/absolute/path/avito.env`, using a local text editor:

   ```dotenv
   AVITO_USERNAME="your-username"
   AVITO_PASSWORD="your-password"
   ```

   Quote values containing spaces or `#`. Protect the file with `chmod 600 /absolute/path/avito.env` on macOS/Linux, or Windows file permissions restricted to your account. Keep it out of version control, screenshots, shared configuration, and chat.

3. Replace the server's command and arguments:

   ```json
   {
     "mcpServers": {
       "avito": {
         "command": "node",
         "args": [
           "--env-file=/absolute/path/avito.env",
           "/absolute/path/node_modules/avito-ma-mcp/dist/index.js"
         ]
       }
     }
   }
   ```

   For VS Code's `.vscode/mcp.json`, change the top-level key to `servers` and add `"type": "stdio"` inside the entry. For Windows, use actual absolute paths, for example `C:/Users/your-user/...`; forward slashes work in Node paths and avoid JSON backslash escaping.

4. Restart or reconnect the server. Call `avito_session_status` to inspect local configuration without exposing credentials, then use `avito_login` or an account read when you want to verify login.

Alternatively, your client may supply `AVITO_USERNAME` and `AVITO_PASSWORD` through its `env` configuration. An existing `AVITO_ACCESS_TOKEN` is another option. These are plaintext secrets unless your client explicitly provides secure storage. Avoid passing passwords on a shell command line, where they can enter shell history.

## Verify the connection and troubleshoot

- **No tools / process not found:** verify Node 22+ and npm are installed. GUI apps may have a different `PATH` from your shell. Use absolute executable paths; find them with `command -v node` / `command -v npx` on macOS/Linux, or `where.exe node` / `where.exe npx` on Windows.
- **The terminal appears to hang:** normal when launching the server manually. It waits for MCP messages on stdin. Stop it with Ctrl+C; your client should launch its own process.
- **Invalid JSON:** merge server entries carefully. JSON does not allow comments or trailing commas.
- **Public reads work but account tools fail:** check the private environment file path and credentials, reconnect, then call `avito_login`. No live account compatibility is guaranteed.
- **An action times out:** inspect the conversation, listing, boosts, or wallet before trying again. A timeout does not prove that a message or purchase failed.
- **Wrong tools or old version:** confirm that the package is `avito-ma-mcp` and your configuration pins the intended version; restart the client after changing it.

Suggested first prompt: “Call `avito_session_status`, then search Avito for iPhones between 1,000 and 5,000 MAD sorted by price. Do not send messages or purchase boosts.”

Messages, favorites, read markers, and blocking change account state. Boost purchases can spend wallet credit; activating/deactivating listings changes their status. Review these actions in your client before approval. See [actions and costs](../README.md#actions-and-costs).

Client instructions were checked against the linked official documentation on 20 October 2026.
