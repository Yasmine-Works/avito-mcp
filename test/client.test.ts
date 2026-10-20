import assert from "node:assert/strict";
import test from "node:test";
import { AvitoClient } from "../src/client.js";
import { redactSecrets } from "../src/tools.js";

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const token = "synthetic-access-token-not-a-real-credential";
const credentials = { username: "demo@example.invalid", password: "synthetic-password" };
type Request = { url: string; auth: string | null; operation: string; variables: Record<string, unknown>; redirect?: RequestRedirect };

function fakeClient(respond: (request: Request) => Response | Promise<Response>, withCredentials = false) {
  const calls: Request[] = [];
  const transport: typeof fetch = async (url, options) => {
    const body = JSON.parse(options!.body as string);
    const call: Request = {
      url: String(url), auth: new Headers(options!.headers).get("authorization"),
      operation: body.operationName, variables: body.variables, redirect: options?.redirect,
    };
    calls.push(call);
    return respond(call);
  };
  const client = new AvitoClient({ ...(withCredentials ? credentials : { accessToken: token }), fetch: transport });
  return { client, calls };
}

test("login is lazy and single-flight; credentials go only to the fixed gateway and never in results", async () => {
  const { client, calls } = fakeClient((call) => reply({ data: call.operation === "LoginByIdentifierMutation"
    ? { loginByIdentifier: { accessToken: token, refreshToken: "synthetic-refresh" } }
    : { getMyChat: { unreadCount: 2 } } }), true);
  assert.equal(client.status().authenticated, false);
  assert.equal(calls.length, 0);
  const result = await Promise.all([client.execute("GetUnreadCount"), client.execute("GetUnreadCount")]);
  assert.equal(calls.filter((c) => c.operation === "LoginByIdentifierMutation").length, 1);
  assert.equal(calls[0]!.auth, null);
  assert.deepEqual(calls[0]!.variables, { identifier: credentials.username, pass: credentials.password });
  assert.ok(calls.slice(1).every((c) => c.auth === `Bearer ${token}`));
  assert.ok(calls.every((c) => c.url === "https://gateway.avito.ma/graphql" && c.redirect === "error"));
  assert.doesNotMatch(JSON.stringify([result, client.status()]), /synthetic|password|example\.invalid/);
});

test("GraphQL login errors are useful but remote error content is never exposed", async () => {
  const { client } = fakeClient(() => reply({ errors: [{ message: "DO_NOT_LEAK synthetic-password", extensions: { code: "WRONG_CREDS" } }] }), true);
  await assert.rejects(client.login(), (error: any) => error.code === "WRONG_CREDS" && !error.message.includes("DO_NOT_LEAK"));
});

test("401 invalidates the token without replaying a mutation", async () => {
  const { client, calls } = fakeClient(() => new Response(null, { status: 401 }));
  await assert.rejects(client.execute("SendChatMessage", { message: { conversationId: "demo", text: "Bonjour" } }), { code: "AUTH_EXPIRED" });
  assert.equal(calls.length, 1);
  assert.equal(client.status().authenticated, false);
});

test("network failures and bad mutation responses report uncertain outcome without retry", async () => {
  for (const respond of [
    () => { throw new Error("secret-in-network-error"); },
    () => new Response("unexpected html", { status: 200 }),
    () => reply({ errors: [{ message: "secret-in-graphql-error" }] }),
  ]) {
    const { client, calls } = fakeClient(respond);
    await assert.rejects(client.execute("SendChatMessage"), (error: any) =>
      error.code === "MUTATION_OUTCOME_UNKNOWN" && !error.message.includes("secret"));
    assert.equal(calls.length, 1);
  }
});

test("logout cancels a pending login and prevents automatic reconnect", async () => {
  let resolve!: (response: Response) => void;
  const { client, calls } = fakeClient(() => new Promise<Response>((done) => { resolve = done; }), true);
  const pending = client.execute("GetUnreadCount");
  client.logout();
  resolve(reply({ data: { loginByIdentifier: { accessToken: token } } }));
  await assert.rejects(pending, { code: "SESSION_CHANGED" });
  await assert.rejects(client.execute("GetUnreadCount"), { code: "AUTH_REQUIRED" });
  assert.equal(calls.length, 1);
});

test("logout at the login/execute boundary never sends an unauthenticated account request", async () => {
  const { client, calls } = fakeClient(() => reply({ data: { loginByIdentifier: { accessToken: token } } }), true);
  let finished = false;
  const monitor = () => {
    if (finished) return;
    if (client.status().authenticated) client.logout();
    else queueMicrotask(monitor);
  };
  queueMicrotask(monitor);
  try { await assert.rejects(client.execute("GetUnreadCount"), { code: "AUTH_REQUIRED" }); }
  finally { finished = true; }
  assert.equal(calls.length, 1);
});

test("a session change during mutation does not imply that the mutation failed", async () => {
  let resolve!: (response: Response) => void;
  const { client } = fakeClient(() => new Promise<Response>((done) => { resolve = done; }));
  const pending = client.execute("SendChatMessage");
  client.logout();
  resolve(reply({ data: { sendChatMessage: { success: true } } }));
  await assert.rejects(pending, { code: "MUTATION_OUTCOME_UNKNOWN" });
});

test("a quote session guard rejects authentication changes before transmitting a payment", async () => {
  const { client, calls } = fakeClient(() => reply({ data: { loginByIdentifier: { accessToken: token } } }), true);
  const oldGeneration = client.sessionGeneration;
  await assert.rejects(client.execute("InitiateOrderMutation", {}, oldGeneration), { code: "SESSION_CHANGED" });
  assert.deepEqual(calls.map((c) => c.operation), ["LoginByIdentifierMutation"]);
});

test("unsupported operations are rejected before any network call", async () => {
  const { client, calls } = fakeClient(() => reply({ data: {} }));
  await assert.rejects(client.execute("UnknownMutation"), { code: "UNSUPPORTED_OPERATION" });
  await assert.rejects(client.execute("toString"), { code: "UNSUPPORTED_OPERATION" });
  assert.equal(calls.length, 0);
});

test("nested token fields are redacted while message text remains intact", () => {
  assert.deepEqual(redactSecrets({ data: [{ accessToken: token, token, text: "Bonjour", nested: { password: "x" } }] }),
    { data: [{ accessToken: "[REDACTED]", token: "[REDACTED]", text: "Bonjour", nested: { password: "[REDACTED]" } }] });
});

test("public operations never send the configured token or trigger a login", async () => {
  const { client, calls } = fakeClient(() => reply({ data: { publishedAndNC: { publishedAndNCAds: [] } } }));
  await client.executePublic("GetListingAds", { startNewScroll: true });
  client.logout();
  await client.executePublic("GetListingAds", { startNewScroll: true });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.operation === "GetListingAds" && call.auth === null));
});

test("public transport rejects private reads and mutations before any request", async () => {
  const { client, calls } = fakeClient(() => reply({ data: {} }));
  for (const operation of ["LoginByIdentifierMutation", "SendFirstChatMessage", "GetMyAccountInfo", "activateAd"]) {
    await assert.rejects(client.executePublic(operation), { code: "UNSUPPORTED_PUBLIC_OPERATION" });
  }
  assert.equal(calls.length, 0);
});

test("anonymous public browsing requires no environment credentials", async () => {
  const calls: string[] = [];
  const client = new AvitoClient({ fetch: async (_, options) => {
    calls.push(JSON.parse(options!.body as string).operationName);
    return reply({ data: { autoCompleteSearch: { suggestions: [] } } });
  } });
  await client.executePublic("AutoCompleteSearch", { query: "voiture" });
  assert.deepEqual(calls, ["AutoCompleteSearch"]);
  assert.equal(client.status().credentialsConfigured, false);
});
