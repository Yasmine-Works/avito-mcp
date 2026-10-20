#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { AppError } from "./errors.js";

try {
  const server = createServer();
  await server.connect(new StdioServerTransport());
} catch (error) {
  // stdout is exclusively the MCP transport; never log credentials or remote bodies.
  process.stderr.write(error instanceof AppError ? `${error.code}: ${error.message}\n` : "Impossible de démarrer le serveur MCP Avito.\n");
  process.exitCode = 1;
}
