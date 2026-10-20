# Recherche publique : preuves et limite

> Historique de la première analyse, fondée sur la capture Charles et les pages
> HTML. Depuis l'analyse de l'APK, une API de recherche publique exacte a été
> identifiée et intégrée. Voir [l'analyse Android](apk-marketplace-analysis.md).
> Les blocages HTML décrits ici ne signifient pas que l'API GraphQL est inaccessible.

Analyse effectuée le 20 octobre 2026. Les pages publiques ont été consultées
anonymement, sans cookies, identifiants ou jetons de la session Charles.

La capture Charles contient des opérations GraphQL concernant les annonces du
compte et un appel `GET https://services.avito.ma/api/v2/config/adlisting/tree`.
Aucune opération de recherche publique d'annonces n'y a été identifiée.
Ce chemin de configuration ne constitue pas un endpoint de recherche.

## Routes publiques observées

Le service de lecture web a reconnu ces pages officielles et leurs titres :

| URL | Titre observé |
| --- | --- |
| [Toutes les annonces au Maroc](https://www.avito.ma/fr/maroc/%C3%A0_vendre) | Vente et achat en ligne partout au Maroc à vendre - Avito |
| [Recherche iphone](https://www.avito.ma/fr/maroc/iphone--%C3%A0_vendre) | Iphone : Découvrez 17114 annonces à vendre - Avito |
| [Recherche iphone 11](https://www.avito.ma/fr/maroc/iphone_11--%C3%A0_vendre) | Iphone 11 : Découvrez 1445 annonces à vendre - Avito |
| [Recherche iphone à Casablanca](https://www.avito.ma/fr/casablanca/iphone--%C3%A0_vendre) | Annonces pour iphone à Casablanca à vendre - Avito |
| [Catégorie voitures](https://www.avito.ma/fr/maroc/voitures) | Voitures - Avito Maroc \| Avito Véhicules |

Les nombres figurant dans les titres sont des observations du service web,
potentiellement mises en cache. Ils ne sont pas des résultats récupérés par le
serveur MCP et ne sont pas utilisés par celui-ci.

## Résultats des essais HTTP

Les requêtes HTTP anonymes directes vers l'accueil, les routes de recherche,
`robots.txt` et `sitemap.xml` ont reçu HTTP 403. L'accueil renvoie une page
Cloudflare intitulée « Just a moment... ». Le service de lecture web ne livre
pas le contenu des annonces. Un appel anonyme à l'endpoint de configuration
observé dans la capture a également reçu HTTP 403.

Ces résultats empêchent de valider ici un extracteur de résultats publics.
Aucun contournement du challenge, aucune requête GraphQL inventée et aucun
accès au compte n'ont été tentés.

## Comportement implémenté

`buildPublicSearchUrl(query?, citySlug = "maroc")` construit uniquement un lien
vers la recherche publique française. Il utilise les routes observées,
convertit les espaces de la recherche en `_`, encode le segment et refuse les
séparateurs d'URL, les caractères de contrôle et les entrées trop longues.
Il n'effectue aucune requête réseau.

Seuls `maroc` et `casablanca` ont été vérifiés dans cette analyse ; la validation
d'un autre slug est syntaxique et ne garantit pas son existence sur Avito.
L'outil MCP qui utilise ce helper doit annoncer explicitement
`resultsFetched: false` et ne doit pas présenter le lien comme une liste d'annonces
ni prétendre avoir consulté les détails d'une annonce.

Cette limitation initiale a été levée par l'extraction des documents GraphQL,
adaptateurs et appels de pagination présents dans l'APK Android fourni.
