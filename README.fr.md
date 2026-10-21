<p align="center">
  <img src="docs/images/cover-fr.png" width="100%" alt="SRTB Graphics — L’habillage télévisé, dans votre navigateur. Créé par Jimmy de Souza." />
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>Français</strong>
  <br />
  <a href="docs/PORTFOLIO.md">Le projet</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="docs/SETUP.md">Développement</a> · <a href="docs/VERIFICATION.md">Vérifications</a>
</p>

<h1 align="center">Du programme au livrable validé.</h1>

<p align="center">Un espace partagé pour les habillages, la préparation et la production audiovisuelle.<br />Conçu et développé par <a href="https://github.com/jimdsz"><strong>Jimmy de Souza</strong></a>.</p>

<br />

![SRTB Graphics — bibliothèque réelle des modèles](docs/images/catalogue.png)

<p align="center"><sub>Application réelle · Données locales de démonstration · Interface française</sub></p>

<br />

<table>
  <tr>
    <td width="33%" valign="top"><h3>01 / Créer</h3><p>Partir d’un modèle d’habillage. Ajuster textes, graphisme, médias et audio avec un aperçu direct.</p></td>
    <td width="33%" valign="top"><h3>02 / Organiser</h3><p>Relier émissions, tâches et médias. Garder les révisions et les responsabilités de relecture visibles.</p></td>
    <td width="33%" valign="top"><h3>03 / Livrer</h3><p>Préparer les formats TV et sociaux. Exporter avec progression, annulation et contrôles explicites.</p></td>
  </tr>
</table>

## Le projet

SRTB Graphics réunit la préparation des habillages dans un espace partagé accessible depuis le navigateur : choisir un modèle, travailler avec des médias locaux, modifier une composition, relire une révision et produire un fichier de livraison. Son interface française suit les besoins quotidiens des infographistes et des équipes de diffusion.

Ce dépôt présente le code de l’application et ses choix techniques. **Il s’agit d’un instantané public du code pour le portfolio, pas d’une sauvegarde complète de l’installation de production ni d’une démonstration publique prête à déployer.** Les polices sous licence, médias de diffusion, configurations privées, données et installateurs restent hors de Git. Voir [l’installation et les ressources nécessaires](docs/SETUP.md).

## Fonctionnalités

| Domaine | Fonctions présentes dans le code |
| --- | --- |
| Studio graphique | Catalogue de modèles, textes, couleurs, logos, images, extraits vidéo et audio, avec prévisualisation |
| Formats TV et réseaux sociaux | Compositions TV 16:9, portrait 4:5 et vertical 9:16 ; déclinaisons liées et préparation de campagnes |
| Organisation de la production | Import de conducteurs tableur/PDF, dossiers d’émissions, préparation quotidienne, affectation des tâches et rapprochement des médias |
| Travail d’équipe | Projets et révisions, commentaires, soumission et validation, rôles et gestion des conflits |
| Médias locaux | Références et empreintes des fichiers, reconnexion sur un autre poste, connecteur Windows facultatif |
| Exports | Chemins MP4/H.264, MOV/ProRes 4444, séquences PNG et WebM alpha ; disponibilité selon le profil, le navigateur et les ressources |
| Annonces commerciales | Espace distinct pour les séquences de texte, logos, voix off, musique et export vidéo |

L’application prépare les fichiers **hors antenne** : elle n’envoie pas de commande à un système de diffusion. Choisir un fichier local ne le téléverse pas automatiquement ; le partage cloud est une action distincte.

## Pensé pour la production

![Portail des outils SRTB](docs/images/portal.png)

Les captures montrent l’application locale réelle, avec un compte de qualification temporaire et des données de démonstration. Ce ne sont ni des maquettes ni des dossiers de production.

## Choix techniques

- **Traitement multimédia dans le navigateur :** Canvas, WebCodecs, Web Audio et workers, avec progression et annulation.
- **Préservation des moteurs graphiques :** adaptateurs versionnés et contrôles SHA-256 autour de la bibliothèque originale.
- **Protection du travail :** contrôles de révision, brouillons locaux et confirmation des sorties avec modifications.
- **Droits côté serveur :** identité, appartenance, rôles et accès aux projets sont vérifiés par l’API.
- **Profils de livraison distincts :** le profil d’export natif et l’ancien repli logiciel ont leurs propres exigences de publication.

L’[architecture](docs/ARCHITECTURE.md) détaille les principaux composants et les flux de données.

## Parcourir le code

```text
src/studio/             Studio, planning, collaboration et médias
src/studio/video/       Rendu, chronologie, audio et encodage
src/studio/commercial/  Espace des annonces commerciales
server/                Authentification, permissions, projets et stockage
migrations/            Évolution du schéma de base de données
connector/             Connecteur local et préparation Windows
scripts/               Préparation des ressources, build et contrôles
tests/                 Tests unitaires, intégration et recette navigateur
docs/                  Portfolio, installation, architecture et vérification
```

## Développement

Utiliser Node.js 24 LTS et npm. Ces vérifications portables ne nécessitent ni identifiants de production ni bibliothèque graphique privée :

```sh
npm ci
npm run typecheck
npm run test:portable
```

Le studio complet nécessite les ressources graphiques conservées séparément et un backend local. Suivre [SETUP.md](docs/SETUP.md) avant de le lancer. La restauration d’une installation exige aussi les sauvegardes indépendantes de D1 et des médias partagés.

## État vérifié — 21 octobre 2026

Le build de l’installation locale complète réussit avec `build:studio:native:derivations`. Un défaut lié à la conservation des ressources PDF `.mjs` a été corrigé, avec deux tests de non-régression.

La revue a également relevé des échecs restant à traiter : **1 716 vérifications unitaires réussies, 12 en échec et 3 ignorées ; 420 vérifications d’intégration réussies et 11 en échec.** Le dépôt ne revendique donc ni une suite entièrement verte ni une certification de diffusion. Le [compte rendu](docs/VERIFICATION.md) précise le périmètre et les réserves. La CI couvre uniquement le sous-ensemble portable indiqué.

## Dans mon portfolio

Ce projet illustre la conception d’un produit métier, le développement frontend et backend, le traitement multimédia dans le navigateur et les outils de livraison. Il présente une application fonctionnelle avec ses limites documentées, sans gains de productivité ou de performance non mesurés.

Auteur : [Jimmy de Souza](https://github.com/jimdsz). La présentation anglaise est disponible dans [README.md](README.md).

Consulter les [droits et composants tiers](docs/RIGHTS.md) avant toute réutilisation du code, des marques ou des médias. Cette publication n’accorde pas de licence open source globale.
