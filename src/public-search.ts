const AVITO_ORIGIN = "https://www.avito.ma";
const MAX_QUERY_LENGTH = 200;
const MAX_CITY_SLUG_LENGTH = 80;

/**
 * Produce a public Avito search link, without requesting or parsing results.
 *
 * Observed routes:
 * /fr/maroc/à_vendre
 * /fr/maroc/iphone--à_vendre
 * /fr/maroc/iphone_11--à_vendre
 * /fr/casablanca/iphone--à_vendre
 *
 * City slugs other than those observed are not checked against Avito's catalog.
 */
export function buildPublicSearchUrl(
  query?: string,
  citySlug = "maroc",
): string {
  if (
    typeof citySlug !== "string" ||
    citySlug.length > MAX_CITY_SLUG_LENGTH ||
    !/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(citySlug)
  ) {
    throw new Error(
      "citySlug doit être un slug Avito en minuscules, de 1 à 80 caractères (ex. maroc, casablanca).",
    );
  }

  if (query !== undefined && typeof query !== "string") {
    throw new Error("query doit être une chaîne de caractères.");
  }
  if (
    query !== undefined &&
    (query.length > MAX_QUERY_LENGTH ||
      /[\u0000-\u001f\u007f/\\?#%]/u.test(query) ||
      query.includes("--"))
  ) {
    throw new Error(
      "query doit contenir au maximum 200 caractères, sans caractères de contrôle, séparateurs d'URL ou séquence --.",
    );
  }

  const normalizedQuery = (query ?? "").trim().toLowerCase().replace(/\s+/gu, "_");
  const listingSegment = normalizedQuery
    ? `${normalizedQuery}--à_vendre`
    : "à_vendre";
  return `${AVITO_ORIGIN}/fr/${citySlug}/${encodeURIComponent(listingSegment)}`;
}
