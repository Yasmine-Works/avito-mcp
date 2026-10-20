// Optional live check: anonymous reads only, with no environment credentials.
// Never prints or saves listing contents, contacts, identifiers, or scroll tokens.
import { AvitoClient } from "../dist/client.js";
import { createMarketplaceHandlers, publicSearchSchema } from "../dist/marketplace-tools.js";

const handlers = createMarketplaceHandlers(new AvitoClient());
const filters = { text: "iphone", hasImage: true, price: { greaterThanOrEqual: 1 } };
const searchArgs = publicSearchSchema.parse({
  ...filters, sort: [{ adProperty: "LIST_TIME", sortOrder: "DESC" }],
});
const checks = {};
try {
  const results = await Promise.allSettled([
    handlers.searchAds(searchArgs),
    handlers.countAds({ ...filters, isPremium: false }),
    handlers.autocompleteSearch({ query: "iphone" }),
  ]);
  let listing;
  let searchResponse;
  for (const [index, name] of ["search", "count", "autocomplete"].entries()) {
    const result = results[index];
    if (result.status !== "fulfilled") {
      checks[name] = { passed: false, code: result.reason?.code ?? "UNEXPECTED_ERROR" };
      continue;
    }
    const data = result.value;
    if (name === "search") {
      searchResponse = data;
      listing = data.publishedAndNC?.publishedAndNCAds?.publishedAndNCDetails?.find((ad) => ad.listId);
      checks.search = {
        passed: Array.isArray(data.publishedAndNC?.publishedAndNCAds?.publishedAndNCDetails),
        mainResultCount: data.publishedAndNC?.publishedAndNCAds?.publishedAndNCDetails?.length,
        premiumResultCount: data.premium?.premiumAds?.premiumDetails?.length,
        continuationAvailable: Boolean(data.pagination.nextCursor?.publishedAndNCAdsNextScrollId),
      };
    } else if (name === "count") {
      checks.count = { passed: typeof data.getListingAds?.count?.total === "number" };
    } else {
      checks.autocomplete = { passed: Array.isArray(data.autoCompleteSearch?.suggestions) };
    }
  }
  if (listing) {
    const detail = await handlers.getPublishedAd({ listId: listing.listId });
    checks.detail = { passed: typeof detail.getPublishedAd?.ad?.listId === "string" };
  } else {
    checks.detail = { passed: false, reason: "No published listing available for detail check" };
  }
  if (searchResponse?.pagination.nextCursor?.publishedAndNCAdsNextScrollId) {
    const nextPage = await handlers.searchAds(publicSearchSchema.parse({
      ...searchArgs, ...searchResponse.pagination.nextCursor,
    }));
    const oldIds = new Set(searchResponse.publishedAndNC.publishedAndNCAds.publishedAndNCDetails.map((ad) => ad.listId));
    const next = nextPage.publishedAndNC.publishedAndNCAds.publishedAndNCDetails;
    checks.pagination = {
      passed: next.some((ad) => ad.listId && !oldIds.has(ad.listId)),
      nextPageResultCount: next.length,
    };
  }
  const storeListing = searchResponse?.premium?.premiumAds?.premiumDetails?.find((ad) => ad.seller?.storeId)
    ?? searchResponse?.publishedAndNC?.publishedAndNCAds?.publishedAndNCDetails?.find((ad) => ad.seller?.storeId);
  if (storeListing) {
    const store = await handlers.getPublicStore({ storeId: storeListing.seller.storeId });
    checks.store = { passed: typeof store.getStoreDetails?.storeId === "string" };
  }
} catch (error) {
  checks.error = { passed: false, code: error?.code ?? "UNEXPECTED_ERROR" };
}
console.log(JSON.stringify({ anonymous: true, accountMutations: 0, checks }, null, 2));
if (Object.values(checks).some((check) => check.passed !== true)) process.exitCode = 1;
