import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AvitoClient, JsonObject } from "./client.js";
import { DEACTIVATION_REASONS, SOLD_ON_SITE_DURATIONS } from "./apk-enums.js";
import { AppError } from "./errors.js";
import { addTool } from "./tools.js";

const adId = z.string().trim().min(1).max(100).describe("adId d'une annonce du compte, distinct du listId public.");
const reasonSchema = z.object({
  reason: z.enum(DEACTIVATION_REASONS),
  soldOnSiteDuration: z.enum(SOLD_ON_SITE_DURATIONS).optional(),
  otherReasonText: z.string().trim().min(1).max(1000).optional(),
});
type DeactivationReason = z.infer<typeof reasonSchema>;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateResult(value: unknown, expectedId: string) {
  if (!object(value) || value.adId !== expectedId || !Object.hasOwn(value, "error")) {
    throw new AppError("MUTATION_OUTCOME_UNKNOWN",
      "L'accusé Avito est incomplet. Vérifiez le statut de l'annonce avant toute nouvelle tentative.");
  }
  if (value.error !== null) {
    if (!object(value.error)) {
      throw new AppError("MUTATION_OUTCOME_UNKNOWN", "Réponse Avito inattendue. Vérifiez le statut de l'annonce avant toute nouvelle tentative.");
    }
    throw new AppError("AD_ACTION_REJECTED", "Avito a refusé le changement de statut. Vérifiez l'annonce et les droits du compte.");
  }
  return {
    status: "accepted",
    adId: expectedId,
    note: "Commande acceptée par Avito. Relire les annonces du compte pour connaître le statut résultant.",
  };
}

export function createAdManagementHandlers(client: AvitoClient) {
  return {
    getAdForEdit: ({ adId }: { adId: string }) => client.execute("getAdForEdit", { adId }),
    activateAd: async ({ adId, confirm }: { adId: string; confirm: boolean }) => {
      if (confirm !== true) throw new AppError("CONFIRMATION_REQUIRED", "Confirmez l'activation de cette annonce.");
      const data = await client.execute("activateAd", { adId });
      return validateResult(data.ActivateAd, adId);
    },
    deactivateAd: async ({ adId, reason, confirm }: { adId: string; reason: DeactivationReason; confirm: boolean }) => {
      if (confirm !== true) throw new AppError("CONFIRMATION_REQUIRED", "Confirmez la désactivation de cette annonce.");
      // The application uses a bulk operation. This tool deliberately targets one ad.
      const data = await client.execute("bulkDeactivateAds", { adIds: [adId], reason });
      if (!Array.isArray(data.bulkDeactivateAds) || data.bulkDeactivateAds.length !== 1) {
        throw new AppError("MUTATION_OUTCOME_UNKNOWN", "Réponse de désactivation incomplète. Vérifiez le statut avant toute nouvelle tentative.");
      }
      return validateResult(data.bulkDeactivateAds[0], adId);
    },
  };
}

export function registerAdManagementTools(server: McpServer, client: AvitoClient): void {
  const handlers = createAdManagementHandlers(client);
  addTool(server, "avito_get_ad_for_edit", {
    description: "Lire les champs d'édition d'une annonce du compte : catégorie, prix, type, texte, lieu, paramètres et identifiants des médias. Ne modifie pas l'annonce.",
    inputSchema: { adId },
  }, handlers.getAdForEdit);
  addTool(server, "avito_activate_ad", {
    description: "Demander l'activation d'une annonce du compte après accord explicite. Le statut final dépend d'Avito ; relire l'annonce après l'accusé. Ne jamais réessayer automatiquement en cas de résultat incertain.",
    inputSchema: { adId, confirm: z.literal(true) },
    readOnly: false, destructive: true, idempotent: false,
  }, handlers.activateAd);
  addTool(server, "avito_deactivate_ad", {
    description: "Désactiver une annonce précise du compte avec le motif choisi par l'utilisateur et son accord explicite. Ne supprime pas le compte. Ne jamais réessayer automatiquement en cas de résultat incertain.",
    inputSchema: { adId, reason: reasonSchema, confirm: z.literal(true) },
    readOnly: false, destructive: true, idempotent: false,
  }, handlers.deactivateAd);
}
