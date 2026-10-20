# Recherche publique issue de l'APK Android

Source : archive `avito.xapk` fournie pour l'analyse (non distribuée), application Android Avito Maroc
`se.scmv.morocco`, version `10.1.0`. Les documents GraphQL sont des chaînes
extraites des fichiers DEX du paquet de base. Le serveur conserve leurs noms,
variables, sélections et fragments dans `src/apk-documents.ts`.

Les documents suivants remplacent la limitation initiale de la capture Charles,
qui ne contenait pas de recherche publique :

| Outil MCP | Opération GraphQL de l'APK | Résultat |
| --- | --- | --- |
| `avito_search_ads` | `GetListingAds` | Annonces principales et premium, détails, compte principal, curseurs |
| `avito_count_ads` | `GetListingAdsCount` | Nombre de résultats correspondant aux filtres |
| `avito_get_published_ad` | `GetPublishedAd` | Détail d'une annonce publique et annonces similaires |
| `avito_autocomplete_search` | `AutoCompleteSearch` | Suggestions, catégories, villes, types, marques et modèles |
| `avito_get_public_store` | `getStoreDetails` | Profil public de boutique |

Ces lectures passent par `executePublic`. Elles ne déclenchent pas de connexion
et n'envoient aucun jeton, même si des identifiants sont configurés ou si une
session de compte existe. Un refus ou challenge est renvoyé comme une erreur,
sans tentative de contournement.

## Filtres et valeurs établis par le code

Les variables de `GetListingAds` établissent les filtres de texte, catégorie,
type, image, prix, localisation, livraison, livraison dans la ville, bonne
affaire, urgence, e-commerce, immobilier neuf, vendeur vérifié et boutique. Les
extensions immobilières et l'élargissement de recherche restent des options.

Les classes Apollo et leurs sérialiseurs de `classes5.dex` précisent les types :

| Structure | Preuve DEX | Champs pris en charge |
| --- | --- | --- |
| `RangeFilter` | `Lis/g1;`, adaptateur `Ljs/b;` | `greaterThanOrEqual`, `lessThanOrEqual` : nombres |
| `AdLocationFilter` | `Lis/c;`, adaptateur `Ljs/b;` | `cityIds`, `areaIds` : listes d'entiers |
| `AdsSearchResultSort` | `Lis/p;` | `adProperty`, `sortOrder` |
| `ListingAdParamsFilters` | `Lis/i0;` | `singleMatch`, `listMatch`, `rangeMatch` |
| `AdParamsSingleMatchFilters` | `Lis/l;` | Listes `text`, `numeric`, `boolean` de couples `name`/`value` |
| `AdParamListTextFilter` | `Lis/f;` | Couple `name`/`value`, valeur liste de chaînes |
| `AdParamsRangeFilter` | `Lis/k;` | Couple `name`/`value`, valeur `RangeFilter` |

Les valeurs d'énumération exactes sont partagées dans `src/apk-enums.ts` :

- Type d'annonce : `SELL`, `BUY`, `SWAP`, `LET`, `RENT`, `CO_RENT`,
  `VAC_RENT`, ainsi que les sept variantes minuscules présentes dans le DEX.
- Propriété de tri : `LIST_TIME`, `PRICE`.
- Ordre de tri : `ASC`, `DESC`.
- Algorithme de recherche : `ORIGINAL`, `FUZZY`, `KIT10`, `KIT10X`, `KIT15`.

Le marqueur Apollo `UNKNOWN__` n'est jamais accepté comme une valeur de requête.
Le champ `listMatch.numericList` apparaît dans le modèle, mais son sérialiseur
a été supprimé par l'optimisation du paquet : il n'est pas exposé en supposant
sa structure. Pour `singleMatch.numeric`, le sérialiseur confirme un nombre ;
l'application observée utilise une valeur constante `1`.

Les identifiants de catégories, villes et quartiers, ainsi que les noms et
valeurs des paramètres propres aux catégories, ne constituent pas des enums
exhaustives récupérables dans ce code. L'autocomplétion et les annonces renvoient
des valeurs réelles ; elles ne fournissent pas à elles seules un catalogue
complet de toutes les combinaisons autorisées. Les plafonds de longueur et de
nombre d'éléments du MCP sont des limites locales, pas des limites documentées
du serveur Avito.

## Pagination

La requête Android contient des tailles fixes : **35** annonces principales
(`publishedAndNC`) et **3** annonces premium. Les pages sont parcourues avec
`startNewScroll` et deux identifiants de continuation, et non un numéro de page
exposé à l'utilisateur.

Pour le premier appel, omettre les curseurs :

```json
{
  "text": "iphone",
  "price": { "lessThanOrEqual": 3000 },
  "sort": [{ "adProperty": "PRICE", "sortOrder": "ASC" }]
}
```

Pour continuer, conserver exactement les filtres et le tri, et ajouter les
valeurs fournies dans `pagination.nextCursor`. Le MCP déduit
`startNewScroll:false` de leur présence. Il refuse une continuation sans
curseur principal ou une nouvelle recherche accompagnée d'un ancien curseur.

Les réponses Apollo `Lnn/h5;` et `Lnn/c5;` montrent que `publishedAndNCAds` et
`premiumAds` sont des objets : chaque objet contient une liste `…Details` et un
objet `…Metadata` adjacent. Les curseurs se trouvent dans
`publishedAndNC.publishedAndNCAds.publishedAndNCMetadata.nextScrollId` et
`premium.premiumAds.premiumMetadata.nextScrollId`.

Le code de pagination `Loq/q.b`, offsets `0x0f2a` à `0x0fa6`, arrête la
recherche si la liste principale contient moins de 35 éléments. Sinon, il
utilise les deux curseurs de métadonnées, avec un curseur principal obligatoire
pour ouvrir une nouvelle page. Le MCP suit cette règle ; un curseur premium
seul ne prolonge pas la pagination. Il ne réutilise jamais un ancien curseur
lorsque le serveur cesse d'en fournir.

`avito_count_ads` utilise la même structure de filtres et convertit le paramètre
MCP `adType` en champ GraphQL `type`. Utiliser `isPremium:false` pour compter
le flux principal. Les champs de pagination et de tri n'ont pas leur place
dans le compteur.

## Vérification et limites

Le **20 octobre 2026**, un appel anonyme à
`https://gateway.avito.ma/graphql`, avec le document APK exact `GetListingAds`
et les variables `{"text":"iphone","startNewScroll":true}`, a renvoyé
**HTTP 200**, les champs `data.publishedAndNC` et `data.premium`, sans erreur
GraphQL. Cet appel utilisait l'agent `AvitoMCP/0.1.0`, sans compte, jeton ni
cookie. Aucune annonce ni donnée de vendeur n'a été conservée dans le dépôt.

Cette vérification confirme l'accessibilité de la recherche de base au moment
du test. Elle ne valide pas chaque combinaison de filtres, chaque algorithme,
ni la disponibilité future de ces API. Les autres formes proviennent de
l'analyse statique du client Android. Les tests locaux utilisent des réponses
simulées pour vérifier la séparation des flux, la pagination, les types,
les variables exactes, les erreurs et l'absence de répétition automatique.

Le test intégré `npm run smoke:public`, avec le transport HTTPS natif Node du
MCP, a ensuite validé le même jour les six vérifications : recherche avec
image/prix/tri (35 annonces principales et 3 premium), compteur,
autocomplétion, détail d'une annonce, page suivante (35 annonces) et profil
public d'une boutique. Les identifiants nécessaires aux appels suivants ont
été conservés uniquement en mémoire. Aucun compte ni aucune mutation n'a été
utilisé.
