import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { apkDocuments } from "../src/apk-documents.js";
import { documents } from "../src/documents.js";

test("every added executable document matches the APK extraction verbatim", () => {
  const inventory = JSON.parse(readFileSync(new URL("../docs/apk-graphql-inventory.json", import.meta.url), "utf8"));
  assert.equal(inventory.application.package_name, "se.scmv.morocco");
  assert.equal(inventory.application.version_name, "10.1.0");
  assert.equal(inventory.operationCount, 70);
  assert.equal(inventory.baseApkSha256, "06eb8daa18d4a5b7613873c47961953205c6f1f34ed568e8c62bdc6a9ec2a9cc");
  for (const [name, document] of Object.entries(apkDocuments)) {
    assert.equal(document, inventory.operations[name]?.document, name);
    assert.equal(documents[name], document, name);
  }
  for (const unsupported of ["DeactivateAccountMutation", "ResetMyPasswordMutation", "FinalizePurchaseOrder", "SubmitAdMutation"]) {
    assert.ok(inventory.operations[unsupported]);
    assert.equal(Object.hasOwn(documents, unsupported), false);
  }
});
