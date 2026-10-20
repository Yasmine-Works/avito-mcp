import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AvitoClient } from "./client.js";
import { AppError } from "./errors.js";
import { addTool } from "./tools.js";
import { MY_AD_STATUSES, PERFORMANCE_RANGES } from "./apk-enums.js";

const QUOTE_TTL_MS = 5 * 60 * 1_000;
const id = z.string().trim().min(1).max(100);
const searchSchema = {
  keyword: z.string().max(200).optional(),
  status: z.enum(MY_AD_STATUSES).default("ACTIVE"),
  categoryIds: z.array(z.number().int().positive()).max(30).optional(),
  cityIds: z.array(z.number().int().positive()).max(30).optional(),
  boosted: z.boolean().optional(),
  priceMin: z.number().int().min(0).max(2_147_483_647).optional(),
  priceMax: z.number().int().min(0).max(2_147_483_647).optional(),
  params: z.array(z.object({
    key: z.string().min(1).max(100),
    values: z.array(z.string().min(1).max(200)).min(1).max(50),
  }).strict()).max(30).optional().describe("Clés et valeurs renvoyées par avito_get_my_ads_facets."),
  adTypes: z.array(z.string().min(1).max(100)).max(30).optional()
    .describe("Clés de types renvoyées par avito_get_my_ads_facets."),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(35),
};
const boostSchema = {
  adId: id.describe("Identifiant adId de votre annonce, et non listId."),
  packId: id.describe("Identifiant d'un pack renvoyé par get_boost_packages."),
  executionDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  executionSlotId: id.describe("ID d'un créneau availableExecutionSlots.hours."),
};
type SearchArgs = z.infer<z.ZodObject<typeof searchSchema>>;
type BoostArgs = z.infer<z.ZodObject<typeof boostSchema>>;
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

function invalidCatalog(): never {
  throw new AppError(
    "INVALID_BOOST_CATALOG",
    "Le catalogue de boost reçu est incomplet ou invalide. Aucun achat effectué.",
  );
}

interface PackSelection {
  packId: string;
  category: string;
  title: string;
  durationDays: number;
  price: number;
  priceUnit: string;
  executionDay: string;
  executionSlotId: string;
  executionStart: string;
  executionEnd: string;
}

function selectPack(data: ObjectValue, args: BoostArgs): PackSelection {
  const catalog = object(data.getVasPackages);
  const slots = object(catalog?.availableExecutionSlots);
  if (!catalog || !Array.isArray(catalog.categories) || !slots ||
      !Array.isArray(slots.days) || !Array.isArray(slots.hours)) invalidCatalog();

  if (!slots.days.includes(args.executionDay)) {
    throw new AppError("BOOST_SLOT_UNAVAILABLE", "La date choisie ne figure plus dans le catalogue.");
  }
  const hour = slots.hours.map(object).find((entry) => entry?.id === args.executionSlotId);
  if (!hour || typeof hour.start !== "string" || typeof hour.end !== "string") {
    throw new AppError("BOOST_SLOT_UNAVAILABLE", "Le créneau choisi ne figure plus dans le catalogue.");
  }

  const matches: Array<{ pack: ObjectValue; category: ObjectValue }> = [];
  for (const categoryValue of catalog.categories) {
    const category = object(categoryValue);
    if (!category || !Array.isArray(category.vasPackages)) invalidCatalog();
    for (const packValue of category.vasPackages) {
      const pack = object(packValue);
      if (pack?.id === args.packId) matches.push({ pack, category });
    }
  }
  if (matches.length !== 1) {
    throw new AppError("BOOST_PACK_UNAVAILABLE", "Le pack choisi est absent ou ambigu dans le catalogue.");
  }
  const { pack, category } = matches[0]!;
  if (typeof pack.price !== "number" || !Number.isFinite(pack.price) || pack.price < 0 ||
      typeof pack.priceUnit !== "string" || !pack.priceUnit ||
      typeof pack.durationDays !== "number" || !Number.isInteger(pack.durationDays) ||
      pack.durationDays <= 0 || typeof category.key !== "string" ||
      typeof category.title !== "string") invalidCatalog();

  return {
    packId: args.packId,
    category: category.key,
    title: category.title,
    durationDays: pack.durationDays,
    price: pack.price,
    priceUnit: pack.priceUnit,
    executionDay: args.executionDay,
    executionSlotId: args.executionSlotId,
    executionStart: hour.start,
    executionEnd: hour.end,
  };
}

interface Quote {
  adId: string;
  pack: PackSelection;
  sessionGeneration: number;
  expiresAt: number;
}

/** Separately exported to exercise the payment flow entirely with fake transports. */
export function createListingHandlers(
  client: AvitoClient,
  options: { now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const quotes = new Map<string, Quote>();
  const getPackages = (adId: string) => client.execute("GetVasPackagesShop", {
    input: { application: "ADLISTING", adId },
  });
  const searchVariables = (args: SearchArgs) => {
    if (args.priceMin !== undefined && args.priceMax !== undefined && args.priceMin > args.priceMax) {
      throw new AppError("INVALID_PRICE_RANGE", "priceMin doit être inférieur ou égal à priceMax.");
    }
    return {
      filter: {
        status: args.status,
        ...(args.keyword === undefined ? {} : { keyword: args.keyword }),
        ...(args.categoryIds === undefined ? {} : { categoryIds: args.categoryIds }),
        ...(args.cityIds === undefined ? {} : { cityIds: args.cityIds }),
        ...(args.boosted === undefined ? {} : { boosted: args.boosted }),
        ...(args.priceMin === undefined ? {} : { priceMin: args.priceMin }),
        ...(args.priceMax === undefined ? {} : { priceMax: args.priceMax }),
        ...(args.params === undefined ? {} : { params: args.params }),
        ...(args.adTypes === undefined ? {} : { adTypes: args.adTypes }),
      },
      page: { number: args.page, size: args.pageSize },
    };
  };

  async function readBoostState(adId: string): Promise<ObjectValue> {
    // A bounded re-read is evidence of the current state, not an order receipt.
    for (let page = 1; page <= 3; page += 1) {
      const data = await client.execute("GetMyFilteredAdsQuery", {
        filter: { status: "ACTIVE" },
        page: { number: page, size: 35 },
      });
      const result = object(data.getMyFilteredAds);
      if (!Array.isArray(result?.ads)) {
        return { status: "unavailable", reason: "invalid_listing_response" };
      }
      const match = result.ads.map(object).find((ad) => ad?.adId === adId);
      if (match) {
        return {
          status: "observed",
          note: "État relu après la commande; ne constitue pas un reçu de paiement.",
          adId: match.adId,
          listId: match.listId,
          adStatus: match.status,
          lastAppliedVasPack: match.lastAppliedVasPack,
          vasPackages: match.vasPackages,
        };
      }
      if (result.ads.length < 35) break;
    }
    return { status: "not_found", reason: "not_in_first_three_active_pages" };
  }

  return {
    searchMyAds: async (args: SearchArgs) =>
      client.execute("GetMyFilteredAdsQuery", searchVariables(args)),
    getFacets: async (args: SearchArgs) =>
      client.execute("GetMyFilteredAdsFacetsQuery", searchVariables(args)),
    getMyAd: async ({ adId }: { adId: string }) =>
      client.execute("GetAccountAdQuery", { adId }),
    getLowPerformingAds: async () => client.execute("GetLowPerformingAdsQuery"),
    getStatistics: async ({ range }: { range: typeof PERFORMANCE_RANGES[number] }) =>
      client.execute("GetAccountStatisticsQuery", { range }),
    getStore: async ({ storeId }: { storeId?: string }) => {
      const selectedStoreId = storeId ?? client.storeId;
      if (!selectedStoreId) {
        throw new AppError("STORE_ID_REQUIRED", "Indiquez storeId ou configurez AVITO_STORE_ID.");
      }
      return client.execute("getMyStoreInfo", { storeId: selectedStoreId });
    },
    getBoostPackages: async ({ adId }: { adId: string }) => getPackages(adId),
    prepareBoost: async (args: BoostArgs) => {
      for (const [key, quote] of quotes) {
        if (quote.expiresAt <= now() || quote.sessionGeneration !== client.sessionGeneration) {
          quotes.delete(key);
        }
      }
      if (quotes.size >= 100) {
        throw new AppError("TOO_MANY_BOOST_QUOTES", "Trop de devis en attente. Réessayez dans cinq minutes.");
      }
      const data = await getPackages(args.adId);
      const pack = selectPack(data, args);
      const quoteId = randomUUID();
      const expiresAt = now() + QUOTE_TTL_MS;
      quotes.set(quoteId, {
        adId: args.adId,
        pack,
        sessionGeneration: client.sessionGeneration,
        expiresAt,
      });
      return {
        quoteId,
        expiresAt: new Date(expiresAt).toISOString(),
        adId: args.adId,
        ...pack,
        paymentMethod: "WALLET",
        requiresConfirmation: true,
        notice: "L'exécution peut débiter immédiatement ce prix du portefeuille Avito. Présentez ce devis et obtenez l'accord explicite de l'utilisateur avant avito_execute_boost.",
      };
    },
    executeBoost: async ({ quoteId, confirm }: { quoteId: string; confirm: boolean }) => {
      if (confirm !== true) {
        throw new AppError("BOOST_CONFIRMATION_REQUIRED", "La confirmation explicite du devis est requise.");
      }
      const quote = quotes.get(quoteId);
      if (!quote) {
        throw new AppError("BOOST_QUOTE_UNKNOWN", "Devis absent ou déjà utilisé. Préparez un nouveau devis.");
      }
      // Consume synchronously, before any await, to prevent concurrent duplicate debits.
      quotes.delete(quoteId);
      if (quote.expiresAt <= now()) {
        throw new AppError("BOOST_QUOTE_EXPIRED", "Le devis a expiré. Préparez et confirmez un nouveau devis.");
      }
      if (quote.sessionGeneration !== client.sessionGeneration) {
        throw new AppError("BOOST_SESSION_CHANGED", "La session a changé. Préparez et confirmez un nouveau devis.");
      }
      const latest = selectPack(await getPackages(quote.adId), {
        adId: quote.adId,
        packId: quote.pack.packId,
        executionDay: quote.pack.executionDay,
        executionSlotId: quote.pack.executionSlotId,
      });
      if (quote.sessionGeneration !== client.sessionGeneration) {
        throw new AppError("BOOST_SESSION_CHANGED", "La session a changé. Aucun achat effectué.");
      }
      if (quote.expiresAt <= now()) {
        throw new AppError("BOOST_QUOTE_EXPIRED", "Le devis a expiré pendant la vérification. Aucun achat effectué.");
      }
      if (JSON.stringify(latest) !== JSON.stringify(quote.pack)) {
        throw new AppError("BOOST_QUOTE_CHANGED", "Le prix, le pack ou le créneau a changé. Préparez et confirmez un nouveau devis.");
      }
      // Intentionally one request only. A network error may still mean a completed debit.
      let order: ObjectValue;
      try {
        order = await client.execute("InitiateOrderMutation", {
          input: {
            adId: quote.adId,
            packId: quote.pack.packId,
            application: "ADLISTING",
            slot: {
              packExecDay: quote.pack.executionDay,
              packExecTime: quote.pack.executionSlotId,
            },
            paymentMethod: "WALLET",
          },
        }, quote.sessionGeneration);
        const receipt = object(order.initiateOrder);
        if (!receipt ||
            typeof receipt.paymentLink !== "string" ||
            typeof receipt.paymentCode !== "string" ||
            typeof receipt.expiryDate !== "string" || !receipt.expiryDate) {
          throw new Error("Invalid order response.");
        }
      } catch {
        throw new AppError(
          "BOOST_OUTCOME_UNCONFIRMED",
          "Le résultat de la commande n'est pas confirmé. Le devis est consommé : vérifiez les boosts et le solde Avito avant toute nouvelle commande.",
        );
      }
      let verification: ObjectValue;
      try {
        verification = quote.sessionGeneration === client.sessionGeneration
          ? await readBoostState(quote.adId)
          : { status: "unavailable", reason: "session_changed" };
      } catch {
        verification = { status: "unavailable", reason: "read_after_order_failed" };
      }
      return {
        status: "order_response_received",
        adId: quote.adId,
        quote: quote.pack,
        paymentMethod: "WALLET",
        order,
        verification,
        note: "La commande a renvoyé une réponse. Vérifiez les packs de l'annonce; un lien de paiement vide n'est pas un échec avec WALLET.",
      };
    },
  };
}

export function registerListingTools(server: McpServer, client: AvitoClient): void {
  const handlers = createListingHandlers(client);
  addTool(server, "avito_search_my_ads", {
    description: "Rechercher et paginer les annonces du compte par statut, catégorie, ville, prix, paramètres et type. Consulter les facettes pour les identifiants de filtres. Conserve adId et listId distincts.",
    inputSchema: searchSchema,
    readOnly: true,
  }, handlers.searchMyAds);
  addTool(server, "avito_get_my_ads_facets", {
    description: "Lire les filtres et compteurs disponibles pour les annonces du compte.",
    inputSchema: searchSchema,
    readOnly: true,
  }, handlers.getFacets);
  addTool(server, "avito_get_my_ad", {
    description: "Lire le détail d'une annonce du compte à partir de son adId (pas listId).",
    inputSchema: { adId: id },
    readOnly: true,
  }, handlers.getMyAd);
  addTool(server, "avito_get_low_performing_ads", {
    description: "Lire les annonces identifiées par Avito comme peu performantes.",
    inputSchema: {},
    readOnly: true,
  }, handlers.getLowPerformingAds);
  addTool(server, "avito_get_account_statistics", {
    description: "Lire les métriques du compte pour aujourd'hui, les 7/15/30 derniers jours ou toute la période. Plages identifiées dans l'APK Android.",
    inputSchema: { range: z.enum(PERFORMANCE_RANGES).default("LAST_30_DAYS") },
    readOnly: true,
  }, handlers.getStatistics);
  addTool(server, "avito_get_my_store", {
    description: "Lire les informations et crédits de la boutique du compte connecté.",
    inputSchema: { storeId: id.optional().describe("ID de boutique; utilise AVITO_STORE_ID si omis.") },
    readOnly: true,
  }, handlers.getStore);
  addTool(server, "avito_get_boost_packages", {
    description: "Lire les offres, prix, unités et créneaux de boost disponibles pour votre annonce. Aucun achat.",
    inputSchema: { adId: id },
    readOnly: true,
  }, handlers.getBoostPackages);
  addTool(server, "avito_prepare_boost", {
    description: "Préparer un devis de boost valable cinq minutes, sans achat. Présenter à l'utilisateur l'annonce, le pack, le prix, l'unité et le créneau pour obtenir sa confirmation.",
    inputSchema: boostSchema,
    readOnly: true,
    idempotent: false,
  }, handlers.prepareBoost);
  addTool(server, "avito_execute_boost", {
    description: "Acheter et activer le boost du devis via le portefeuille WALLET. Peut débiter immédiatement des crédits Avito. Appeler uniquement après accord explicite de l'utilisateur sur ce devis. Une tentative consomme le devis; ne pas réessayer automatiquement.",
    inputSchema: { quoteId: z.string().uuid(), confirm: z.literal(true) },
    readOnly: false,
    destructive: true,
    idempotent: false,
  }, handlers.executeBoost);
}
