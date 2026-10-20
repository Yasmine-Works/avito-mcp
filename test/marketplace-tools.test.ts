import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarketplaceHandlers, publicCountSchema, publicSearchSchema,
} from "../src/marketplace-tools.js";
import { AppError } from "../src/errors.js";

function setup(data: Record<string, unknown> = {
  publishedAndNC: { publishedAndNCAds: { publishedAndNCDetails: [] } },
  premium: { premiumAds: { premiumDetails: [] } },
}) {
  const calls: Array<{ operation: string; variables: Record<string, unknown> }> = [];
  const handlers = createMarketplaceHandlers({
    async executePublic(operation, variables = {}) {
      calls.push({ operation, variables });
      return data;
    },
  });
  return { calls, handlers };
}

test("public search preserves APK filters, enum casing and explicit false values", async () => {
  const { calls, handlers } = setup();
  const filters = publicSearchSchema.parse({
    text: "iphone",
    categoryId: 2000,
    adType: "sell",
    price: { greaterThanOrEqual: 100, lessThanOrEqual: 3000 },
    location: { cityIds: [1], areaIds: [2] },
    hasImage: true,
    hasPrice: true,
    isStore: false,
    offersShipping: false,
    isVerifiedSeller: true,
    includeNewConstructionAds: false,
    extendPublishedAdsSearchIfNeeded: false,
    sort: [{ adProperty: "PRICE", sortOrder: "ASC" }],
    searchAlgorithm: "ORIGINAL",
    params: {
      singleMatch: {
        text: [{ name: "example-text", value: "example-value" }],
        numeric: [{ name: "example-number", value: 1 }],
        boolean: [{ name: "example-boolean", value: false }],
      },
      listMatch: { textList: [{ name: "example-list", value: ["one", "two"] }] },
      rangeMatch: [{ name: "example-range", value: { greaterThanOrEqual: 2020 } }],
    },
  });
  await handlers.searchAds(filters);
  assert.deepEqual(calls, [{
    operation: "GetListingAds",
    variables: { ...filters, startNewScroll: true },
  }]);
});

test("public search preserves both streams and reads sibling metadata proved by the APK", async () => {
  const data = {
    publishedAndNC: {
      publishedAndNCAds: {
        publishedAndNCDetails: Array.from({ length: 35 }, (_, index) => ({
          adId: `internal-${index}`, listId: `public-${index}`, title: `Ad ${index}`,
        })),
        publishedAndNCMetadata: { nextScrollId: "main-2" },
      },
      publishedAndNCAdsCount: { total: 75 },
    },
    premium: {
      premiumAds: {
        premiumDetails: [{ adId: "premium-ad" }],
        premiumMetadata: { nextScrollId: "premium-1" },
      },
    },
  };
  const { handlers } = setup(data);
  const result = await handlers.searchAds({});
  assert.equal(result.publishedAndNC, data.publishedAndNC);
  assert.equal(result.premium, data.premium);
  assert.deepEqual(result.pagination.nextCursor, {
    publishedAndNCAdsNextScrollId: "main-2",
    premiumAdsNextScrollId: "premium-1",
  });
  assert.equal(result.pagination.pageSize, 35);
  assert.equal(result.pagination.premiumPageSize, 3);
});

test("continuation uses the supplied cursors without inventing page numbers", async () => {
  const { calls, handlers } = setup();
  await handlers.searchAds({
    text: "iphone",
    publishedAndNCAdsNextScrollId: "main-next",
    premiumAdsNextScrollId: "premium-next",
  });
  assert.deepEqual(calls[0], {
    operation: "GetListingAds",
    variables: {
      text: "iphone",
      publishedAndNCAdsNextScrollId: "main-next",
      premiumAdsNextScrollId: "premium-next",
      startNewScroll: false,
    },
  });
});

test("invalid cursor combinations fail before a public network call", async () => {
  const { calls, handlers } = setup();
  await assert.rejects(handlers.searchAds({ startNewScroll: false }), { code: "INVALID_SEARCH_CURSOR" });
  await assert.rejects(handlers.searchAds({
    startNewScroll: true, publishedAndNCAdsNextScrollId: "stale-cursor",
  }), { code: "INVALID_SEARCH_CURSOR" });
  await assert.rejects(handlers.searchAds({
    premiumAdsNextScrollId: "premium-only",
  }), { code: "INVALID_SEARCH_CURSOR" });
  assert.equal(calls.length, 0);
});

test("empty results never reuse the cursor supplied by the caller", async () => {
  const { handlers } = setup();
  const result = await handlers.searchAds({ publishedAndNCAdsNextScrollId: "previous" });
  assert.deepEqual(result.pagination.nextCursor, {});
});

test("pagination stops after a short main page even when metadata and premium remain", async () => {
  const { handlers } = setup({
    publishedAndNC: {
      publishedAndNCAds: {
        publishedAndNCDetails: [{ listId: "last-public-ad" }],
        publishedAndNCMetadata: { nextScrollId: "stale-main" },
      },
    },
    premium: {
      premiumAds: {
        premiumDetails: [],
        premiumMetadata: { nextScrollId: "premium-cursor" },
      },
    },
  });
  assert.deepEqual((await handlers.searchAds({})).pagination.nextCursor, {});
});

test("malformed search data is an error rather than a fabricated empty result", async () => {
  const { handlers } = setup({
    publishedAndNC: { publishedAndNCAds: [] },
    premium: null,
  });
  await assert.rejects(handlers.searchAds({}), { code: "INVALID_RESPONSE" });
});

test("count separates ad, seller and extension filters using APK variable names", async () => {
  const { calls, handlers } = setup();
  const filters = publicCountSchema.parse({
    text: "iphone",
    adType: "SELL",
    isPremium: false,
    hasImage: false,
    location: { cityIds: [1] },
    price: { lessThanOrEqual: 3000 },
    isStore: false,
    includeNewConstructionAds: false,
    extendPublishedAdsSearchIfNeeded: true,
  });
  await handlers.countAds(filters);
  assert.deepEqual(calls[0], {
    operation: "GetListingAdsCount",
    variables: {
      adFilter: {
        text: "iphone",
        type: "SELL",
        isPremium: false,
        hasImage: false,
        location: { cityIds: [1] },
        price: { lessThanOrEqual: 3000 },
      },
      seller: { isStore: false },
      includeNewConstructionAds: false,
      extendPublishedAdsSearchIfNeeded: true,
    },
  });
});

test("public detail uses listID without substituting internal adId", async () => {
  const { calls, handlers } = setup();
  await handlers.getPublishedAd({ listId: "public-list-id" });
  await handlers.autocompleteSearch({ query: "iphone" });
  await handlers.getPublicStore({ storeId: "public-store-id" });
  assert.deepEqual(calls, [
    { operation: "GetPublishedAd", variables: { listID: "public-list-id" } },
    { operation: "AutoCompleteSearch", variables: { query: "iphone" } },
    { operation: "getStoreDetails", variables: { storeId: "public-store-id" } },
  ]);
});

test("schemas reject guessed enums, malformed numeric filters and unavailable writers", () => {
  for (const input of [
    { adType: "UNKNOWN__" },
    { adType: "Sell" },
    { searchAlgorithm: "RELEVANCE" },
    { sort: [{ adProperty: "POPULARITY", sortOrder: "ASC" }] },
    { price: { greaterThanOrEqual: 3000, lessThanOrEqual: 100 } },
    { price: {} },
    { location: { cityIds: ["casablanca"] } },
    { params: { singleMatch: { numeric: [{ name: "example", value: "one" }] } } },
    { params: { listMatch: { numericList: [{ name: "example", value: [1] }] } } },
    { page: 2 },
  ]) {
    assert.equal(publicSearchSchema.safeParse(input).success, false, JSON.stringify(input));
  }
  assert.equal(publicCountSchema.safeParse({ sort: [{ adProperty: "PRICE", sortOrder: "ASC" }] }).success, false);
});

test("public errors propagate without retry or fallback authentication", async () => {
  let calls = 0;
  const handlers = createMarketplaceHandlers({
    async executePublic() {
      calls += 1;
      throw new AppError("ACCESS_DENIED", "Challenge requis.");
    },
  });
  await assert.rejects(handlers.searchAds({}), { code: "ACCESS_DENIED" });
  assert.equal(calls, 1);
});
