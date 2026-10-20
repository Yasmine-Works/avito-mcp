import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AvitoClient } from "../src/client.js";
import { registerAccountTools } from "../src/account-tools.js";

async function setup(response?: Record<string, unknown>) {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const mock = {
    execute: async (operation: string, variables: Record<string, unknown> = {}) => {
      calls.push({ operation, variables });
      return response ?? (operation === "AddToFavorites"
        ? { saveAd: "synthetic-acknowledgement" }
        : operation === "RemoveFromFavorites"
          ? { unsaveAd: "synthetic-acknowledgement" }
          : { result: {} });
    },
  } as unknown as AvitoClient;
  const server = new McpServer({ name: "test-account", version: "1.0.0" });
  registerAccountTools(server, mock);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

test("profile and saved searches are read-only operations without account identifiers", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  for (const name of ["avito_get_account", "avito_list_saved_searches"]) {
    const result = await client.callTool({ name, arguments: {} });
    assert.notEqual(result.isError, true);
  }
  assert.deepEqual(calls, [
    { operation: "GetMyAccountInfo", variables: {} },
    { operation: "GetMySavedSearches", variables: {} },
  ]);
  const listed = await client.listTools();
  for (const name of ["avito_get_account", "avito_list_saved_searches", "avito_list_saved_ads"]) {
    const tool = listed.tools.find((tool) => tool.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, true);
    assert.equal(tool?.annotations?.destructiveHint, false);
  }
});

test("saved ads use the APK Page input and retain listId and adId distinctly", async (t) => {
  const response = {
    getMySavedAds: { ads: [{ adId: "ad-test", listId: "list-test" }], count: { total: 1 } },
  };
  const { client, server, calls } = await setup(response);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({
    name: "avito_list_saved_ads", arguments: { page: 2, pageSize: 30 },
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(response, null, 2) }]);
  assert.deepEqual(calls, [{
    operation: "GetAccountSavedAdsQuery", variables: { page: { number: 2, size: 30 } },
  }]);
});

test("saved ads pagination rejects invalid values before invoking Avito", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  for (const arguments_ of [{ page: 0 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 101 }]) {
    const result = await client.callTool({ name: "avito_list_saved_ads", arguments: arguments_ });
    assert.equal(result.isError, true);
  }
  assert.equal(calls.length, 0);
});

test("saving and removing favorites use listId and preserve opaque string acknowledgements", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  for (const name of ["avito_save_ad", "avito_unsave_ad"]) {
    const result = await client.callTool({ name, arguments: { listId: "list-test" } });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.content), /synthetic-acknowledgement/);
    assert.doesNotMatch(JSON.stringify(result.content), /success/);
  }
  assert.deepEqual(calls, [
    { operation: "AddToFavorites", variables: { input: { listId: "list-test" } } },
    { operation: "RemoveFromFavorites", variables: { input: { listId: "list-test" } } },
  ]);
  const listed = await client.listTools();
  for (const name of ["avito_save_ad", "avito_unsave_ad"]) {
    const tool = listed.tools.find((tool) => tool.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, false);
    assert.equal(tool?.annotations?.idempotentHint, true);
    assert.equal(tool?.annotations?.destructiveHint, true);
  }
});

test("favorite tools require listId instead of adId and reject blank identifiers", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  for (const name of ["avito_save_ad", "avito_unsave_ad"]) {
    for (const args of [{ adId: "ad-test" }, { listId: " " }]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
    }
  }
  assert.equal(calls.length, 0);
});

test("missing or malformed favorite acknowledgements are uncertain and never retried", async (t) => {
  for (const [name, field] of [
    ["avito_save_ad", "saveAd"], ["avito_unsave_ad", "unsaveAd"],
  ]) {
    for (const response of [{}, { [field!]: true }, { [field!]: "" }, { [field!]: null }, { [field!]: { success: true } }]) {
      const { client, server, calls } = await setup(response);
      t.after(async () => { await client.close(); await server.close(); });
      const result = await client.callTool({ name: name!, arguments: { listId: "list-test" } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /MUTATION_OUTCOME_UNKNOWN/);
      assert.equal(calls.length, 1);
    }
  }
});
