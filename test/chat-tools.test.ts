import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AvitoClient } from "../src/client.js";
import { registerChatTools } from "../src/chat-tools.js";

async function setup(response?: Record<string, unknown>) {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const mock = {
    execute: async (operation: string, variables: Record<string, unknown> = {}) => {
      calls.push({ operation, variables });
      return response ?? (["SendChatMessage", "SendFirstChatMessage"].includes(operation)
        ? { sendChatMessage: { success: true, conversation: { id: "conversation-test", isNew: false } } }
        : operation === "MakeConversationAsRead"
          ? { markConversationAsRead: { success: true } }
          : operation === "BlockConversation"
            ? { blockConversation: { success: true } }
            : operation === "UnblockConversation"
              ? { unblockConversation: { success: true } }
          : { result: { success: true } });
    },
  } as unknown as AvitoClient;
  const server = new McpServer({ name: "test-chat", version: "1.0.0" });
  registerChatTools(server, mock);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

test("reading a conversation paginates without implicitly marking it as read", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({
    name: "avito_get_conversation",
    arguments: { conversationId: "conversation-test", beforeTime: "2026-01-01T00:00:00Z" },
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [{
    operation: "GetChatConversationById",
    variables: { id: "conversation-test", size: 20, beforeTime: "2026-01-01T00:00:00Z" },
  }]);
});

test("ambiguous pagination and out-of-bounds inputs never reach Avito", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  const ambiguous = await client.callTool({
    name: "avito_list_conversations",
    arguments: { beforeTime: "earlier", afterTime: "later" },
  });
  assert.equal(ambiguous.isError, true);
  assert.match(JSON.stringify(ambiguous.content), /INVALID_PAGINATION/);
  for (const args of [
    { size: 0 },
    { size: 101 },
    { beforeTime: " " },
    { size: 20, page: 2 },
  ]) {
    const result = await client.callTool({ name: "avito_list_conversations", arguments: args });
    assert.equal(result.isError, true);
  }
  const result = await client.callTool({
    name: "avito_get_conversation",
    arguments: { conversationId: " " },
  });
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("sending preserves exact text and advertises non-idempotent external effects", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  const text = "  Bonjour,\nCe message est un exemple synthétique.  ";
  const result = await client.callTool({
    name: "avito_send_message",
    arguments: { conversationId: "conversation-test", text },
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.content, [{
    type: "text",
    text: JSON.stringify({
      sendChatMessage: { success: true, conversation: { id: "conversation-test", isNew: false } },
    }, null, 2),
  }]);
  assert.deepEqual(calls, [{
    operation: "SendChatMessage",
    variables: { message: { conversationId: "conversation-test", text } },
  }]);
  const listed = await client.listTools();
  const send = listed.tools.find((tool) => tool.name === "avito_send_message");
  assert.equal(send?.annotations?.readOnlyHint, false);
  assert.equal(send?.annotations?.destructiveHint, true);
  assert.equal(send?.annotations?.idempotentHint, false);
});

test("blank messages are rejected while mark-read remains an explicit mutation", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({
    name: "avito_send_message",
    arguments: { conversationId: "conversation-test", text: " \n\t" },
  });
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
  await client.callTool({
    name: "avito_mark_read",
    arguments: { conversationId: "conversation-test" },
  });
  assert.deepEqual(calls, [{
    operation: "MakeConversationAsRead",
    variables: { id: "conversation-test" },
  }]);
});

test("chat mutations report explicit rejection instead of success", async (t) => {
  for (const [tool, field] of [
    ["avito_send_message", "sendChatMessage"],
    ["avito_send_first_message", "sendChatMessage"],
    ["avito_mark_read", "markConversationAsRead"],
    ["avito_block_conversation", "blockConversation"],
    ["avito_unblock_conversation", "unblockConversation"],
  ] as const) {
    const { client, server, calls } = await setup({ [field]: { success: false } });
    t.after(async () => { await client.close(); await server.close(); });
    const result = await client.callTool({
      name: tool,
      arguments: tool === "avito_send_first_message"
        ? { adId: "ad-test", text: "Test synthétique" }
        : { conversationId: "conversation-test", ...(tool === "avito_send_message" ? { text: "Test synthétique" } : {}) },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /CHAT_ACTION_REJECTED/);
    assert.equal(calls.length, 1);
  }
});

test("malformed chat mutation acknowledgements preserve outcome uncertainty without retry", async (t) => {
  for (const [tool, field] of [
    ["avito_send_message", "sendChatMessage"],
    ["avito_send_first_message", "sendChatMessage"],
    ["avito_mark_read", "markConversationAsRead"],
    ["avito_block_conversation", "blockConversation"],
    ["avito_unblock_conversation", "unblockConversation"],
  ] as const) {
    for (const response of [{}, { [field]: null }, { [field]: {} }, { [field]: { success: "true" } }]) {
      const { client, server, calls } = await setup(response);
      t.after(async () => { await client.close(); await server.close(); });
      const result = await client.callTool({
        name: tool,
        arguments: tool === "avito_send_first_message"
          ? { adId: "ad-test", text: "Test synthétique" }
          : { conversationId: "conversation-test", ...(tool === "avito_send_message" ? { text: "Test synthétique" } : {}) },
      });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /MUTATION_OUTCOME_UNKNOWN/);
      assert.match(JSON.stringify(result.content), /vérifiez d’abord la conversation/);
      assert.equal(calls.length, 1);
    }
  }
});

test("finding a conversation by ad never opens one or marks it read", async (t) => {
  const { client, server, calls } = await setup({
    getMyChatConversationWithAd: { found: false, conversationId: null },
  });
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({
    name: "avito_find_conversation_for_ad",
    arguments: { adId: "ad-test" },
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [{ operation: "GetChatConversationWithAd", variables: { adId: "ad-test" } }]);
  assert.match(JSON.stringify(result.content), /false/);
});

test("a first message uses the APK adId input and preserves the user's text", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  const text = "  Bonjour,\nCette annonce est-elle disponible ?  ";
  const result = await client.callTool({
    name: "avito_send_first_message",
    arguments: { adId: "ad-test", text },
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [{
    operation: "SendFirstChatMessage",
    variables: { message: { adId: "ad-test", text } },
  }]);
  const listed = await client.listTools();
  const send = listed.tools.find((tool) => tool.name === "avito_send_first_message");
  assert.equal(send?.annotations?.readOnlyHint, false);
  assert.equal(send?.annotations?.idempotentHint, false);
  assert.equal(send?.annotations?.destructiveHint, true);
});

test("first messages reject empty ad IDs, blank text, and listId substitutions", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  for (const args of [
    { adId: " ", text: "Bonjour" },
    { adId: "ad-test", text: " \n" },
    { listId: "list-test", text: "Bonjour" },
    { conversationId: "conversation-test", text: "Bonjour" },
  ]) {
    const result = await client.callTool({ name: "avito_send_first_message", arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(calls.length, 0);
});

test("block and unblock are explicit mutations with the exact conversation ID", async (t) => {
  const { client, server, calls } = await setup();
  t.after(async () => { await client.close(); await server.close(); });
  for (const name of ["avito_block_conversation", "avito_unblock_conversation"]) {
    const result = await client.callTool({ name, arguments: { conversationId: "conversation-test" } });
    assert.notEqual(result.isError, true);
  }
  assert.deepEqual(calls, [
    { operation: "BlockConversation", variables: { id: "conversation-test" } },
    { operation: "UnblockConversation", variables: { id: "conversation-test" } },
  ]);
  const listed = await client.listTools();
  for (const name of ["avito_block_conversation", "avito_unblock_conversation"]) {
    const tool = listed.tools.find((tool) => tool.name === name);
    assert.equal(tool?.annotations?.readOnlyHint, false);
    assert.equal(tool?.annotations?.destructiveHint, true);
    assert.equal(tool?.annotations?.idempotentHint, true);
  }
});
