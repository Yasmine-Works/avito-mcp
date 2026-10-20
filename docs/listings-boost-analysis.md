# Analyse des annonces et des boosts — capture Charles

> Cette note conserve les preuves de la capture Charles. Les énumérations et
> filtres supplémentaires sont établis par [l'analyse des types Android](apk-types-analysis.md).

Source : analyse locale de `avitosession.chlz`, sans appel à Avito. Cette note conserve les contrats GraphQL et les énumérations métier; elle ne contient aucun identifiant de compte ou d'annonce, cookie, jeton, mot de passe, contenu d'annonce ou conversation provenant de la capture.

## Portée établie

Le point d'entrée observé est `POST https://gateway.avito.ma/graphql`, corps JSON `{ "query": "...", "variables": {...} }`. Les opérations listées ci-dessous ont des réponses HTTP 200 sans erreur GraphQL dans la capture, à l'exception d'une recherche intermédiaire dont la réponse manque. Les requêtes d'annonces portent **sur les annonces du compte authentifié** (`getMyFilteredAds`, `getMyAd`), pas sur une recherche générale du catalogue Avito. Aucun contrat de recherche publique, création, modification ou suppression d'annonce n'est présent.

## Contrats d'entrée et pagination

| Fonction | Types GraphQL déclarés | Champs et valeurs observés |
| --- | --- | --- |
| Annonces du compte | `MyFilteredAdsInput!`, `Page!` | `filter.status: "ACTIVE"`; `keyword: string`; `categoryIds: number[]`; `boosted: boolean`; `page.number: integer` commençant à 1, `page.size: integer` (35 observé) |
| Facettes | identiques | Statuts renvoyés dans les facettes : `ACTIVE`, `DELETED`, `BOOSTED_ACTIVE_ADS`, `PENDING_REVIEW`. Leur présence dans une facette ne prouve pas que chacun soit accepté comme filtre. |
| Détail du compte | `adId: ID!` | Identifiant d'annonce sous forme de chaîne. |
| Packs de boost | `GetVasPackagesInput!` | `{ application: "ADLISTING", adId: string }` |
| Achat/activation d'un pack | `InitOrderInput!` | `{ adId: string, packId: string, application: "ADLISTING", slot: { packExecDay: "YYYY-MM-DD", packExecTime: string }, paymentMethod: "WALLET" }` |
| Statistiques | `MyPerformanceMetricsFixedRangeFilter!` | `LAST_30_DAYS` est la seule plage observée. |
| Boutique du compte | `storeId: ID!` | Identifiant de boutique requis. |

`boosted` a effectivement été envoyé avec une valeur booléenne. Les statuts, plages et modes de paiement non observés ne doivent pas être inventés. Les valeurs `packId`, créneaux et prix doivent être obtenues à chaque consultation du catalogue, pas figées d'après cette capture.

## Boost : débit direct confirmé

Le flux observé est : `GetVasPackagesShop` → `InitiateOrderMutation` avec `paymentMethod: WALLET` → relecture des annonces. Avant la mutation, l'annonce ciblée n'avait aucun pack. Après la mutation, la même annonce possédait un pack actif de catégorie `bump`, intitulé « Tête de liste 3j ». Le compteur `vasPackages.count` est passé de 0 à 1 et `lastAppliedVasPack` a été renseigné. La capture établit donc que cette mutation peut directement consommer des crédits et activer un boost; il ne s'agit pas uniquement de générer un lien de paiement.

La réponse d'initiation contenait `paymentLink: ""`, `paymentCode: ""` et une `expiryDate` non vide. Il n'y a pas de champ `success`, de reçu, ni d'identifiant de commande dans la sélection observée. Une réponse sans erreur ne suffit donc pas à prouver une activation : relire les packs de l'annonce. Aucun contrat d'annulation, de remboursement ou de suivi d'ordre séparé n'est capturé. Ne pas relancer automatiquement une mutation après expiration réseau : son résultat peut être incertain et un second débit est possible.

Le catalogue exposait les catégories `special` (« VENTE URGENTE »), `bump` (« BASIC »), `gallery` (« VISIBILITE MAX »). Les prix étaient libellés `AVITO_TOKEN`; ce n'est pas une devise fiduciaire. Chaque pack fournit `id`, `durationDays`, `price`, `priceUnit`, `originalPrice`, `discountPercentage`. Les créneaux sont fournis par `availableExecutionSlots.days` et `availableExecutionSlots.hours` (chaque heure possède un `id`, `start`, `end`). L'ID de créneau est une chaîne, distincte de son libellé horaire.

Pour un outil MCP de boost, faire d'abord une prévisualisation liée au compte, à l'annonce, au pack, au prix et au créneau; n'exécuter que sur confirmation explicite de cette prévisualisation. Recharger le catalogue avant l'exécution et refuser si le prix/pack a changé. Ne pas envoyer de mutation dans un test de connectivité.

## Autres lectures utiles

`getLowPerformingAds` fournit le même fragment `MyAdSimple` que les annonces du compte. Les métriques observées sont `view`, `bump`, `conversation`, `delete`, `gallery`, `highlight`, `phoneView`, `publish`; chaque série possède `data[{x: string, y: number}]` et un total numérique.

Une route de configuration a également réussi : `GET https://services.avito.ma/api/v2/config/adlisting/tree?lang=fr`. Elle retourne une liste d'objets `{category: object, icon: string, index: number, name: string, trackingName: string}`. Ce n'est pas un endpoint de recherche d'annonces. Son accès sans authentification n'a pas été vérifié.

## Documents GraphQL observés

Les sélections ci-dessous sont exactes. Les valeurs des variables des requêtes d'origine ne sont volontairement pas copiées.

### Échange 3

```graphql
query getMyStoreInfo($storeId: ID!) { getMyStoreInfo(storeId: $storeId) { name email category { id name trackingValue } phones { number } description { short long } locations { city { id name trackingValue } address } startDate expiryDate logo { defaultPath } points { count expiryDate } naa { total used remaining } website category { id name } offersDelivery extraMediaAllowed membership { id name } isVerifiedSeller } }
```

### Échange 5

```graphql
query GetMyFilteredAdsFacetsQuery($filter: MyFilteredAdsInput!, $page: Page!) { getMyFilteredAds(filters: $filter, pagination: $page) { facets { statuses { status count } categories { key name count } cities { key name count } params { paramKey paramName values { key name count } } adTypes { key name count } } count { total } } }
```

### Échange 6

```graphql
query GetLowPerformingAdsQuery { getLowPerformingAds { __typename ...AdFields } }  fragment AdFields on MyAdSimple { status title adId listId discount labels editAdStatus type { name key } refusalReason location { city { name id } } price { withCurrency } publishedAt lastStateTime image { paths { smallThumbnail } } lastAppliedVasPack { endDate startDate name status category } vasPackages { count packages { name startDate endDate status category } } performance { phoneViews views conversations lastXDaysViews isLowPerformance } category { id name trackingValue parent { id trackingValue name } } }
```

### Échange 7

```graphql
query GetMyFilteredAdsQuery($filter: MyFilteredAdsInput!, $page: Page!) { getMyFilteredAds(filters: $filter, pagination: $page) { ads { __typename ...AdFields } count { total } } }  fragment AdFields on MyAdSimple { status title adId listId discount labels editAdStatus type { name key } refusalReason location { city { name id } } price { withCurrency } publishedAt lastStateTime image { paths { smallThumbnail } } lastAppliedVasPack { endDate startDate name status category } vasPackages { count packages { name startDate endDate status category } } performance { phoneViews views conversations lastXDaysViews isLowPerformance } category { id name trackingValue parent { id trackingValue name } } }
```

### Échange 29

```graphql
query GetAccountAdQuery($adId: ID!) { getMyAd(adId: $adId) { media { images { paths { standard } } } title location { city { id name trackingValue } area { id name trackingValue } } description category { id name trackingValue } params { primary { __typename ...adParam } secondary { __typename ...adParam } } } }  fragment adParam on AdParam { __typename ... on TextAdParam { id name fullValue textValue trackingValue paramRawValue } ... on NumericAdParam { id name fullValue numericValue unit } ... on BooleanAdParam { id name booleanValue } }
```

### Échange 30

```graphql
query GetVasPackagesShop($input: GetVasPackagesInput!) { getVasPackages(input: $input) { __typename ...VasPackagesFragment ...VasExecutionSlotsFragment } }  fragment VasPackagesFragment on VasPackagesResponse { categories { key title description image labels vasPackages { id durationDays price priceUnit originalPrice discountPercentage } } }  fragment VasExecutionSlotsFragment on VasPackagesResponse { availableExecutionSlots { days hours { id start end } } }
```

### Échange 39

```graphql
mutation InitiateOrderMutation($input: InitOrderInput!) { initiateOrder(input: $input) { paymentLink paymentCode expiryDate } }
```

### Échange 46

```graphql
query GetAccountStatisticsQuery($range: MyPerformanceMetricsFixedRangeFilter!) { getMyPerformanceMetricsFixedRange(range: $range) { name data { x y } total } }
```
