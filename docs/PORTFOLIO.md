# SRTB Graphics — project case study / étude de cas

## English

### Context

Broadcast graphics production spans several tasks: selecting a graphic identity, adapting programme information, collecting the right media, reviewing a version and creating a usable delivery file. SRTB Graphics groups those tasks in a browser workspace with explicit responsibilities for designers, broadcasters and administrators.

### Product approach

The interface starts from the operator's work: today's production, tasks, projects, programmes, templates, media and review. The editor keeps preview, settings and revision status together. TV and social compositions share a preparation workflow, while the commercial announcements workspace has its own tools and permissions.

### Technical work represented

The implementation combines a React/TypeScript application, a Cloudflare Worker API, D1 data storage, Firebase identity, private object storage and an optional Windows media connector. It contains substantial browser media work: timeline alignment, cropping, text layout, audio envelopes, frame-based rendering, export cancellation and file verification.

Template integrity is a deliberate design choice. Versioned adapters and pinned hashes allow the studio to evolve without silently changing the original graphic engines. Local references also separate working with a file from uploading it to shared storage.

### Evidence and lessons

The reviewed native build succeeds. The repository includes real interface captures and a dated account of passing and failing tests. Current limitations include unresolved regression tests, separately held assets, browser-dependent codec support and a legacy build profile that no longer matches the current feature set.

This is a portfolio example of specialised product engineering, not a claim of certified broadcast compliance. No measured time saving, user adoption or commercial outcome is asserted without supporting evidence.

**Short portfolio description:**

> I created SRTB Graphics, a browser workspace for preparing broadcast graphics, coordinating production and exporting audiovisual deliverables. The project combines React and TypeScript with client-side media processing, a permission-controlled backend and tools for working with local media. It reflects my work across interface design, application architecture and broadcast production workflows.

## Français

### Contexte

Préparer un habillage télévisé demande de choisir une identité graphique, adapter les informations d’une émission, réunir les bons médias, relire une version et produire un fichier exploitable. SRTB Graphics rassemble ces étapes dans un espace web, avec des responsabilités explicites pour les infographistes, diffuseurs et administrateurs.

### Approche produit

L’interface part du travail de l’opérateur : production du jour, tâches, projets, émissions, modèles, médias et validation. L’éditeur rapproche aperçu, réglages et état de la révision. Les compositions TV et sociales partagent une logique de préparation ; les annonces commerciales disposent d’un espace et de permissions distincts.

### Travail technique présenté

Le projet associe une application React/TypeScript, une API Cloudflare Worker, D1, Firebase, un stockage objet privé et un connecteur Windows facultatif. Il comprend un travail important sur les médias dans le navigateur : chronologie, recadrage, composition du texte, enveloppes audio, rendu image par image, annulation des exports et contrôle des fichiers.

La préservation des moteurs graphiques guide l’architecture. Des adaptateurs versionnés et des empreintes vérifiées permettent de faire évoluer le studio sans modifier silencieusement les moteurs d’origine. Les références locales distinguent aussi l’utilisation d’un fichier de son partage dans le cloud.

### Preuves et enseignements

Le build natif vérifié réussit. Le dépôt présente de vraies captures et un état daté des tests réussis et en échec. Les réserves portent notamment sur des non-régressions à corriger, les ressources conservées séparément, le support des codecs selon le navigateur et un ancien profil de build qui ne correspond plus aux fonctionnalités actuelles.

Ce projet illustre une réalisation de produit métier ; il ne revendique pas de certification de diffusion. Aucun gain de temps, volume d’utilisateurs ou résultat commercial non documenté n’est annoncé.

**Texte court pour le portfolio :**

> J’ai créé SRTB Graphics, un espace web pour préparer les habillages télévisés, organiser la production et exporter les livrables audiovisuels. Le projet associe React et TypeScript, le traitement multimédia dans le navigateur, un backend avec gestion des droits et des outils pour les médias locaux. Il réunit mon travail sur l’interface, l’architecture applicative et les usages de la production télévisuelle.
