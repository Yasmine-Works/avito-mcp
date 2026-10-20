# Analyse APK : messagerie, compte et favoris

Analyse statique locale de l’APK de base contenu dans `avito.xapk` (package `se.scmv.morocco`, version 10.1.0). Aucune requête au compte, aucun message envoyé, aucune modification de favori ou de blocage. Les preuves ci-dessous proviennent des documents GraphQL embarqués et du bytecode Dalvik de `classes5.dex`, inspectés avec Androguard.

Ces observations complètent `auth-chat-analysis.md`, qui décrit uniquement la session Charles. Elles établissent le contrat utilisé par cette version Android, sans garantir sa disponibilité actuelle sur le serveur.

## Retrouver et ouvrir une conversation

```graphql
query GetChatConversationWithAd($adId: String!) {
  getMyChatConversationWithAd(adId: $adId) {
    found
    conversationId
  }
}
```

L’outil `avito_find_conversation_for_ad` transmet `{adId}`. Il ne marque rien comme lu et n’envoie aucun message.

Le document `SendFirstChatMessage` utilise le même type d’entrée que `SendChatMessage`, mais l’application fournit l’annonce au lieu de l’identifiant de conversation :

```graphql
mutation SendFirstChatMessage($message: SendChatMessageInput!) {
  sendChatMessage(message: $message) {
    success
    conversation {
      id
      message { id text isMine time attachment { url type } }
      isNew
    }
  }
}
```

Preuve du corps exact, au-delà du simple nom de l’opération :

- `Lis/r1;` est `SendChatMessageInput`. Son `toString()` nomme successivement `adId`, `conversationId`, `text`, `attachment`. Ses quatre champs sont des wrappers optionnels Apollo.
- Le sérialiseur `Ljs/b;` écrit ces mêmes noms uniquement si le wrapper contient une valeur.
- `Lrq/l;->g(String, String, Continuation)`, aux offsets `0x64` à `0x8e`, construit cet input avec le premier argument dans `adId`, le second dans `text` et le masque Kotlin `10` (`2 + 8`), qui omet `conversationId` et `attachment`. Il construit ensuite `Lnn/rc;`, l’opération `SendFirstChatMessage`.

L’outil `avito_send_first_message` envoie donc exactement :

```json
{"message":{"adId":"identifiant-annonce","text":"Texte exact demandé"}}
```

Il ne déduit pas de destinataire, n’utilise pas `listId`, préserve les espaces et retours à la ligne, et ne tente aucun renvoi automatique. Comme pour l’envoi dans une conversation existante, son utilisation exige une demande explicite de l’utilisateur d’envoyer le texte. Un `success: false` est un refus ; un acquittement sans booléen `success` exploitable laisse le résultat incertain.

L’entrée `attachment` existe dans l’APK, mais aucune procédure complète d’upload et de transmission n’est établie ici. Elle n’est pas exposée par le MCP.

## Blocage

Les deux documents embarqués sont :

```graphql
mutation BlockConversation($id: ID!) {
  blockConversation(id: $id) { success }
}
mutation UnblockConversation($id: ID!) {
  unblockConversation(id: $id) { success }
}
```

`avito_block_conversation` et `avito_unblock_conversation` transmettent l’identifiant de conversation dans `{id}`. Ce sont des écritures explicites. Elles contrôlent le booléen `success` comme les autres mutations de messagerie.

## Compte, favoris et recherches sauvegardées

| Outil | Document APK | Variables |
| --- | --- | --- |
| `avito_get_account` | `GetMyAccountInfo` | Aucune |
| `avito_list_saved_ads` | `GetAccountSavedAdsQuery` | `{page: {number, size}}` |
| `avito_list_saved_searches` | `GetMySavedSearches` | Aucune |
| `avito_save_ad` | `AddToFavorites` | `{input: {listId}}` |
| `avito_unsave_ad` | `RemoveFromFavorites` | `{input: {listId}}` |

Le profil sélectionne `id`, `name`, `email`, `phone {number,isHidden}`, `location.city {id,name,trackingValue}` et `registeredAt`. Il contient donc des données personnelles du compte connecté.

Les favoris sélectionnent `getMySavedAds {ads, count {total}}`, avec les fragments Android `PublishedAdFragment`, `PublishedAdPrice`, `PublishedAdParam` et `adParam`. Les annonces conservent leurs identifiants distincts : `adId` pour la messagerie, `listId` pour les favoris.

L’entrée `Page` est `Lis/w0;` : son constructeur accepte deux entiers et son `toString()` les nomme `number` et `size`. Le sérialiseur `Ljs/b;->m`, à partir de l’offset `0x752`, écrit ces deux champs avec l’adaptateur entier.

Les recherches sauvegardées sélectionnent `getMySavedSearches {searches {id,query,savedTime,title}}`. La chaîne `query` est rendue telle quelle ; le MCP ne l’interprète pas comme une instruction et ne prétend pas connaître un schéma supplémentaire.

### Entrées et acquittements des favoris

```graphql
mutation AddToFavorites($input: SaveAdInput!) { saveAd(input: $input) }
mutation RemoveFromFavorites($input: UnsaveAdInput!) { unsaveAd(input: $input) }
```

- `Lis/m1;` (`SaveAdInput`) et `Lis/e2;` (`UnsaveAdInput`) ont chacun un unique champ `listId: String` requis, attesté par leur constructeur et leur `toString()`.
- Le dépôt applicatif `Lnq/c0;` construit ces entrées directement à partir de l’identifiant fourni, puis construit `Lnn/f;` (`AddToFavorites`) ou `Lnn/rb;` (`RemoveFromFavorites`).
- Les adaptateurs de réponse `Luo/d;` et `Luo/j9;` désérialisent respectivement `saveAd` et `unsaveAd` en **chaîne non nulle**, et non en booléen ou objet `{success}`.
- Le dépôt considère la présence de cette chaîne comme acquittement sans comparer sa valeur à une constante. Aucun vocabulaire de valeurs comme `OK` ou `SUCCESS` n’est déduit.

Le MCP rend l’acquittement brut et recommande la lecture des favoris pour confirmer l’état. Une réponse absente, de mauvais type ou vide est signalée `MUTATION_OUTCOME_UNKNOWN`, sans nouvelle tentative automatique.

## Validation et limites

Les tests de transport MCP simulé couvrent la séparation `adId`/`listId`, le corps exact du premier message, la conservation du texte, les lectures sans mutation implicite, la pagination, les annotations d’écriture, les refus et les acquittements malformés. Ils ne contactent jamais Avito.

Les bornes de 100 éléments par page, 100 caractères pour un identifiant d’annonce et 10 000 caractères par message sont des limites locales de protection, pas des maxima prouvés du serveur. Les données de profil, d’annonce, de recherche et de messagerie restent des contenus externes non fiables.
