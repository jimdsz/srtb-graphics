# Architecture

## English

| Boundary | Main code | Responsibility |
| --- | --- | --- |
| Application shell | `src/studio/Suite.tsx`, `Studio.tsx` | Tool navigation, channel and session context |
| Production | `src/studio/DayPlanner.tsx`, `ProductionOverview.tsx` | Conductors, preparation, tasks and programme resources |
| Editing | `src/studio/Workspace.tsx`, `Preview.tsx`, `Fields.tsx` | Composition, preview and project changes |
| Rendering | `src/studio/video/`, `commercial/` | Media clocks, audio, frame rendering and encoding |
| API | `server/router.ts`, `pages-worker.ts` | Authenticated request routing |
| Identity and permissions | `server/auth.ts`, `firebase-auth.ts`, `tool-access.ts` | Session, active membership, tool and project access |
| Persistence | `server/projects.ts`, `day-planner.ts`, `migrations/` | Revisions and shared production data |
| Media | `src/studio/local-media.ts`, `server/storage.ts`, `connector/` | Local references, optional uploads and local connector |
| Delivery | `scripts/build-studio-native.mjs`, release checks | Build profile, resource inventory and publication guards |

The client owns the interactive preview and media computation. The server remains responsible for authorization and shared state. Local media references do not imply an upload. Original graphic engines are held separately and consumed through versioned adapters; generated runtime JSON modules are included as source dependencies.

The production build uses an explicit native profile with linked variations enabled. Database migrations and release checks are part of that profile; a successful frontend bundle alone is insufficient to release the application.

## Français

Le client porte l’interface, la prévisualisation et les calculs multimédias. Le serveur contrôle les autorisations et les données partagées. Les références aux fichiers locaux ne constituent pas un téléversement. Les moteurs graphiques originaux restent dans un lot séparé et sont utilisés par des adaptateurs versionnés ; les modules JSON de runtime générés sont inclus parmi les dépendances du code.

Le tableau ci-dessus indique les principaux points d’entrée : portail, production, édition, rendu, API, droits, persistance, médias et livraison. Le build actuel utilise le profil natif avec les déclinaisons liées. Les migrations et contrôles de publication font partie de ce profil : construire le frontend ne suffit pas à autoriser une mise en production.
