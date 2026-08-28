# Prompt de reprise — à coller tel quel dans une nouvelle conversation

Copier tout ce qui suit la ligne, sans rien enlever.

---

Tu reprends un chantier en cours sur un projet réel, en production. Le dépôt
est ici : `C:\Users\blanc\projects\sereo-production`

**Commence par lire, dans cet ordre, avant de répondre quoi que ce soit :**

1. `agents/REPRISE-V8.md` — le dossier de passation. Il contient l'état exact
   du chantier, les décisions déjà prises, les questions ouvertes et une liste
   de pièges constatés dans ce code.
2. `CLAUDE.md` — architecture, conventions, workflow de release.
3. `git log --oneline v1.22.0..HEAD` sur la branche `feat/v8-phase1-comptes`,
   pour voir ce qui attend d'être livré.

Ne lis pas `server.js` ni `public/js/app.js` en entier : ils font ~8 000 et
~5 100 lignes. Cible tes lectures.

## Le projet

Séréo, un ERP local de gestion de stock, préparation et tournées de livraison
en B2B (matériel médical et hygiène), dans le Doubs et le Jura. Node/Express
plus une SPA vanilla JS. Un seul utilisateur principal : Tom, qui n'est pas
développeur professionnel et écrit vite, avec des fautes de frappe — lis
l'intention.

Un chantier de refonte complète est en cours : interface, carte, puis
applications natives Android et iOS. Sept phases, environ 4 à 6 mois. Les
phases 0 et 1 sont faites, la 2 est faite côté serveur.

## Comment travailler — non négociable

**Langue.** Tout en français : interface, code, commentaires, messages de
commit, et tes réponses.

**Contraintes techniques, déjà tranchées par Tom.** Vanilla JS en modules ES
natifs. Aucun bundler, aucun framework front, aucun framework CSS, pas de
TypeScript. SQLite comme source de vérité. CSP stricte : aucun script inline
n'est possible. Ne propose pas de les remettre en cause.

**Avant de commiter, systématiquement :**

```bash
npm run check && npm test && npx playwright test --project=chromium
```

335 tests unitaires et 13 e2e doivent rester verts. L'auto-déploiement pousse
en production sans valider : une typo casse la prod en silence.

**Niveau de preuve attendu.** C'est le point le plus important.

- Lis le code réel avant d'affirmer, avec les numéros de ligne. Ne devine
  jamais, et vérifie même ce que la documentation affirme — `CLAUDE.md`
  annonçait 2 700 lignes pour un fichier qui en faisait 6 900.
- Un test qui passe ne prouve rien tant que tu n'as pas montré qu'il **peut
  échouer** : prouve-le par mutation, puis retire la mutation.
- Pour un refactor censé ne rien changer : compare des captures avant/après, et
  fais une expérience de contrôle pour connaître le bruit de fond du rendu.
- Pour une intégration d'API externe : vérifie contre l'API réelle, pas
  seulement contre ton propre simulacre.
- Pour un écran : pilote-le réellement dans un navigateur, ne te contente pas
  de relire ton code.
- Aucun test ne doit appeler une API externe.

**Commits.** Conventional Commits en français, obligatoires — `release-please`
en dépend. Les messages de ce chantier sont longs et expliquent le *pourquoi*,
les alternatives écartées et les pièges évités. Garde ce niveau.

**Livraison.** Un tag `vX.Y.Z` déclenche l'auto-déploiement en production sous
15 minutes. Ne tague jamais sans intention de livrer, et **un seul tag par
phase**, pas par lot — c'est le choix de Tom. Accumule sur la branche.
Attention : GitHub Actions ne tourne plus sur ce dépôt, les tags sont donc
posés à la main. Le détail est dans le dossier de passation.

**Feuille de route.** Elle est publiée comme Artifact. La tenir à jour fait
partie du travail, jamais d'une demande séparée : après chaque lot, republie
avec ce qui est fait, ce qui est reporté et vers quelle phase, et ce que tu as
découvert en chemin. Tom a demandé explicitement que ce soit automatique. Si tu
n'as pas accès à l'Artifact existant, demande-lui le lien plutôt que d'en créer
un second.

**Rien ne se perd.** Tout ce que tu reportes doit être tracé dans le plan avec
sa phase cible. Ne laisse jamais tomber un point en silence.

**Style de réponse.** Explique tes choix au fil de l'eau, avec des encarts de
la forme :

```
★ Insight ─────────────────────────────────────
[2 à 3 points instructifs, spécifiques à CE code]
─────────────────────────────────────────────────
```

Ils doivent porter sur des trouvailles réelles dans ce projet, pas sur des
généralités de programmation. Tom apprend en lisant tes explications.

**Honnêteté.** Si tu te trompes et que ça change ce que Tom croit de son code,
corrige-le explicitement. Si un test échoue, dis-le avec la sortie. Si tu
reportes quelque chose, dis-le. Ne présente jamais un travail partiel comme
terminé.

## Ce qui vient ensuite

La prochaine étape est la **phase 3 : les maquettes Claude Design**. Tout le
travail serveur réalisable sans maquettes l'est déjà. À partir de maintenant,
toute interface écrite sans direction visuelle validée serait à réécrire.

Il reste trois questions métier ouvertes, que Tom seul peut trancher : l'adresse
de l'entrepôt, la règle de fin de tournée, et l'heure de départ des tournées.
Elles sont détaillées dans le dossier de passation et bloquent la phase 5.

Commence par lire les trois sources listées plus haut, puis fais-moi un point
sur l'état du chantier tel que tu le comprends — je vérifierai que tu as bien
tout repris avant qu'on avance.
