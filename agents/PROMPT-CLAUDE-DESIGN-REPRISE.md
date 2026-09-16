# Prompt de reprise — Claude Design, après l'arrêt pour manque de place

Claude Design s'est arrêté le 16/09 après avoir livré le design system, le
tableau de bord (mobile clair et sombre, desktop clair et sombre), les
abonnements (mobile clair et sombre) et la tournée (mobile clair, plus le
cockpit sombre). Il demandait s'il reprenait dans son ordre.

**Avant de coller : lui faire exporter ce qui est déjà fait.** Il a atteint sa
limite une fois, rien ne dit qu'il ne la retrouvera pas. Un export HTML
autonome maintenant met le travail à l'abri.

---

Exporte d'abord en HTML autonome ce qui est fait, avant de continuer.

Tes contrastes sont justes : j'ai recalculé les quatorze paires, douze tombent
au centième près. Les deux autres viennent de moi — j'avais écrit 5,95:1 pour
le principal sur blanc, la vraie valeur est **6,01:1**, dans les deux sens.
C'est corrigé dans la charte, ça ne change rien à tes écrans.

## Réponses à tes quatre doutes

**« À régler » quand il est vide.** Garde un état, ne le fais pas disparaître.
Une ligne discrète « Rien à signaler », dans le texte secondaire, sans icône
d'alerte. Deux raisons : un bloc qui s'efface fait sauter toute la mise en page
selon les jours, et surtout l'absence d'alerte est une information — Tom doit
savoir que le contrôle a eu lieu, pas se demander si l'écran a fini de charger.

**« Mensuel ».** Ton hypothèse est exactement ce que fait le code. La fonction
qui calcule les échéances pose `Math.min(jour d'origine, dernier jour du mois)` :
même date chaque mois, repli sur le dernier jour pour un 29, 30 ou 31. Un
abonnement créé le 31 janvier tombe le 28 février puis le 31 mars, sans dérive.
Tu peux l'écrire tel quel dans l'interface.

**Le stock sous chaque produit à la création.** Ne l'affiche pas comme une
donnée neutre : ce serait un piège. Créer un abonnement ou une échéance future
**ne réserve pas** le stock — c'est écrit dans la documentation du serveur.
Un nombre affiché à côté du produit laisserait croire l'inverse. Affiche-le
seulement quand il est bas ou nul, sous forme d'avertissement, avec un mot qui
dit que rien n'est réservé.

**« Problème » : motifs ou champ libre.** Les deux, et sache qu'aujourd'hui
**rien n'est enregistré du tout**. Le statut `probleme` existe, la raison non.
La structure d'un arrêt porte bien un champ `notes`, mais il recopie les notes
de la commande — il est déjà occupé. Ce que tu dessines demandera donc un champ
neuf côté serveur. Dessine une liste courte de motifs prédéfinis — fermé,
personne, adresse introuvable, refus, marchandise abîmée — plus un champ libre.
Les motifs prédéfinis se comptent dans les statistiques, le champ libre attrape
le reste.

**Le dépliant sous « Commandes » en nav desktop.** D'accord avec toi pour le
supprimer, puisque les cinq listes fusionnent en une.

## Ce que tu fais ensuite, dans cet ordre

J'ai changé ton ordre. La raison : si tu manques de place une seconde fois, je
veux que ce soit le desktop qui manque, pas le mobile. Tom travaille sur son
téléphone, en tournée et à l'entrepôt ; le bureau est le confort.

1. **Les écrans manquants, en mobile clair d'abord** : Préparation, Commandes,
   Stock, Clients, Paramètres. Commence par **Préparation** — c'est la page la
   plus douloureuse de l'application aujourd'hui, dix-neuf écrans de défilement
   mesurés.
2. **Les quatre états et la connexion**, en mobile clair : vide, chargement,
   erreur réseau, écran de connexion.
3. **Tout ce qui manque en sombre** : tournée (préparer, carte, fin), puis les
   écrans du point 1.
4. **Le desktop** : abonnements, tournée, et les écrans du point 1, clair puis
   sombre.
5. **Export final** en HTML autonome.

Arrête-toi et exporte dès que tu sens la place se réduire, plutôt que de
t'arrêter au milieu d'un écran. Et continue à me rendre les quatre listes :
décidé seul, inventé hors charte, pas sûr, contrastes employés.
