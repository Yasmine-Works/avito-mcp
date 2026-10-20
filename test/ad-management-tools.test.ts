import assert from "node:assert/strict";
import test from "node:test";
import { createAdManagementHandlers } from "../src/ad-management-tools.js";
import type { AvitoClient } from "../src/client.js";

function setup(data: Record<string, unknown>) {
  const calls: Array<{ operation: string; variables: unknown }> = [];
  const handlers = createAdManagementHandlers({
    execute: async (operation: string, variables: unknown) => { calls.push({ operation, variables }); return data; },
  } as unknown as AvitoClient);
  return { handlers, calls };
}

test("activation preserves GraphQL field casing and requires explicit confirmation", async () => {
  const { handlers, calls } = setup({ ActivateAd: { adId: "ad-demo", error: null } });
  await assert.rejects(handlers.activateAd({ adId: "ad-demo", confirm: false }), { code: "CONFIRMATION_REQUIRED" });
  assert.equal(calls.length, 0);
  assert.equal((await handlers.activateAd({ adId: "ad-demo", confirm: true })).status, "accepted");
  assert.deepEqual(calls, [{ operation: "activateAd", variables: { adId: "ad-demo" } }]);
});

test("single-ad deactivation uses the APK bulk wire contract and reason enums", async () => {
  const { handlers, calls } = setup({ bulkDeactivateAds: [{ adId: "ad-demo", error: null }] });
  const reason = { reason: "SOLD_ON_SITE" as const, soldOnSiteDuration: "ONE_WEEK" as const };
  await handlers.deactivateAd({ adId: "ad-demo", reason, confirm: true });
  assert.deepEqual(calls, [{ operation: "bulkDeactivateAds", variables: { adIds: ["ad-demo"], reason } }]);
});

test("business errors, missing acknowledgement and mismatched IDs cannot be reported as accepted", async () => {
  const { handlers } = setup({ ActivateAd: { adId: "ad-demo", error: { code: "REFUSED", label: "remote content" } } });
  await assert.rejects(handlers.activateAd({ adId: "ad-demo", confirm: true }), { code: "AD_ACTION_REJECTED" });
  for (const payload of [
    { ActivateAd: null },
    { ActivateAd: { adId: "different-ad", error: null } },
    { ActivateAd: { adId: "ad-demo" } },
  ]) {
    await assert.rejects(setup(payload).handlers.activateAd({ adId: "ad-demo", confirm: true }), { code: "MUTATION_OUTCOME_UNKNOWN" });
  }
  await assert.rejects(setup({ bulkDeactivateAds: [] }).handlers.deactivateAd({
    adId: "ad-demo", reason: { reason: "OTHER", otherReasonText: "Exemple" }, confirm: true,
  }), { code: "MUTATION_OUTCOME_UNKNOWN" });
});

test("an uncertain deactivation is submitted only once", async () => {
  let count = 0;
  const handlers = createAdManagementHandlers({
    execute: async () => { count++; throw new Error("synthetic timeout"); },
  } as unknown as AvitoClient);
  await assert.rejects(handlers.deactivateAd({ adId: "ad-demo", reason: { reason: "GIVE_UP" }, confirm: true }));
  assert.equal(count, 1);
});
