# Ruby AI — page Web de l’adjoint personnel

Cette page est un frontend statique pour GitHub Pages, avec une interface de
conversation épurée et trois styles graphiques (Ruby rouge/noir, Faye violet et
or, Halley blanc dominant avec bleu secondaire). Des particules décoratives
animées prennent la couleur du thème; leur mouvement respecte la préférence de réduction des
animations. Elle présente Ruby comme un adjoint personnel et
professionnel : travail, rédaction, apprentissage, projets, organisation et
recherche. L’historique reste dans l’onglet courant ; la mascotte réagit au
travail et se trouve avec les messages Ruby, jamais en badge flottant près du
champ de saisie. Elle ne
contient aucun pouvoir système et ne publie jamais le code Python, PowerShell,
les journaux, les conversations ou les modèles locaux.

La copie publique est
`https://achab-error404.github.io/RubyAI-Website/`. Le dépôt principal
RubyBoosterAI reste privé ; seul l'artefact Web et les images de marque sont
miroités dans `AChab-Error404/RubyAI-Website`.

## Connexion depuis n'importe où

Le navigateur parle à `ruby_ai/runtime/web_bridge.py`, qui écoute par défaut
sur `127.0.0.1:8787`. Le pont :

- exige un jeton Bearer URL-safe de 43 caractères minimum, généré par
  `Start-RubyRemote.ps1` avec 32 octets aléatoires ;
- accepte uniquement les origines HTTPS déclarées ;
- expose seulement `GET /health` et `POST /chat` ;
- n'accepte côté navigateur que `message`, `request_id`, `turn_id` et
  `conversation_id` ; les champs de contrôle inconnus sont refusés ;
- construit lui-même la requête interne Galaxy (`stream: false`) et préfixe
  conversation/tour par `web-` pour éviter d'accéder à l'historique local ;
- sérialise les tours et revalide la requête construite via `chat_host` ;
- n'expose ni shell, ni fichiers, ni commandes projet ;
- n'écrit pas le texte ou le jeton dans ses logs.

Le lanceur officiel génère le jeton en mémoire sans l'écrire sur disque :

```powershell
.\tools\Start-RubyRemote.ps1 -ShowToken
```

Pour l'accès distant, publier **uniquement** ce port loopback via un tunnel
HTTPS privé et authentifié (Tailscale Funnel avec ACL ou Cloudflare Tunnel
avec Access, par exemple). Ne pas faire de redirection de port brute et ne
jamais utiliser `--bind 0.0.0.0` : le pont refuse d'ailleurs toute adresse qui
n'est pas loopback.

Dans « Réglages » de la page, choisir le thème et saisir l’URL HTTPS du tunnel terminant
par `/chat` et le même jeton. La page teste alors `/health` avant d'enregistrer
la connexion dans le `sessionStorage` de l'onglet. Le jeton n'est donc pas
conservé dans l'URL ni dans le dépôt GitHub.

En local uniquement, `http://127.0.0.1:8787/chat` reste accepté. Une URL HTTP
distante est refusée par conception.

Corps public de `POST /chat` (aucun champ de routage/modèle n'est accepté) :

```json
{"message":"Bonjour Ruby","request_id":"request-12345678","turn_id":"turn-12345678","conversation_id":"conversation-12345678"}
```

Le contrat détaillé, les scripts `Start-RubyRemote`, `Stop-RubyRemote` et
`Get-RubyRemoteStatus`, la politique de token et la comparaison des tunnels
sont documentés dans [`documentation/RUBY_REMOTE.md`](../documentation/RUBY_REMOTE.md).
