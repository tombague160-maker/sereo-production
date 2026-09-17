# Prompt de suite, en un seul bloc — Claude Design

Choix de Thomas le 16/09 : tout donner d'un coup plutôt qu'un écran à la fois.
Les six prompts de suite sont fusionnés ici, dans le même ordre, avec des
points de contrôle pour qu'une erreur de charte ne se propage pas.

**Avant de coller : remplacer `DESIGN.md` dans le projet par la version à jour**
(`design/DESIGN.md`, ou `Desktop\claude-design-sereo\DESIGN.md`). Elle intègre
les corrections de badges, la nouvelle alerte sombre et la règle d'alerte.

---

Tes trois propositions sont retenues : barre basse à Tableau de bord,
Préparation, Tournée, Abonnements ; fréquence en intervalle strict avec
l'aperçu des dates ; sombre qui suit le système avec bascule manuelle.

J'ai remplacé `DESIGN.md` par une version corrigée. Trois changements depuis
celle que tu as lue, dont deux viennent de toi :

- Tes deux teintes de badge entrent dans la charte : `#F7E4E0` et `#DDEBE9`,
  texte `#2A5254`. La pêche et le vert d'eau restent aux formes de fond.
- L'alerte sombre n'est **pas** `#F28B7A` mais **`#F2635A`**. Ton diagnostic
  était bon, ton remède non : `#FF9478` ne posait pas un problème de contraste
  sur le fond (7,61:1 sur la surface, pas 5,9), mais de confusion avec
  l'accent — 1,06:1 entre les deux, la même couleur à l'œil. `#F28B7A` ne
  monte qu'à 1,18:1. La teinte de l'accent étant à 10°, aucun rouge ne s'en
  détache vraiment. D'où `#F2635A` (5,23:1 sur surface, écart 1,54) **et**
  une règle nouvelle : une alerte ne voyage jamais par la couleur seule, elle
  porte toujours une icône ou un mot. Applique-la partout.
- Une affirmation à corriger : `--color-text-soft` du dépôt, `#5e6d6d`, donne
  **5,08:1** sur `#FBF7F5`. Il passe le seuil, il n'y avait rien à corriger.

Fais maintenant la suite complète, dans cet ordre, sans t'arrêter entre les
étapes — sauf si un contrôle échoue, auquel cas tu t'arrêtes et tu me le dis.

**1. Tableau de bord en sombre**, avec les mêmes tokens.
Contrôle : liste chaque paire de contraste avec sa valeur. Si l'une tombe sous
4,5:1 pour du texte courant ou 3:1 pour du gros texte ou une icône, **arrête-toi
et dis-le** au lieu de corriger toi-même en douce — c'est la charte qu'il faut
changer, et elle sert aussi au code.

**2. Abonnements**, mobile clair : la liste et la fiche de création, avec le
sélecteur de fréquence et l'aperçu des trois prochaines dates portant leur jour
de la semaine.

**3. Tournée**, mobile clair, les quatre étapes : préparer, cockpit, carte, fin
de tournée. Reprends le cockpit de la planche jointe.

**4. Les écrans 2 et 3 en sombre**, puis **tous les écrans en desktop
1440 × 900**, clair puis sombre.
Contrôle : à ce stade, aucun composant ne doit exister en deux versions. Si tu
as dû en dupliquer un pour le desktop, dis-le.

**5. Le reste** : Préparation, Commandes, Stock, Clients, Paramètres, en mobile
et desktop, clair et sombre. Plus les états : vide, chargement, erreur réseau,
et l'écran de connexion.

**6. Export** en HTML autonome, prêt pour le passage à Claude Code.

## Ce que je veux à la fin, en plus des écrans

- **La liste de ce que tu as décidé seul.** Chaque fois que la charte ne
  tranchait pas et que tu as choisi, dis quoi et pourquoi. C'est le prix de
  tout te donner d'un coup : je dois pouvoir relire tes arbitrages.
- **La liste de ce que tu as dû inventer** qui n'est ni dans la charte ni dans
  les planches : composants nouveaux, libellés nouveaux, règles nouvelles.
- **Ce dont tu n'es pas sûr**, écran par écran. Ne le lisse pas.
- **Les contrastes**, une fois par mode et non par écran : un tableau des
  paires réellement employées.

Rappels qui valent pour tout : français sans anglicisme, données réalistes et
jamais de faux texte, cibles tactiles ≥ 44 px, jamais de texte sur fond orange,
pas de gris neutres, quatre informations par ligne au maximum. Le résultat sera
recodé à la main en HTML, CSS et JavaScript natifs, sans framework : garde les
composants simples et les tokens en variables CSS.
