import https from "node:https";
import type { IncomingMessage } from "node:http";

function responseBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.pause();
      incoming.on("data", (chunk: Buffer) => {
        if (settled) return;
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });
      incoming.once("end", () => {
        if (settled) return;
        settled = true;
        controller.close();
      });
      incoming.on("error", (error) => {
        if (settled) return;
        settled = true;
        controller.error(error);
      });
      incoming.once("close", () => {
        if (settled) return;
        settled = true;
        controller.error(new Error("HTTPS response interrupted"));
      });
    },
    pull() {
      if (!settled) incoming.resume();
    },
    cancel() {
      // Guard late end/error events before destroying the socket.
      settled = true;
      incoming.destroy();
    },
  });
}

/**
 * Standard server-side HTTPS transport. Unlike Node's browser-oriented fetch,
 * it sends only the headers supplied by the API client (no Fetch Metadata).
 * TLS certificate verification is left enabled. Redirects are never followed.
 */
export const httpsTransport: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
  if (url.protocol !== "https:") throw new TypeError("HTTPS required");
  if (init?.body !== undefined && typeof init.body !== "string") {
    throw new TypeError("Only JSON string request bodies are supported");
  }
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(url, {
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers)),
      signal: init?.signal ?? undefined,
    }, (incoming) => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
        }
        const status = incoming.statusCode ?? 502;
        const emptyBody = [204, 205, 304].includes(status);
        if (emptyBody) incoming.resume();
        resolve(new Response(emptyBody ? null : responseBody(incoming), {
          status,
          headers,
        }));
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    request.on("error", reject);
    request.end(init?.body);
  });
};
