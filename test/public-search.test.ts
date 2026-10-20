import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicSearchUrl } from "../src/public-search.js";

test("builds the public routes observed on Avito without fetching results", () => {
  assert.equal(
    buildPublicSearchUrl(),
    "https://www.avito.ma/fr/maroc/%C3%A0_vendre",
  );
  assert.equal(
    buildPublicSearchUrl(" iphone  11 "),
    "https://www.avito.ma/fr/maroc/iphone_11--%C3%A0_vendre",
  );
  assert.equal(
    buildPublicSearchUrl("IPHONE", "casablanca"),
    "https://www.avito.ma/fr/casablanca/iphone--%C3%A0_vendre",
  );
});

test("rejects URL components or excessive input instead of changing the route", () => {
  for (const citySlug of [
    "../maroc",
    "https://example.com",
    "maroc?redirect=evil",
    "casablanca\n",
    "a".repeat(81),
  ]) {
    assert.throws(() => buildPublicSearchUrl("iphone", citySlug));
  }
  for (const query of [
    "iphone/../../",
    "iphone#fragment",
    "iphone?query",
    "iphone%2f",
    "iphone\\test",
    "iphone--à_vendre",
    "iphone\n11",
    "x".repeat(201),
  ]) {
    assert.throws(() => buildPublicSearchUrl(query));
  }
});

test("retains the Avito origin and encodes Unicode search terms", () => {
  const url = new URL(buildPublicSearchUrl("Téléphone سامسونج"));
  assert.equal(url.origin, "https://www.avito.ma");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.equal(
    decodeURIComponent(url.pathname),
    "/fr/maroc/téléphone_سامسونج--à_vendre",
  );
});
