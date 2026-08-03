# Cadence — Fréquences flexibles + date de test

## Contexte

Cadence est une app web mono-fichier (`index.html`) qui permet de suivre des
activités récurrentes ("rituels") et d'envoyer des notifications quand elles
sont en retard. Aujourd'hui, la fréquence d'une activité est modélisée comme
"N fois par semaine/mois" avec des périodes calées sur le calendrier (lundi à
dimanche, 1er au dernier jour du mois).

Deux limitations à lever :
1. Impossible de choisir une cadence en jours, ou un multiplicateur libre
   (ex: tous les 3 jours, toutes les 2 semaines, tous les 3 mois).
2. Impossible de tester le comportement des notifications/statuts sans
   attendre que le temps réel passe.

## 1. Modèle de données & migration

Chaque activité remplace `period` + `target` par :
- `intervalCount` (number ≥ 1) — le X dans "tous les X jours/semaines/mois"
- `intervalUnit` ('day' | 'week' | 'month')
- `createdAt` (ISO timestamp) — nouveau champ, sert d'ancre avant la
  première complétion

`target` et `period` disparaissent du schéma. Le champ `completions` (array
de timestamps ISO) est inchangé.

**Migration au chargement** (`loadData`) : pour toute activité qui a
`period` mais pas `intervalUnit`, appliquer :
- `intervalUnit = act.period` ('week' ou 'month')
- `intervalCount = 1`
- `createdAt = act.completions[0] ?? new Date().toISOString()`
- supprimer `period` et `target`

C'est une conversion à sens unique (perte de la nuance "N fois par
semaine"), acceptable car les données sont locales et personnelles.

## 2. Logique de cycle

Remplace `periodBounds` + une partie de `computeStatus`.

Pour une activité non terminée (`endDate` non dépassée) :
- `anchor` = timestamp de la complétion la plus récente, sinon `createdAt`
- `nextDue` = `anchor` + `intervalCount` unités :
  - `day` → `+ intervalCount` jours
  - `week` → `+ intervalCount * 7` jours
  - `month` → `setMonth(getMonth() + intervalCount)` (gère les mois de
    longueur variable naturellement)
- `now` = `getNow()` (voir section 4, remplace tous les `new Date()` du
  calcul de statut)

Statut :
- `now >= nextDue` → **red** (en retard)
- sinon `daysLeft = nextDue - now` ; `total = nextDue - anchor` ;
  `daysLeft / total < 0.25` → **amber** (bientôt dû)
- sinon → **green**

`markDone(id)` pousse `getNow()` dans `completions` — le cycle repart
automatiquement de ce point, pas besoin de reset explicite.

Le statut `ended` (activité avec `endDate` dépassée) reste géré en premier,
avant le calcul de cycle, comme aujourd'hui.

## 3. Formulaire (sheet d'ajout/édition)

Le champ "Fois" est supprimé. La ligne "Par" devient :
- un input number pour `intervalCount` (min 1, défaut 1)
- un select pour `intervalUnit` : Jour / Semaine / Mois

Libellé résultant sur la carte : "tous les 3 jours", "toutes les 2
semaines", "tous les 3 mois" (accord singulier/pluriel selon `intervalCount`
et genre selon l'unité).

La ligne de fréquence sur la carte affiche en plus le statut du cycle :
- vert/amber : "tous les 3 jours · prochain dans 2j"
- rouge : "tous les 3 jours · en retard de 1j"
- ended : comportement actuel inchangé ("terminé le ...")

Le champ "Durée" (permanent / jusqu'à une date) est inchangé, orthogonal à
la fréquence.

## 4. Dial (indicateur circulaire)

Remplace `count/target` par une fraction de cycle écoulé :
- `pct = clamp((now - anchor) / (nextDue - anchor), 0, 1)`
- rouge et plein (`pct = 1`) quand en retard
- texte central : nombre de jours restants arrondi (ex. "2j"), ou "Auj."
  si dû aujourd'hui ou en retard

## 5. Date de test ("Mode test")

Nouvelle section repliable en bas de page (après la liste, avant/à côté du
FAB), contenant :
- un input `datetime-local` pour fixer une date/heure fictive
- un bouton "Réinitialiser" qui efface la valeur et revient à l'heure réelle
- un indicateur textuel de l'état actuel ("Date réelle" ou "Date simulée :
  ...")

La valeur est sauvegardée dans le storage (même mécanisme que
`activities`, sous une clé `cadence_fake_now`) pour survivre aux rechargements.

**Point central de l'implémentation** : une fonction `getNow()` remplace
tous les usages directs de `new Date()` qui représentent "l'instant présent"
dans la logique métier (`computeStatus`, `markDone`, `checkAndNotify`,
l'affichage "prochain dans Xj"). Elle retourne la date fake si définie,
sinon `new Date()` réelle. Les usages de `new Date(ts)` pour parser un
timestamp stocké (pas "maintenant") restent inchangés.

Le `setInterval(checkAndNotify, 30*60*1000)` continue de tourner en tâche
de fond réelle (basé sur l'horloge système, pas sur la date fake) — seul ce
que `checkAndNotify` *évalue* comme "en retard" utilise `getNow()`. Ça
permet de fixer une date fake dans le futur et de voir immédiatement (au
prochain tick, ou en cliquant "Tester") si une notif se déclencherait.

## Hors scope

- Pas de vrai "time travel" qui avance automatiquement l'horloge fake avec
  le temps réel qui passe — c'est une valeur statique qu'on fixe et qu'on
  peut changer manuellement.
- Pas de service worker / notifications en arrière-plan quand l'onglet est
  fermé — comportement actuel (notifications only while tab open) inchangé.
