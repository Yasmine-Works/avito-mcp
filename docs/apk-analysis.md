# Analyse statique APK — améliorations MCP 0.2.0

Analyse du 20 octobre 2026 sur le XAPK fourni, sans installation ni exécution de l'application. Identité : `se.scmv.morocco`, Avito Android `10.1.0`, versionCode `1539`. Le fichier contient un APK principal et un split ARM 32 bits.

SHA-256 de l'APK principal : `06eb8daa18d4a5b7613873c47961953205c6f1f34ed568e8c62bdc6a9ec2a9cc`. La signature cryptographique n'a pas été vérifiée.

## Méthode et preuve

1. Lecture des archives et des tables de chaînes DEX, sans exécuter de code de l'application.
2. Extraction de **70 documents GraphQL exacts**, conservés avec le nom du DEX dans `apk-graphql-inventory.json`.
3. Désassemblage ciblé des classes générées Apollo et de leurs adaptateurs JSON. Les noms de champs ne sont pas déduits de simples chaînes isolées : le constructeur, la sérialisation et, quand nécessaire, les appels métier sont vérifiés.
4. Comparaison avec les 14 opérations de la capture Charles. Ajout de 17 documents exécutables, soit 31 opérations alimentant **35 outils MCP**.
5. Tests hors compte et vérification réseau séparée des lectures publiques. Aucun identifiant de connexion ni jeton du compte n'est utilisé ; aucun message, achat ou changement d'annonce réel n'est envoyé.

Le script `scripts/extract_apk_graphql.py` reproduit l'inventaire avec la bibliothèque standard Python. Les outils de désassemblage ont été installés dans un environnement temporaire ; ils ne sont pas des dépendances d'exécution du MCP. Les APK, chaînes générales, clés SDK tierces et code de l'application ne sont pas copiés dans le projet.

## Capacités ajoutées

| Domaine | Amélioration | Preuve principale |
| --- | --- | --- |
| Recherche publique | Recherche, comptage, détail, suggestions, boutique | Documents GraphQL + adaptateurs + appel de pagination `Loq/q.b` |
| Recherche du compte | Sept statuts, villes, prix, paramètres, types d'annonce | `MyFilteredAdsInput`, sérialiseurs `js` |
| Statistiques | Aujourd'hui, 7, 15, 30 jours, totalité | Enum `MyPerformanceMetricsFixedRangeFilter` |
| Conversation | Trouver la conversation liée à une annonce, premier message, blocage/déblocage | `SendChatMessageInput`, constructeur et appel `Lrq/l.g` |
| Favoris | Liste, ajout/retrait, recherches sauvegardées | Inputs `SaveAdInput`/`UnsaveAdInput`, réponses de type String |
| Compte | Profil connecté | `GetMyAccountInfo` |
| Annonce | Champs d'édition, activation, désactivation unitaire avec motif | `getAdForEdit`, `activateAd`, `bulkDeactivateAds` |

L'activation utilise le champ réponse **`ActivateAd`** avec cette casse. La classe `Lnn/a;` contient `adId:String` et une erreur nullable. La désactivation reçoit une liste de résultats (`Lnn/a0;`, champ `ArrayList`). Le MCP limite chaque demande à une annonce, exige la confirmation et vérifie l'identifiant et l'erreur avant de déclarer la commande acceptée. Un changement de statut accepté ne prouve pas une publication immédiate.

## Paramètres : ce qui est exhaustif et ce qui ne l'est pas

Les énumérations exposées correspondent aux valeurs présentes dans cette version Android ; le marqueur client `UNKNOWN__` est exclu des entrées. Les formes des objets d'entrée exposés sont vérifiées dans leurs sérialiseurs. Les listes détaillées et offsets sont dans [apk-types-analysis.md](apk-types-analysis.md).

Cela ne constitue pas une liste exhaustive de toutes les valeurs acceptées aujourd'hui par Avito. Les catégories, villes, quartiers, caractéristiques propres à chaque catégorie, identifiants, prix, crédits, packs, créneaux, permissions et règles de validation sont fournis ou appliqués par le serveur. Le filtre `adTypes` du compte est un tableau de chaînes provenant des facettes, et non l'énumération `AdTypeKey` de la recherche publique. Le sérialiseur de `numericList` ayant été optimisé hors du parcours observé, ce filtre public n'est pas proposé.

## Limites de mise en œuvre

L'inventaire contient également des opérations de publication, modification, upload, récupération d'accès, suppression de compte et commande e-commerce. Elles ne sont pas automatiquement exposées : les documents seuls ne suffisent pas à reconstruire les parcours, prérequis et effets. Aucun outil GraphQL générique n'est ajouté.

Les nouveaux outils authentifiés sont validés par désassemblage et tests synthétiques ; aucune mutation réelle n'a été effectuée. Les décisions d'accès restent celles d'Avito. Le serveur n'interprète jamais une erreur réseau comme un échec certain d'une mutation et ne la rejoue pas.

Pour la recherche publique, la première lecture anonyme avec Python `urllib` a réussi. Le transport `fetch` Node a reçu un challenge HTTP 403 ; une requête HTTPS native Node standard avec le même document a réussi. Le transport du MCP utilise désormais `node:https` avec TLS vérifié, sans les headers de contexte navigateur ajoutés par `fetch`, sans redirection et sans mécanisme de résolution de challenge.

Le test intégré anonyme a validé la recherche avec filtres et tri, le compteur, l'autocomplétion, le détail, la continuation et le profil public d'une boutique. Les deux pages principales testées contenaient chacune 35 annonces, et le flux premium en contenait 3. Aucun contenu d'annonce, contact, identifiant ou curseur retourné n'a été écrit dans le projet.

Consulter également [l'analyse des recherches](apk-marketplace-analysis.md) et [celle du compte et des conversations](apk-chat-account-analysis.md).
