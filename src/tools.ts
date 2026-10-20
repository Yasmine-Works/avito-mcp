import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError } from "./errors.js";

const secretKey = /^(token|access_?token|refresh_?token|password|pass|authorization|cookie|set-cookie|secret)$/iu;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, secretKey.test(key) ? "[REDACTED]" : redactSecrets(item)]));
  }
  return value;
}

export function addTool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: S; readOnly?: boolean; idempotent?: boolean; destructive?: boolean },
  handler: (args: z.output<z.ZodObject<S>>) => Promise<unknown>,
) {
  // Reject guessed parameters instead of silently stripping them (e.g. page
  // numbers on a cursor-only operation).
  const inputSchema = z.strictObject(config.inputSchema as z.ZodRawShape);
  server.registerTool<z.ZodRawShape, typeof inputSchema>(name, {
    description: config.description,
    inputSchema,
    annotations: {
      readOnlyHint: config.readOnly ?? true,
      destructiveHint: config.destructive ?? false,
      idempotentHint: config.idempotent ?? config.readOnly ?? true,
      openWorldHint: true,
    },
  }, async (args) => {
    try {
      const data = redactSecrets(await handler(args as z.output<z.ZodObject<S>>));
      return { content: [{ type: "text" as const, text: JSON.stringify(data ?? null, null, 2) }] };
    } catch (error) {
      const known = error instanceof AppError;
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({
          error: { code: known ? error.code : "TOOL_ERROR", message: known ? error.message : "L'opération a échoué. Vérifiez les paramètres et la configuration." },
        }) }],
      };
    }
  });
}
