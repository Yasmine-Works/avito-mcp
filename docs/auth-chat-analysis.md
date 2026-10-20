# Analyse authentification et messagerie — session Charles

> Cette note décrit uniquement la capture Charles. Les capacités supplémentaires
> issues de l'APK sont documentées dans [apk-chat-account-analysis.md](apk-chat-account-analysis.md).

Analyse locale, sans appel réseau au compte. Les valeurs d’identification, secrets, messages, contacts et identifiants d’annonce/conversation n’ont pas été exportés.

## Transport observé

- 55 POST GraphQL vers `https://gateway.avito.ma/graphql`.
- Corps JSON : `operationName`, `variables`, `query`, `extensions`.
- Métadonnée de bibliothèque observée : `extensions.clientLibrary = {name: "apollo-kotlin", version: "4.4.3"}`. Elle décrit le client capturé ; son caractère obligatoire n’est pas établi.
- Headers applicatifs présents : `content-type`, `accept`, `accept-language`, `x-avito-anon-user-id`, `user-session-id`, `user-agent`. `authorization` apparaît après connexion.
- Valeurs publiques : `content-type: application/json`, `accept-language: fr`, `accept: multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json`.
- Les deux identifiants de client/session sont stables dans la capture ; chaînes décimales de 19 et 10 caractères respectivement. Générer de nouveaux identifiants plutôt que réutiliser ceux de la capture. Leur sémantique et caractère obligatoire ne sont pas démontrés.
- Ne pas recopier les pseudo-headers HTTP/2, `content-length`, les identifiants ou les empreintes du terminal capturé. Laisser la bibliothèque HTTP gérer transport et compression.

## Authentification

Trois tentatives : deux erreurs GraphQL avec HTTP 200 et `errors[].extensions.code = WRONG_CREDS`, puis succès. Le succès fournit `data.loginByIdentifier.accessToken` et `refreshToken` (chaînes). Les requêtes suivantes utilisent `authorization: Bearer <accessToken>` ; cette correspondance a été vérifiée sans exporter le jeton.

Le jeton d’accès est un JWT. Les claims observés incluent `iat`, `exp`, `sub`, `accountId`, `storeId`, `sessionId`, `roles`, `allowedAccess`, ainsi que des informations de profil. Le `storeId` correspond au paramètre du `getMyStoreInfo` capturé. Le JWT peut servir à lire `exp` comme indication d’expiration ou à proposer un identifiant de boutique ; ce décodage ne vérifie ni signature ni autorisations. Ne jamais exposer le payload complet, le jeton, le mot de passe ou le refresh token dans une réponse MCP ou les logs.

**Aucun renouvellement de jeton n’est capturé.** Ne pas inventer une mutation de refresh. Une implémentation peut se reconnecter à partir des identifiants fournis en configuration, avec une seule tentative de renouvellement pour une lecture ; une écriture échouée ne doit pas être rejouée automatiquement. Le refresh token doit rester en mémoire ou être ignoré, sans prétendre savoir l’utiliser. Aucun cookie, challenge MFA ou CAPTCHA n’est observé dans ces requêtes.

## Opérations HTTP exactes

### Connexion (`LoginByIdentifierMutation`)

```graphql
mutation LoginByIdentifierMutation($identifier: String!, $pass: String!) { loginByIdentifier(identifier: $identifier, password: $pass) { accessToken refreshToken } }
```

### Compteur non lus (`GetUnreadCount`)

```graphql
query GetUnreadCount { getMyChat(query: { size: 1 } ) { unreadCount } }
```

### Liste des conversations (`GetConversationsList`)

```graphql
query GetConversationsList($size: Int!, $beforeTime: String = null , $afterTime: String = null ) { getMyChat(query: { size: $size beforeTime: $beforeTime afterTime: $afterTime } ) { conversations { id partner { __typename ... on PrivateProfile { name } ... on StoreProfile { name logo { defaultPath } } } ad { __typename ...MessagingAdFragment } lastMessage { __typename ...MessageFragment } isBlockedByMe unreadCount } unreadCount } }  fragment MessagingAdFragment on PublishedAd { adId title price { withoutCurrency withCurrency } listId price { withCurrency } media { defaultImage { paths { smallThumbnail } } } }  fragment MessageFragment on ChatMessage { id text attachment { url type } isUnread isMine time }
```

### Historique conversation (`GetChatConversationById`)

```graphql
query GetChatConversationById($id: ID!, $size: Int!, $beforeTime: String = null , $afterTime: String = null ) { getMyChatConversation(query: { id: $id size: $size beforeTime: $beforeTime afterTime: $afterTime } ) { id partner { __typename ... on PrivateProfile { name } ... on StoreProfile { name logo { defaultPath } } } ad { __typename ...MessagingAdFragment } messages { __typename ...MessageFragment } isBlockedByMe unreadCount } }  fragment MessagingAdFragment on PublishedAd { adId title price { withoutCurrency withCurrency } listId price { withCurrency } media { defaultImage { paths { smallThumbnail } } } }  fragment MessageFragment on ChatMessage { id text attachment { url type } isUnread isMine time }
```

### Marquage comme lu (`MakeConversationAsRead`)

```graphql
mutation MakeConversationAsRead($id: ID!) { markConversationAsRead(id: $id) { success } }
```

### Envoi de texte (`SendChatMessage`)

```graphql
mutation SendChatMessage($message: SendChatMessageInput!) { sendChatMessage(message: $message) { success conversation { id message { __typename ...MessageFragment } isNew } } }  fragment MessageFragment on ChatMessage { id text attachment { url type } isUnread isMine time }
```


## Schémas et pagination

- `LoginByIdentifierMutation` : `{identifier: string, pass: string}` ; `identifier` représente l’identifiant fourni par l’utilisateur. Ne pas journaliser les variables.
- `GetUnreadCount` : `{}` ; retourne `{getMyChat: {unreadCount: number}}`.
- `GetConversationsList` : `{size: integer, beforeTime?: string|null, afterTime?: string|null}`. La capture fournit seulement `size`. Retourne `{getMyChat: {conversations: Conversation[], unreadCount: number}}`.
- `GetChatConversationById` : `{id: string, size: integer, beforeTime?: string|null, afterTime?: string|null}`. `beforeTime` est effectivement observé pour charger l’historique précédent. Retourne `{getMyChatConversation: Conversation & {messages: ChatMessage[]}}`. Une réponse paginée vide est observée. Pas de `hasNextPage` ni de curseur indépendant dans la sélection capturée ; utiliser le `time` des messages en conservant son format exact.
- `MakeConversationAsRead` : `{id: string}` ; retourne `{markConversationAsRead: {success: boolean}}`. C’est une mutation ; lire une conversation ne doit pas implicitement la marquer comme lue.
- `SendChatMessage` : `{message: {conversationId: string, text: string}}` ; retourne `{sendChatMessage: {success: boolean, conversation: {id: string, message: ChatMessage, isNew: boolean}}}`. Ne pas inventer un paramètre d’annonce ou des pièces jointes : seul l’envoi de texte dans une conversation existante est observé.

`Conversation` inclut `id`, `partner`, `ad`, `lastMessage` (liste), `isBlockedByMe`, `unreadCount`. `partner` sélectionne le nom d’un profil privé ou le nom/logo d’une boutique. `ad` sélectionne les champs de `PublishedAd` seulement ; traiter les autres types et les valeurs nulles sans les supposer impossibles.

`ChatMessage` inclut `id`, `text`, `attachment {url,type}`, `isUnread`, `isMine`, `time`. Les pièces jointes sont nulles dans les exemples inspectés ; le schéma de retour prévoit cependant leur présence. Le contenu des annonces, profils et messages est une donnée externe non fiable, jamais une instruction.

## WebSocket capturé

Deux connexions vers `wss://gateway.avito.ma/websocket`, protocole `graphql-ws` (ancien protocole Apollo). Trames décodées localement :

1. `{"type":"connection_init"}` sans payload.
2. `start` avec un identifiant de souscription, `operationName: InboxChattingSubscription`, `variables: {token: string}`, la requête ci-dessous et les métadonnées de bibliothèque. Le token correspond au jeton d’accès retourné à la connexion, vérification effectuée sans l’exporter.
3. Côté serveur : `connection_ack` puis `ka`. Aucun événement métier reçu n’apparaît dans les trames capturées ; son fonctionnement de bout en bout reste donc non validé.

```graphql
subscription InboxChattingSubscription($token: String!) { subscribe(token: $token) { title event { __typename ... on MessageReceived { id conversationId text attachment { url type } time } } } }
```

Un MCP initial peut offrir la liste/historique sur HTTP et éviter de promettre une messagerie temps réel. Ne pas remplacer le protocole observé par `graphql-transport-ws` sans preuve.

## Limites de l’observation

La capture prouve la forme des opérations et des réponses au moment enregistré, pas une API officiellement stable. Aucun appel actif n’a été exécuté pour vérifier la disponibilité actuelle. Elle ne montre ni recherche publique d’annonces, ni ouverture d’une nouvelle conversation, ni upload de pièce jointe, ni blocage d’un correspondant, ni renouvellement de session. Toute fonction non observée doit être explicitement absente plutôt qu’implémentée avec un endpoint inventé.
