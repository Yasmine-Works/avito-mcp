import { randomBytes } from "node:crypto";
import { documents } from "./documents.js";
import { AppError } from "./errors.js";
import { httpsTransport } from "./http-transport.js";

const GATEWAY = "https://gateway.avito.ma/graphql";
const RESPONSE_LIMIT = 5 * 1024 * 1024;
// Public operations must never trigger login or receive account credentials.
const PUBLIC_OPERATIONS = new Set([
  "GetListingAds", "GetListingAdsCount", "GetPublishedAd", "AutoCompleteSearch", "getStoreDetails",
]);
export type JsonObject = Record<string, unknown>;

export interface ClientOptions {
  username?: string;
  password?: string;
  accessToken?: string;
  storeId?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("INVALID_RESPONSE", "Réponse Avito vide.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT) {
        await reader.cancel();
        throw new AppError("RESPONSE_TOO_LARGE", "Réponse Avito trop volumineuse. Réduisez la taille de page.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("INVALID_RESPONSE", "Avito n'a pas renvoyé de JSON valide ; un challenge peut être requis.");
  }
}

function tokenExpiry(token: string): number | undefined {
  try {
    const part = token.split(".")[1];
    if (!part) return undefined;
    const body: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return object(body) && typeof body.exp === "number" ? body.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export class AvitoClient {
  readonly storeId?: string;
  readonly #username?: string;
  readonly #password?: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;
  readonly #anonId = (BigInt("0x" + randomBytes(8).toString("hex")) % 9_000_000_000_000_000_000n + 1_000_000_000_000_000_000n).toString();
  readonly #sessionId = Math.floor(Date.now() / 1000).toString();
  #accessToken?: string;
  #generation = 0;
  #loginPromise?: Promise<void>;
  #loggedOut = false;

  constructor(options: ClientOptions = {}) {
    this.#username = options.username?.trim() || undefined;
    this.#password = options.password || undefined;
    this.#accessToken = options.accessToken?.trim() || undefined;
    this.storeId = options.storeId?.trim() || undefined;
    this.#fetch = options.fetch ?? httpsTransport;
    this.#timeout = options.timeoutMs ?? 20_000;
    if (!Number.isInteger(this.#timeout) || this.#timeout < 1000 || this.#timeout > 120_000) {
      throw new AppError("CONFIG_ERROR", "AVITO_TIMEOUT_MS doit être un entier entre 1000 et 120000.");
    }
    if (this.#accessToken && /[\r\n]/u.test(this.#accessToken)) {
      throw new AppError("CONFIG_ERROR", "AVITO_ACCESS_TOKEN invalide.");
    }
  }

  get sessionGeneration(): number { return this.#generation; }

  status() {
    const expiry = this.#accessToken ? tokenExpiry(this.#accessToken) : undefined;
    return {
      authenticated: Boolean(this.#accessToken) && (expiry === undefined || expiry > Date.now()),
      credentialsConfigured: Boolean(this.#username && this.#password),
      storeIdConfigured: Boolean(this.storeId),
      loggedOut: this.#loggedOut,
      // This describes local state, not a fresh validation against Avito.
      validation: "local" as const,
    };
  }

  async login() {
    this.#loggedOut = false;
    if (this.#username && this.#password) {
      await this.authenticate();
    } else if (!this.status().authenticated) {
      throw new AppError("CREDENTIALS_REQUIRED", "Renseignez AVITO_USERNAME et AVITO_PASSWORD, ou AVITO_ACCESS_TOKEN, dans l'environnement local du serveur.");
    }
    return this.status();
  }

  logout() {
    this.#accessToken = undefined;
    this.#generation++;
    this.#loggedOut = true;
    return { authenticated: false, localSessionCleared: true, serverTokenRevoked: false };
  }

  private async authenticate(): Promise<void> {
    if (this.#loginPromise) return this.#loginPromise;
    if (!this.#username || !this.#password) {
      throw new AppError("CREDENTIALS_REQUIRED", "Renseignez AVITO_USERNAME et AVITO_PASSWORD, ou AVITO_ACCESS_TOKEN, dans l'environnement local du serveur.");
    }
    const generation = this.#generation;
    const pending = (async () => {
      const data = await this.request("LoginByIdentifierMutation", {
        identifier: this.#username, pass: this.#password,
      });
      const result = data.loginByIdentifier;
      if (!object(result) || typeof result.accessToken !== "string" || !result.accessToken || /[\r\n]/u.test(result.accessToken)) {
        throw new AppError("LOGIN_FAILED", "Avito n'a pas fourni de jeton de connexion valide.");
      }
      if (this.#generation !== generation || this.#loggedOut) {
        throw new AppError("SESSION_CHANGED", "La session a changé pendant la connexion. Relancez la connexion.");
      }
      this.#accessToken = result.accessToken;
      this.#generation++;
      // No observed refresh operation: deliberately do not store the refresh token.
    })();
    this.#loginPromise = pending;
    try { await pending; } finally {
      if (this.#loginPromise === pending) this.#loginPromise = undefined;
    }
  }

  async executePublic(operationName: string, variables: JsonObject = {}): Promise<JsonObject> {
    if (!PUBLIC_OPERATIONS.has(operationName)) {
      throw new AppError("UNSUPPORTED_PUBLIC_OPERATION", "Cette opération n'est pas une lecture publique autorisée.");
    }
    // Public browsing remains available after local logout.
    return this.request(operationName, variables);
  }

  async execute(operationName: string, variables: JsonObject = {}, expectedGeneration?: number): Promise<JsonObject> {
    if (!Object.hasOwn(documents, operationName) || operationName === "LoginByIdentifierMutation") {
      throw new AppError("UNSUPPORTED_OPERATION", "Opération Avito non prise en charge.");
    }
    if (this.#loggedOut) {
      throw new AppError("AUTH_REQUIRED", "Session déconnectée. Appelez avito_login pour vous reconnecter.");
    }
    if (this.#accessToken && !this.status().authenticated) {
      this.#accessToken = undefined;
      this.#generation++;
    }
    if (!this.#accessToken) await this.authenticate();
    if (this.#loggedOut || !this.#accessToken) {
      throw new AppError("AUTH_REQUIRED", "La session a été fermée pendant la connexion. Appelez avito_login pour vous reconnecter.");
    }
    if (expectedGeneration !== undefined && expectedGeneration !== this.#generation) {
      throw new AppError("SESSION_CHANGED", "La session a changé. Aucune action envoyée ; préparez une nouvelle demande.");
    }
    const generation = this.#generation;
    try {
      const data = await this.request(operationName, variables, this.#accessToken);
      if (generation !== this.#generation) {
        if (documents[operationName]!.startsWith("mutation")) {
          throw new AppError("MUTATION_OUTCOME_UNKNOWN", "La session a changé pendant l'action, qui a pu être appliquée. Vérifiez son état avant de recommencer.");
        }
        throw new AppError("SESSION_CHANGED", "La session a changé pendant la requête.");
      }
      return data;
    } catch (error) {
      if (error instanceof AppError && error.code === "AUTH_EXPIRED" && generation === this.#generation) {
        this.#accessToken = undefined;
        this.#generation++;
      }
      throw error;
    }
  }

  private async request(operationName: string, variables: JsonObject, accessToken?: string): Promise<JsonObject> {
    const query = documents[operationName]!;
    const mutation = query.startsWith("mutation") && operationName !== "LoginByIdentifierMutation";
    try {
      const response = await this.#fetch(GATEWAY, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeout),
        headers: {
          accept: "application/graphql-response+json, application/json",
          "content-type": "application/json",
          "accept-language": "fr",
          "user-agent": PUBLIC_OPERATIONS.has(operationName) ? "AvitoMCP/0.2.0"
            : "Avito_iOS/10.7.0 (com.bikhir.ma.iphone; build:1; iOS 17.7.1; Model:iPhone13,2)",
          "x-avito-anon-user-id": this.#anonId,
          "user-session-id": this.#sessionId,
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ operationName, variables, query }),
      });
      if (!response.ok) await response.body?.cancel().catch(() => {});
      if (response.status === 401) throw new AppError("AUTH_EXPIRED", "Session refusée ou expirée. Reconnectez-vous ; aucune action n'a été rejouée.");
      if (response.status === 403) throw new AppError("ACCESS_DENIED", "Accès refusé par Avito (droits ou challenge). Aucune action n'a été rejouée.");
      if (response.status === 429) throw new AppError("RATE_LIMITED", "Limite Avito atteinte. Attendez avant une nouvelle demande.");
      if (!response.ok) {
        throw new AppError(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "HTTP_ERROR",
          mutation ? "Réponse HTTP en erreur : l'action a pu être appliquée. Vérifiez son état avant de recommencer."
            : `Avito a renvoyé une erreur HTTP ${response.status}.`);
      }
      const payload = await readResponse(response);
      if (!object(payload)) throw new AppError("INVALID_RESPONSE", "Format de réponse Avito inattendu.");
      if (Array.isArray(payload.errors) && payload.errors.length) {
        const codes = payload.errors.flatMap((error) =>
          object(error) && object(error.extensions) && typeof error.extensions.code === "string" ? [error.extensions.code] : []);
        if (codes.some((code) => ["UNAUTHENTICATED", "UNAUTHORIZED", "TOKEN_EXPIRED", "INVALID_TOKEN"].includes(code))) {
          throw new AppError("AUTH_EXPIRED", "Session refusée ou expirée. Reconnectez-vous ; aucune action n'a été rejouée.");
        }
        if (codes.includes("WRONG_CREDS")) throw new AppError("WRONG_CREDS", "Identifiant ou mot de passe refusé par Avito.");
        throw new AppError(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "GRAPHQL_ERROR",
          mutation ? "Avito signale une erreur. L'action a pu être partiellement appliquée ; vérifiez son état avant de recommencer."
            : "Avito a refusé la requête GraphQL. Vérifiez les paramètres et les droits du compte.");
      }
      if (!object(payload.data)) throw new AppError("INVALID_RESPONSE", "Réponse Avito sans données.");
      return payload.data;
    } catch (error) {
      if (error instanceof AppError) {
        if (mutation && ["INVALID_RESPONSE", "RESPONSE_TOO_LARGE"].includes(error.code)) {
          throw new AppError("MUTATION_OUTCOME_UNKNOWN", "Réponse inexploitable : l'action a pu être appliquée. Vérifiez son état avant de recommencer.");
        }
        throw error;
      }
      throw new AppError(mutation ? "MUTATION_OUTCOME_UNKNOWN" : "NETWORK_ERROR",
        mutation ? "Connexion interrompue : l'action a pu être appliquée. Vérifiez son état avant de recommencer."
          : "Connexion Avito interrompue ou délai dépassé.");
    }
  }
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): AvitoClient {
  return new AvitoClient({
    username: env.AVITO_USERNAME, password: env.AVITO_PASSWORD, accessToken: env.AVITO_ACCESS_TOKEN,
    storeId: env.AVITO_STORE_ID, timeoutMs: env.AVITO_TIMEOUT_MS ? Number(env.AVITO_TIMEOUT_MS) : undefined,
  });
}
