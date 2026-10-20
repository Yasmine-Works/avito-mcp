// Build first. Validate the packed artifact, then install it in a fresh directory
// and exercise its actual npm binary without any Avito credentials or network calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "avito-mcp-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let client;
let transport;
try {
  const pack = JSON.parse(execFileSync(npm, [
    "pack", "--ignore-scripts", "--json", "--pack-destination", scratch,
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
  assert.equal(pack.name, "avito-ma-mcp");
  assert.equal(pack.version, pkg.version);
  assert.equal(pkg.private, undefined, "package must be publishable");
  assert.equal(pkg.publishConfig.access, "public");
  const paths = new Set(pack.files.map((file) => file.path));
  for (const required of ["package.json", "dist/index.js", "dist/server.js", "README.md", "docs/clients.md"]) {
    assert.ok(paths.has(required), `missing required file: ${required}`);
  }
  const docs = ["README.md", "docs/clients.md", "docs/usage.fr.md", ".env.example", "LICENSE"];
  for (const path of paths) {
    assert.ok(path === "package.json" || docs.includes(path) || /^dist\/[a-z-]+\.js$/.test(path),
      `unexpected packaged file: ${path}`);
    assert.ok(!/\.(?:map|apk|xapk|chlz|chls|har|tgz)$/i.test(path), `private or unnecessary artifact: ${path}`);
  }
  for (const file of readdirSync(join(root, "dist"))) {
    if (file.endsWith(".js")) assert.ok(paths.has(`dist/${file}`), `missing compiled module: ${file}`);
  }
  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  execFileSync(npm, [
    "install", "--prefix", consumer, "--no-save", "--package-lock=false",
    "--ignore-scripts", "--no-audit", "--no-fund", join(scratch, pack.filename),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const bin = join(consumer, "node_modules", ".bin", process.platform === "win32" ? "avito-ma-mcp.cmd" : "avito-ma-mcp");
  transport = new StdioClientTransport({
    command: bin,
    args: [],
    cwd: consumer,
    env: { PATH: process.env.PATH ?? "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  client = new Client({ name: "npm-package-verification", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 35);
  const status = await client.callTool({ name: "avito_session_status", arguments: {} });
  assert.notEqual(status.isError, true);
  const statusData = JSON.parse(status.content[0].text);
  assert.equal(statusData.credentialsConfigured, false);
  assert.equal(statusData.authenticated, false);
  const link = await client.callTool({ name: "avito_public_search_link", arguments: { query: "appartement" } });
  assert.notEqual(link.isError, true);
  assert.equal(JSON.parse(link.content[0].text).resultsFetched, false);
  const protectedCall = await client.callTool({ name: "avito_unread_count", arguments: {} });
  assert.equal(protectedCall.isError, true);
  assert.match(JSON.stringify(protectedCall.content), /CREDENTIALS_REQUIRED/);
  assert.equal(stderr, "", "the package must start without errors or stdout noise");
  console.log(JSON.stringify({
    package: `${pkg.name}@${pkg.version}`, files: paths.size,
    packedBytes: pack.size, unpackedBytes: pack.unpackedSize,
    installedBinary: "passed", mcpTools: tools.length, accountNetworkRequests: 0,
  }, null, 2));
} finally {
  await client?.close();
  await transport?.close();
  rmSync(scratch, { recursive: true, force: true });
}
