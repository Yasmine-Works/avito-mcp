import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("built server speaks MCP over stdio, exposes tools, and reports a public link honestly", async () => {
  const client = new Client({ name: "avito-offline-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { PATH: process.env.PATH ?? "" },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 35);
    assert.ok(tools.every((tool) => tool.name.startsWith("avito_")));
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of ["avito_search_ads", "avito_send_first_message", "avito_save_ad", "avito_deactivate_ad"]) {
      assert.ok(names.has(name), name);
    }
    const result = await client.callTool({ name: "avito_session_status", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /credentialsConfigured/);
    const link = await client.callTool({ name: "avito_public_search_link", arguments: { query: "iphone 11" } });
    assert.match(JSON.stringify(link.content), /resultsFetched/);
    assert.match(JSON.stringify(link.content), /false/);
    const missingCredentials = await client.callTool({ name: "avito_unread_count", arguments: {} });
    assert.equal(missingCredentials.isError, true);
    assert.match(JSON.stringify(missingCredentials.content), /CREDENTIALS_REQUIRED/);
  } finally {
    await client.close();
    await transport.close();
  }
  assert.equal(stderr, "");
});
