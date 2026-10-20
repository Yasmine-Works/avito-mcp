# Types et valeurs récupérés dans l’APK Android

Analyse statique du 20 octobre 2026, sans installer ni exécuter l’application. Source : XAPK fourni par l’utilisateur, application `se.scmv.morocco`, version `10.1.0`.

- SHA-256 du XAPK : `81ff489bef63f276cd3d1a328277e07068d688b435ffb2e13e2637ff98c028c1`.
- SHA-256 de l’APK principal : `06eb8daa18d4a5b7613873c47961953205c6f1f34ed568e8c62bdc6a9ec2a9cc`.
- Sources des types métier ci-dessous : `classes5.dex`. Les adaptateurs scalaires Apollo sont dans `classes.dex`.

Les noms de classes sont obfusqués. L’identification croise les documents GraphQL embarqués, les méthodes `toString`, les constructeurs, les initialisations d’énumérations et les adaptateurs JSON générés. La lecture utilise Androguard dans un environnement Python temporaire ; aucun code de l’APK n’est exécuté. Les décompilations et les fichiers binaires restent hors du dépôt.

Ces preuves décrivent le contrat embarqué de cette version de l’application. Elles ne garantissent pas que toutes les possibilités sont encore acceptées par le serveur, autorisées pour tous les comptes ou disponibles dans chaque catégorie. La signature de l’APK n’a pas été comparée à celle d’une distribution officielle.

## Énumérations

Les valeurs exportées par `src/apk-enums.ts` proviennent des valeurs effectivement sérialisées, pas d’une supposition à partir des libellés. Le cas `UNKNOWN__` est une valeur de repli du client Apollo et n’est jamais proposé comme entrée MCP.

| Utilisation | Classe DEX | Valeurs |
| --- | --- | --- |
| `MyFilteredAdsInput.status` | `Lis/n;` | `ACTIVE`, `DEACTIVATED`, `REFUSED`, `DELETED`, `PENDING_PAYMENT`, `PENDING_REVIEW`, `BOOSTED_ACTIVE_ADS` |
| `MyPerformanceMetricsFixedRangeFilter` | `Lis/s0;` | `TODAY`, `LAST_7_DAYS`, `LAST_15_DAYS`, `LAST_30_DAYS`, `ALLTIME` |
| `AdSortProperty` | `Lis/m;` | `LIST_TIME`, `PRICE` |
| `SortOrder` | `Lis/t1;` | `ASC`, `DESC` |
| `AdTypeKey` | `Lis/o;` | `SELL`, `BUY`, `SWAP`, `LET`, `RENT`, `CO_RENT`, `VAC_RENT`, `sell`, `buy`, `swap`, `let`, `rent`, `co_rent`, `vac_rent` |
| `SearchAlgorithm` | `Lis/o1;` | `ORIGINAL`, `FUZZY`, `KIT10`, `KIT10X`, `KIT15` |
| Motif de désactivation d’annonce | `Lis/a;` | `SOLD_ON_SITE`, `SOLD_OTHER_MEANS`, `EDIT_OR_CHANGE`, `RENEW_OR_BUMP`, `GIVE_UP`, `OTHER` |
| Durée avant vente sur le site | `Lis/b;` | `ONE_DAY`, `ONE_WEEK`, `ONE_MONTH`, `OVER_ONE_MONTH`, `DONT_REMEMBER` |

Les variantes minuscules de `AdTypeKey` sont des membres distincts de l’énumération embarquée. Elles ne résultent pas d’une normalisation ajoutée par ce serveur MCP.

Autres énumérations relevées : moyens de paiement `CASH`, `CREDIT_CARD`, `FATOURATI`, `WALLET` (`Lis/z0;`), application de boost `ADINSERT`, `ADLISTING`, `PUSH` (`Lis/r;`), unités monétaires `DHS`, `POINTS`, `AVITO_TOKEN` (`Lis/c1;`). Leur présence ne suffit pas à établir un parcours d’achat complet. Le serveur conserve le parcours de boost `ADLISTING` / `WALLET` attesté par la capture Charles, avec devis et confirmation.

## Filtres des annonces du compte

`MyFilteredAdsInput` correspond à `Lis/q0;`. L’adaptateur `Ljs/b;->m`, branche commençant à l’offset `0x888`, écrit exactement :

| Champ JSON | Type transport identifié | Présence |
| --- | --- | --- |
| `keyword` | chaîne | optionnel |
| `categoryIds` | liste d’entiers | optionnel |
| `cityIds` | liste d’entiers | optionnel |
| `status` | énumération `Lis/n;` | requis |
| `boosted` | booléen | optionnel |
| `priceMin` | entier | optionnel |
| `priceMax` | entier | optionnel |
| `params` | liste de `FilterParamInput` | optionnel |
| `adTypes` | liste de chaînes | optionnel |

`FilterParamInput` est `Lis/a0;` : `key` est une chaîne requise et `values` une liste requise de chaînes. Son adaptateur `Ljs/a;->m`, branche `0x8c4`, confirme les noms et les types.

`adTypes` est réellement sérialisé comme une liste de chaînes, contrairement au filtre public `AdTypeKey`. Les clés de paramètres, leurs valeurs, les types d’annonces, les villes et les catégories doivent provenir des facettes retournées par `avito_get_my_ads_facets`. Il ne s’agit pas de catalogues fermés extraits de l’APK.

Le MCP expose ces neuf champs et contrôle localement les bornes de prix. Les limites de taille des listes et chaînes sont des limites opérationnelles du MCP, pas des contraintes prétendument extraites d’Avito.

## Recherche publique

| Type | Classe DEX | Structure identifiée |
| --- | --- | --- |
| `RangeFilter` | `Lis/g1;` | `greaterThanOrEqual?: number`, `lessThanOrEqual?: number` |
| `AdLocationFilter` | `Lis/c;` | `cityIds?: int[]`, `areaIds?: int[]` |
| `ListingSellerFilter` | `Lis/l0;` | `isStore?: boolean`, `storeId?: string` |
| `AdsSearchResultSort` | `Lis/p;` | `adProperty: AdSortProperty`, `sortOrder: SortOrder` |
| `ListingAdParamsFilters` | `Lis/i0;` | `singleMatch?`, `listMatch?`, `rangeMatch?` |
| `AdParamsSingleMatchFilters` | `Lis/l;` | listes optionnelles `text`, `numeric`, `boolean` |
| `AdParamsListMatchFilters` | `Lis/j;` | listes optionnelles `textList`, `numericList` |
| Filtre texte simple | `Lis/i;` | `name: string`, `value: string` |
| Filtre booléen simple | `Lis/g;` | `name: string`, `value: boolean` |
| Filtre numérique simple | `Lis/h;` | `name: string`, `value: number` |
| Filtre de liste texte | `Lis/f;` | `name: string`, `value: string[]` |
| `AdParamsRangeFilter` | `Lis/k;` | `name: string`, `value: RangeFilter` |

`rangeMatch` est une liste de `AdParamsRangeFilter`. Les adaptateurs scalaires distinguent bien les bornes publiques numériques (`Double`, `Lvb/c;->h`) des prix entiers du compte (`Int`, `Lvb/c;->i`).

Le code optimisé du filtre numérique simple sérialise une constante numérique `1.0` avec l’adaptateur Double. Le type de transport est identifiable, mais son usage applicatif est plus restreint dans ce binaire. L’adaptateur des éléments de `numericList` a été éliminé par l’optimisation ; sa présence dans le conteneur ne permet pas de reconstruire sûrement tous les champs des éléments. Ce cas n’est pas proposé par le MCP.

## Messagerie, favoris et cycle de vie

`SendChatMessageInput` (`Lis/r1;`) contient quatre champs optionnels Apollo : `adId`, `conversationId`, `text`, `attachment`. Les appels de l’application distinguent l’envoi initial par `adId` de la réponse par `conversationId`. Le détail du parcours est documenté dans l’analyse de messagerie.

`SaveAdInput` (`Lis/m1;`) contient uniquement `listId: string`, requis. Il faut conserver la distinction entre `listId` et `adId`.

`Page` (`Lis/w0;`) contient `number: int` et `size: int`, tous deux requis. Les numéros de page de départ sont déterminés par chaque opération ou son parcours applicatif ; la classe seule ne définit pas une base universelle.

`DeactivationReasonInput` (`Lis/w;`) contient :

- `reason` : énumération de motif requise ;
- `soldOnSiteDuration` : énumération de durée optionnelle et nullable ;
- `otherReasonText` : chaîne optionnelle et nullable.

L’adaptateur `Ljs/a;->m`, branche `0x964`, relie explicitement la durée à `Lis/b;` et le motif à `Lis/a;`.

Les formulaires de création/modification d’annonce, leurs champs conditionnels, les packs de boost, prix, créneaux et droits du compte restent dépendants de données reçues du serveur. L’analyse de cet APK ne permet donc pas d’affirmer connaître « toutes les valeurs possibles » de tous les paramètres.
