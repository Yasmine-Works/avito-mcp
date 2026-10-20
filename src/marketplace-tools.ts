import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AD_SORT_PROPERTIES, AD_TYPE_KEYS, SEARCH_ALGORITHMS, SORT_ORDERS,
} from "./apk-enums.js";
import type { AvitoClient, JsonObject } from "./client.js";
import { AppError } from "./errors.js";
import { addTool } from "./tools.js";

const publicId = z.string().trim().min(1).max(100);
const scrollId = z.string().min(1).max(20_000);
const rangeFilter = z.object({
  greaterThanOrEqual: z.number().optional(),
  lessThanOrEqual: z.number().optional(),
}).strict().refine(
  (range) => range.greaterThanOrEqual !== undefined || range.lessThanOrEqual !== undefined,
  "Indiquez au moins une borne.",
).refine(
  (range) => range.greaterThanOrEqual === undefined || range.lessThanOrEqual === undefined ||
    range.greaterThanOrEqual <= range.lessThanOrEqual,
  "La borne minimale ne doit pas dépasser la borne maximale.",
);
const paramName = z.string().trim().min(1).max(100);
const parameterFilters = z.object({
  singleMatch: z.object({
    text: z.array(z.object({
      name: paramName, value: z.string().max(1_000),
    }).strict()).max(100).optional(),
    numeric: z.array(z.object({
      name: paramName, value: z.number(),
    }).strict()).max(100).optional(),
    boolean: z.array(z.object({
      name: paramName, value: z.boolean(),
    }).strict()).max(100).optional(),
  }).strict().optional(),
  listMatch: z.object({
    textList: z.array(z.object({
      name: paramName, value: z.array(z.string().max(1_000)).min(1).max(100),
    }).strict()).max(100).optional(),
    // The numericList writer was optimized away in this APK: do not guess it.
  }).strict().optional(),
  rangeMatch: z.array(z.object({
    name: paramName, value: rangeFilter,
  }).strict()).max(100).optional(),
}).strict();

const adFilterSchema = {
  text: z.string().trim().max(200).optional(),
  categoryId: z.number().int().positive().optional()
    .describe("ID de catégorie Avito, notamment renvoyé par avito_autocomplete_search."),
  adType: z.enum(AD_TYPE_KEYS).optional(),
  hasImage: z.boolean().optional(),
  hasPrice: z.boolean().optional(),
  price: rangeFilter.optional(),
  location: z.object({
    cityIds: z.array(z.number().int().positive()).min(1).max(100).optional(),
    areaIds: z.array(z.number().int().positive()).min(1).max(100).optional(),
  }).strict().optional().describe("Identifiants numériques Avito, notamment renvoyés par l'autocomplétion."),
  params: parameterFilters.optional()
    .describe("Filtres de catégorie : noms et valeurs issus d'Avito; aucun catalogue exhaustif n'est déduit de l'APK."),
  offersShipping: z.boolean().optional(),
  offersShippingWithinCity: z.boolean().optional(),
  isHotDeal: z.boolean().optional(),
  isUrgent: z.boolean().optional(),
  isEcommerce: z.boolean().optional(),
  isImmoneuf: z.boolean().optional(),
  isVerifiedSeller: z.boolean().optional(),
};

const commonFilterSchema = {
  ...adFilterSchema,
  isStore: z.boolean().optional(),
  includeNewConstructionAds: z.boolean().optional(),
  extendPublishedAdsSearchIfNeeded: z.boolean().optional(),
};

export const publicSearchSchema = z.object({
  ...commonFilterSchema,
  sort: z.array(z.object({
    adProperty: z.enum(AD_SORT_PROPERTIES),
    sortOrder: z.enum(SORT_ORDERS),
  }).strict()).min(1).max(2).optional(),
  searchAlgorithm: z.enum(SEARCH_ALGORITHMS).optional(),
  startNewScroll: z.boolean().optional()
    .describe("Déduit des curseurs si omis. Sans curseur : nouvelle recherche. Avec curseur : continuation."),
  publishedAndNCAdsNextScrollId: scrollId.optional()
    .describe("Recopier pagination.nextCursor.publishedAndNCAdsNextScrollId de la réponse précédente."),
  premiumAdsNextScrollId: scrollId.optional()
    .describe("Recopier pagination.nextCursor.premiumAdsNextScrollId de la réponse précédente."),
}).strict();

export const publicCountSchema = z.object({
  ...commonFilterSchema,
  isPremium: z.boolean().optional()
    .describe("Filtre optionnel du compteur; false compte le flux principal de avito_search_ads."),
}).strict();

type SearchArgs = z.infer<typeof publicSearchSchema>;
type CountArgs = z.infer<typeof publicCountSchema>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : undefined;
}

function defined(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function nextScrollId(stream: JsonObject, metadataKey: string): string | undefined {
  const value = object(stream[metadataKey])?.nextScrollId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Public reads deliberately never authenticate, even when account credentials exist. */
export function createMarketplaceHandlers(client: Pick<AvitoClient, "executePublic">) {
  return {
    searchAds: async (args: SearchArgs) => {
      const hasMainCursor = args.publishedAndNCAdsNextScrollId !== undefined;
      const hasAnyCursor = hasMainCursor || args.premiumAdsNextScrollId !== undefined;
      const startNewScroll = args.startNewScroll ?? !hasAnyCursor;
      if ((startNewScroll && hasAnyCursor) || (!startNewScroll && !hasMainCursor)) {
        throw new AppError(
          "INVALID_SEARCH_CURSOR",
          "Une nouvelle recherche ne doit pas contenir de curseur. Une continuation exige le curseur principal publishedAndNCAdsNextScrollId de la réponse précédente.",
        );
      }
      const data = await client.executePublic("GetListingAds", defined({ ...args, startNewScroll }));
      const main = object(object(data.publishedAndNC)?.publishedAndNCAds);
      const premium = object(object(data.premium)?.premiumAds);
      if (!main || !Array.isArray(main.publishedAndNCDetails) ||
          !premium || !Array.isArray(premium.premiumDetails)) {
        throw new AppError("INVALID_RESPONSE", "La recherche Avito n'a pas renvoyé les deux flux d'annonces attendus.");
      }
      // Loq/q.b in classes5.dex: only continue when the main stream contains
      // 35 entries and supplies its metadata cursor. Premium alone cannot advance.
      const mainCursor = main.publishedAndNCDetails.length >= 35
        ? nextScrollId(main, "publishedAndNCMetadata") : undefined;
      const nextCursor = mainCursor ? defined({
        publishedAndNCAdsNextScrollId: mainCursor,
        premiumAdsNextScrollId: nextScrollId(premium, "premiumMetadata"),
      }) : {};
      return {
        ...data,
        pagination: {
          pageSize: 35,
          premiumPageSize: 3,
          nextCursor,
          note: "Pour continuer, conserver exactement les filtres et le tri et recopier nextCursor. Un curseur principal est nécessaire. La pagination suit le client Android : 35 annonces principales par page; arrêt si moins de 35 ou sans curseur principal.",
        },
      };
    },
    countAds: async (args: CountArgs) => {
      const {
        adType, isStore, includeNewConstructionAds, extendPublishedAdsSearchIfNeeded, ...ad
      } = args;
      return client.executePublic("GetListingAdsCount", defined({
        adFilter: defined({ ...ad, type: adType }),
        ...(isStore === undefined ? {} : { seller: { isStore } }),
        includeNewConstructionAds,
        extendPublishedAdsSearchIfNeeded,
      }));
    },
    getPublishedAd: async ({ listId }: { listId: string }) =>
      client.executePublic("GetPublishedAd", { listID: listId }),
    autocompleteSearch: async ({ query }: { query: string }) =>
      client.executePublic("AutoCompleteSearch", { query }),
    getPublicStore: async ({ storeId }: { storeId: string }) =>
      client.executePublic("getStoreDetails", { storeId }),
  };
}

export function registerMarketplaceTools(server: McpServer, client: AvitoClient): void {
  const handlers = createMarketplaceHandlers(client);
  addTool(server, "avito_search_ads", {
    description: "Rechercher réellement les annonces publiques Avito sans connexion : texte, catégorie, type, prix, filtres, tri et pagination par curseurs. Renvoie deux flux (35 annonces principales et 3 premium), leurs détails et les curseurs de continuation. Les filtres et le tri doivent rester identiques pendant une continuation.",
    inputSchema: publicSearchSchema.shape,
  }, handlers.searchAds);
  addTool(server, "avito_count_ads", {
    description: "Compter les annonces publiques correspondant aux filtres, sans connexion. Utiliser isPremium:false pour compter le flux principal de avito_search_ads.",
    inputSchema: publicCountSchema.shape,
  }, handlers.countAds);
  addTool(server, "avito_get_published_ad", {
    description: "Lire le détail public d'une annonce et ses annonces similaires sans connexion. Utiliser le listId public, distinct de l'adId interne du compte.",
    inputSchema: { listId: publicId },
  }, handlers.getPublishedAd);
  addTool(server, "avito_autocomplete_search", {
    description: "Obtenir les suggestions publiques de recherche et leurs catégories, villes, types et paramètres proposés par Avito. Permet de découvrir des identifiants et valeurs dynamiques.",
    inputSchema: { query: z.string().trim().min(1).max(200) },
  }, handlers.autocompleteSearch);
  addTool(server, "avito_get_public_store", {
    description: "Lire le profil public d'une boutique Avito à partir du storeId d'une annonce publique, sans connexion.",
    inputSchema: { storeId: publicId },
  }, handlers.getPublicStore);
}
