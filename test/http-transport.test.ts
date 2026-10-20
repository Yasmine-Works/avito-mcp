import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { httpsTransport } from "../src/http-transport.js";

function intercept(t: any, status: number, body = '{"data":{}}') {
  const calls: any[] = [];
  t.mock.method(https, "request", (url: URL, options: unknown, receive: (stream: unknown) => void) => {
    const request = Object.assign(new EventEmitter(), {
      end(sent: unknown) {
        calls.push({ url, options, sent });
        queueMicrotask(() => {
          const stream = Object.assign(new PassThrough(), {
            statusCode: status, headers: { "content-type": "application/json" },
          });
          receive(stream);
          stream.end(body);
        });
      },
    });
    return request;
  });
  return calls;
}

test("native HTTPS sends exact JSON and supplied headers, and streams the response", async (t) => {
  const calls = intercept(t, 200, '{"data":{"ok":true}}');
  const signal = AbortSignal.timeout(5000);
  const response = await httpsTransport("https://gateway.avito.ma/graphql", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"query":"example"}', signal,
  });
  assert.deepEqual(await response.json(), { data: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sent, '{"query":"example"}');
  assert.deepEqual(calls[0].options.headers, { "content-type": "application/json" });
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.rejectUnauthorized, undefined); // Node's secure default.
});

test("native transport returns redirects without following them", async (t) => {
  const calls = intercept(t, 302);
  const response = await httpsTransport("https://gateway.avito.ma/graphql", { method: "POST", body: "{}" });
  assert.equal(response.status, 302);
  await response.body?.cancel();
  assert.equal(calls.length, 1);
});

test("malformed HTTP response status rejects the promise instead of crashing the process", async (t) => {
  intercept(t, 700);
  await assert.rejects(httpsTransport("https://gateway.avito.ma/graphql"));
});

test("the transport refuses cleartext URLs and non-JSON request body types", async () => {
  await assert.rejects(httpsTransport("http://gateway.avito.ma/graphql"), /HTTPS required/);
  await assert.rejects(httpsTransport("https://gateway.avito.ma/graphql", { body: new FormData() }), /JSON string/);
});
