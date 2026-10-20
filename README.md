# Ruby — portail personnel Remote v2

Portail public : https://achab-error404.github.io/RubyAI-Website/

Ce site statique n'héberge aucune instance centrale de Ruby et ne reçoit pas les
conversations. Il remplace l'ancien chat public à jeton Bearer par un carnet
d'installations non secret.

## Utilisation

1. Obtenir sur son propre PC Ruby l'origine HTTPS privée, l'installation_id et
   le code utilisateur. Le code humain n'est ni un mot de passe ni un moyen de
   découvrir seul un PC sur Internet.
2. Ajouter ce descripteur au carnet, puis choisir « Ouvrir mon Ruby ».
3. Le chat complet s'ouvre sur l'origine HTTPS privée de cette installation.
4. Pour un nouvel appareil, ouvrir l'invitation courte créée sur le PC, comparer
   le challenge et obtenir l'approbation locale.
5. La session utilise un cookie Secure + HttpOnly + SameSite=Strict sur
   l'origine privée. Aucun bearer persistant n'est exposé au JavaScript public.

Le carnet conserve uniquement le nom, l'alias, l'origine et l'UUID attendu,
dans ce navigateur. Si son stockage est refusé, le carnet reste temporaire et
l'interface le signale. « Oublier du carnet » n'est pas une révocation : les
appareils et sessions se révoquent depuis le PC Ruby.

## Ce que cette publication n'active pas

Aucun tunnel, bridge de production, port public, règle de pare-feu ou modèle
n'est démarré par ce site. Sans origine HTTPS privée disponible, la conversation
reste indisponible. Il n'existe ni fallback vers un autre Ruby, ni table
publique de correspondance entre les utilisateurs et leurs PC.

Le chemin privé prévu utilise Tailscale Serve, pas Funnel public. La recette
sur téléphone hors réseau local, le cookie HTTPS de bout en bout et le
redémarrage de production restent **NOT VERIFIED — environnement indisponible**.
Cette publication ne revendique pas une recette de conversation réelle.

Les anciens onglets v1 doivent être fermés. L'ancien client public `ruby.js`
est retiré de cette révision ; les données d'un ancien navigateur ne sont pas
effacées automatiquement.

## Traçabilité de l'artefact

- Source produit : `RubyBoosterAI`, branche `ruby-galaxy/windows-integration`.
- Commit source : `6e220db122c6d8ddbea73d8cfc1706f7945ac58e`.
- Publication du portail : 20 octobre 2026.
- Export : `tools/Export-RubyWeb.ps1 -Variant PortalV2`.
- `public-manifest.json` : 18 fichiers publics avec taille et SHA-256.
- Contenu : HTML/JS du carnet, CSS et images de marque (11 états de mascotte).
- Exclus : client de chat privé, Python, PowerShell, configuration, modèles,
  invitations, clés, cookies, conversations, journaux et registre DPAPI.

Le fond affiche des micro-particules décoratives en CSS, sans script ou requête
supplémentaire. Elles suivent la couleur du thème, laissent passer les clics et
cessent de bouger avec la préférence système de réduction des animations.

La CI du dépôt produit exécute les 33 tests frontend du carnet et du client
privé ; les contrôles d'export et de paquet sont également couverts côté
PowerShell. Ces tests ne remplacent pas la recette HTTPS privée réelle.
