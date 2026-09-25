# Page Web Ruby AI — pont GitHub Pages vers Ruby local

Cette page est un frontend statique rouge/noir pour GitHub Pages. Elle ne
contient aucun pouvoir système et ne publie jamais le code Python, PowerShell,
les journaux, les conversations ou les modèles locaux.

La copie publique est
`https://achab-error404.github.io/RubyAI-Website/`. Le dépôt principal
RubyBoosterAI reste privé ; seul l'artefact Web et les images de marque sont
miroités dans `AChab-Error404/RubyAI-Website`.

## Connexion depuis n'importe où

Le navigateur parle à `ruby_ai/runtime/web_bridge.py`, qui écoute par défaut
sur `127.0.0.1:8787`. Le pont :

- exige un jeton Bearer d'au moins 32 caractères ;
- accepte uniquement les origines HTTPS déclarées ;
- expose seulement `GET /health` et `POST /chat` ;
- sérialise les tours et délègue la validation à `chat_host` ;
- n'expose ni shell, ni fichiers, ni commandes projet ;
- n'écrit pas le texte ou le jeton dans ses logs.

Créer un jeton local sans le committer :

```powershell
$env:RUBY_WEB_TOKEN = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Puis démarrer le pont depuis le dépôt Ruby :

```powershell
python -m ruby_ai.runtime.web_bridge `
  --project-root E:\RubyGalaxyAudit `
  --origin https://achab-error404.github.io
```

Pour l'accès distant, publier **uniquement** ce port loopback via un tunnel
HTTPS privé et authentifié (Tailscale Funnel avec ACL ou Cloudflare Tunnel
avec Access, par exemple). Ne pas faire de redirection de port brute et ne
jamais utiliser `--bind 0.0.0.0` : le pont refuse d'ailleurs toute adresse qui
n'est pas loopback.

Dans « Connexion locale » de la page, saisir l'URL HTTPS du tunnel terminant
par `/chat` et le même jeton. La page teste alors `/health` avant d'enregistrer
la connexion dans le `sessionStorage` de l'onglet. Le jeton n'est donc pas
conservé dans l'URL ni dans le dépôt GitHub.

En local uniquement, `http://127.0.0.1:8787/chat` reste accepté. Une URL HTTP
distante est refusée par conception.
