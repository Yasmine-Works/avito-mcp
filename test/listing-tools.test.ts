import assert from "node:assert/strict";
import test from "node:test";
import type { AvitoClient } from "../src/client.js";
import { createListingHandlers } from "../src/listing-tools.js";
import { MY_AD_STATUSES, PERFORMANCE_RANGES } from "../src/apk-enums.js";

const args = {
  adId: "example-ad",
  packId: "example-pack",
  executionDay: "2030-01-01",
  executionSlotId: "9",
};

function catalog(price = 6) {
  return {
    getVasPackages: {
      categories: [{
        key: "bump",
        title: "BASIC",
        vasPackages: [{
          id: args.packId,
          durationDays: 3,
          price,
          priceUnit: "AVITO_TOKEN",
        }],
      }],
      availableExecutionSlots: {
        days: [args.executionDay],
        hours: [{ id: "9", start: "08:00", end: "09:00" }],
      },
    },
  };
}

class FakeClient {
  sessionGeneration = 1;
  storeId?: string;
  price = 6;
  calls: Array<{ operation: string; variables: Record<string, unknown> }> = [];
  mutationError = false;
  invalidOrderResponse = false;
  verificationError = false;
  afterCatalog?: () => void;

  async execute(operation: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ operation, variables });
    if (operation === "GetVasPackagesShop") {
      this.afterCatalog?.();
      return catalog(this.price);
    }
    if (operation === "InitiateOrderMutation") {
      if (this.mutationError) throw new Error("sensitive backend detail");
      if (this.invalidOrderResponse) return { initiateOrder: null };
      return { initiateOrder: { paymentLink: "", paymentCode: "", expiryDate: "2030-01-01" } };
    }
    if (operation === "GetMyFilteredAdsQuery") {
      if (this.verificationError) throw new Error("sensitive backend detail");
      return {
        getMyFilteredAds: {
          ads: [{
            adId: args.adId,
            listId: "different-list-id",
            status: "ACTIVE",
            lastAppliedVasPack: { name: "Tête de liste 3j", status: "active" },
            vasPackages: { count: 1 },
          }],
        },
      };
    }
    return {};
  }

  get mutationCount(): number {
    return this.calls.filter((entry) => entry.operation === "InitiateOrderMutation").length;
  }
}

function setup() {
  const client = new FakeClient();
  let clock = Date.UTC(2029, 11, 31);
  return {
    client,
    handlers: createListingHandlers(client as unknown as AvitoClient, { now: () => clock }),
    advance: (milliseconds: number) => { clock += milliseconds; },
  };
}

test("account filters preserve the APK fields and share the same facet filter", async () => {
  const { client, handlers } = setup();
  const filters = {
    status: "DEACTIVATED" as const,
    keyword: "voiture",
    categoryIds: [100],
    cityIds: [56],
    boosted: false,
    priceMin: 0,
    priceMax: 30000,
    params: [{ key: "brand", values: ["example-brand"] }],
    adTypes: ["sell"],
  };
  const query = { ...filters, page: 2, pageSize: 20 };
  await handlers.searchMyAds(query);
  await handlers.getFacets(query);
  assert.deepEqual(client.calls, [
    { operation: "GetMyFilteredAdsQuery", variables: { filter: filters, page: { number: 2, size: 20 } } },
    { operation: "GetMyFilteredAdsFacetsQuery", variables: { filter: filters, page: { number: 2, size: 20 } } },
  ]);
});

test("account reads support all recovered statuses and statistics ranges", async () => {
  const { client, handlers } = setup();
  for (const status of MY_AD_STATUSES) {
    await handlers.searchMyAds({ status, page: 1, pageSize: 35 });
    assert.deepEqual(client.calls.at(-1)?.variables, {
      filter: { status }, page: { number: 1, size: 35 },
    });
  }
  for (const range of PERFORMANCE_RANGES) {
    await handlers.getStatistics({ range });
    assert.deepEqual(client.calls.at(-1), {
      operation: "GetAccountStatisticsQuery", variables: { range },
    });
  }
});

test("inverted account price ranges are rejected before sending a request", async () => {
  const { client, handlers } = setup();
  const query = { status: "ACTIVE" as const, page: 1, pageSize: 35, priceMin: 10, priceMax: 0 };
  await assert.rejects(handlers.searchMyAds(query), { code: "INVALID_PRICE_RANGE" });
  await assert.rejects(handlers.getFacets(query), { code: "INVALID_PRICE_RANGE" });
  assert.equal(client.calls.length, 0);
});

test("store information uses the configured ID or an explicit override", async () => {
  const { client, handlers } = setup();
  client.storeId = "configured-store";
  await handlers.getStore({});
  assert.deepEqual(client.calls.at(-1), {
    operation: "getMyStoreInfo",
    variables: { storeId: "configured-store" },
  });
  await handlers.getStore({ storeId: "explicit-store" });
  assert.deepEqual(client.calls.at(-1), {
    operation: "getMyStoreInfo",
    variables: { storeId: "explicit-store" },
  });
});

test("store information without a configured or explicit ID fails before the network", async () => {
  const { client, handlers } = setup();
  await assert.rejects(handlers.getStore({}), { code: "STORE_ID_REQUIRED" });
  assert.equal(client.calls.length, 0);
});

test("prepare is read-only and execution preserves adId, price unit and slot ID", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  assert.equal(client.mutationCount, 0);
  assert.equal(quote.price, 6);
  assert.equal(quote.priceUnit, "AVITO_TOKEN");
  assert.equal(quote.paymentMethod, "WALLET");
  const result = await handlers.executeBoost({ quoteId: quote.quoteId, confirm: true });
  assert.equal(client.mutationCount, 1);
  const mutation = client.calls.find((entry) => entry.operation === "InitiateOrderMutation")!;
  assert.deepEqual(mutation.variables, {
    input: {
      adId: args.adId,
      packId: args.packId,
      application: "ADLISTING",
      slot: { packExecDay: args.executionDay, packExecTime: "9" },
      paymentMethod: "WALLET",
    },
  });
  assert.equal(result.verification.adId, args.adId);
  assert.equal(result.verification.listId, "different-list-id");
  assert.equal(result.verification.status, "observed");
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_QUOTE_UNKNOWN" },
  );
  assert.equal(client.mutationCount, 1);
});

test("confirmation is required without consuming the quote", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: false }),
    { code: "BOOST_CONFIRMATION_REQUIRED" },
  );
  assert.equal(client.mutationCount, 0);
  await handlers.executeBoost({ quoteId: quote.quoteId, confirm: true });
  assert.equal(client.mutationCount, 1);
});

test("changed price invalidates the quote before any mutation", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  client.price = 7;
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_QUOTE_CHANGED" },
  );
  assert.equal(client.mutationCount, 0);
});

test("expired quotes cannot debit", async () => {
  const { client, handlers, advance } = setup();
  const quote = await handlers.prepareBoost(args);
  advance(5 * 60 * 1_000);
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_QUOTE_EXPIRED" },
  );
  assert.equal(client.mutationCount, 0);
});

test("session change between quote and execution cannot debit", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  client.sessionGeneration += 1;
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_SESSION_CHANGED" },
  );
  assert.equal(client.mutationCount, 0);
});

test("session change during catalogue verification cannot debit", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  client.afterCatalog = () => { client.sessionGeneration += 1; };
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_SESSION_CHANGED" },
  );
  assert.equal(client.mutationCount, 0);
});

test("concurrent executions of the same quote can submit at most one order", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  const results = await Promise.allSettled([
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
  ]);
  assert.equal(client.mutationCount, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
});

test("network error is not retried and consumes the quote", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  client.mutationError = true;
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_OUTCOME_UNCONFIRMED" },
  );
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_QUOTE_UNKNOWN" },
  );
  assert.equal(client.mutationCount, 1);
});

test("failed verification preserves the received order response", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  client.verificationError = true;
  const result = await handlers.executeBoost({ quoteId: quote.quoteId, confirm: true });
  assert.equal(result.status, "order_response_received");
  assert.deepEqual(result.order, {
    initiateOrder: { paymentLink: "", paymentCode: "", expiryDate: "2030-01-01" },
  });
  assert.deepEqual(result.verification, { status: "unavailable", reason: "read_after_order_failed" });
  assert.equal(client.mutationCount, 1);
});

test("a malformed order response is uncertain, never treated as confirmed", async () => {
  const { client, handlers } = setup();
  const quote = await handlers.prepareBoost(args);
  client.invalidOrderResponse = true;
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_OUTCOME_UNCONFIRMED" },
  );
  assert.equal(client.mutationCount, 1);
  await assert.rejects(
    handlers.executeBoost({ quoteId: quote.quoteId, confirm: true }),
    { code: "BOOST_QUOTE_UNKNOWN" },
  );
});

test("unknown packs and missing slots cannot produce a quote", async () => {
  const { client, handlers } = setup();
  await assert.rejects(
    handlers.prepareBoost({ ...args, packId: "unknown-pack" }),
    { code: "BOOST_PACK_UNAVAILABLE" },
  );
  await assert.rejects(
    handlers.prepareBoost({ ...args, executionSlotId: "unknown-slot" }),
    { code: "BOOST_SLOT_UNAVAILABLE" },
  );
  assert.equal(client.mutationCount, 0);
});
