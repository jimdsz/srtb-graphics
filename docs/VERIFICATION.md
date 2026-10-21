# Verification record / Compte rendu de vérification

**21 October 2026 / 21 octobre 2026** · Windows · Node.js 24.19.0

## Results / Résultats

| Check / Contrôle | Result / Résultat | Scope / Périmètre |
| --- | --- | --- |
| Current native build | PASS | Complete local installation: `build:studio:native:derivations`, including the Worker |
| TypeScript | PASS | Frontend and backend, including the sanitised public copy |
| Portable tests | 34 passed, 2 skipped, 0 failed | Public source; two tests require an optional real conductor file |
| Full Node suite | 1,716 passed, 12 failed, 3 skipped | Complete local source, 1,731 checks reported |
| Cloudflare integration | 420 passed, 11 failed | 34 test files; local isolated D1/storage emulation |
| Asset-history regression | 2 passed | Hashed PDF modules retained; collisions and unsafe filenames rejected |
| Interface smoke check | PASS | Portal → catalogue → local project creation → rename → save |

The full suites were run outside the restricted terminal sandbox after the first attempts exposed OS/runtime restrictions. No production database was used, and no application deployment was performed.

Les suites complètes ont été relancées hors du terminal restreint après identification de limitations système du premier lancement. Aucune base de production n’a été utilisée et aucun déploiement de l’application n’a été effectué.

## Corrected defect / Défaut corrigé

`scripts/studio-asset-history.mjs` accepted hashed JavaScript files ending in `.js` but rejected the generated PDF worker ending in `.mjs`. A second build could fail while preserving the previous assets. The extension allowlist now accepts both forms while retaining filename, regular-file and collision checks.

Le filtre de conservation des ressources refusait le worker PDF `.mjs` généré, ce qui bloquait la reconstruction. La correction conserve les protections existantes. Les deux tests ajoutés dans `tests/studio-asset-history.test.ts` contrôlent la conservation, l’idempotence, les collisions et le refus des fichiers non versionnés, HTML et sourcemaps.

## Outstanding failures / Échecs restant à traiter

These failures were observed, not silently disabled or relabelled as successes. Some tests inspect source strings or old fixture expectations; others exercise rendering and session behaviour. This review does not establish that every failure has the same cause.

Ces échecs n’ont pas été désactivés ni présentés comme des réussites. Certains tests portent sur des chaînes de code ou des attentes de fixtures anciennes ; d’autres concernent le rendu et les sessions. Leur cause doit être étudiée individuellement.

| Files / Fichiers | Observation |
| --- | --- |
| `tests/ae-out-artifacts.test.ts` | Native asset-copy fixture fails / fixture de copie des ressources en échec |
| `tests/delivery-workbench.test.ts` | Source-level export guard assertion fails / assertion sur la structure du garde d’export |
| `tests/derivations-release-gate.test.ts` | OFF profile still contains derivation table references / références de tables présentes dans le profil désactivé |
| Social playlist and historical layout tests | Timing/position expectations differ / écarts sur les horloges et positions historiques |
| Renvoi and Semainier styled-text tests | Opacity/reveal expectations differ / écarts d’opacité et d’apparition des textes |
| Supplemental voice test | Extension expectation differs / attente sur les extensions vocales |
| `tests/voice-timing-measurement.test.ts`, `voice-timing-ui.test.ts` | Node runner cannot import a CSS dependency / import CSS non géré par ce banc Node |
| `tests/studio/core.test.ts` | Expected schema count 377, observed 418 / nombre de champs attendu différent |
| `tests/studio/derivation-worker-session.test.ts` | Nine integration scenarios fail, including session/capability cases / neuf scénarios de session et de compatibilité en échec |
| `tests/studio/preparation-profiles.test.ts` | Fixture data expectation differs / attente sur les données de préparation |

The historical `build:studio` command still fails its OFF-profile derivation guard after the PDF module fix. The current `build:studio:native:derivations` profile passes. Release guards were not relaxed to hide this difference.

L’ancien `build:studio` reste bloqué par le contrôle des déclinaisons désactivées. Le profil actuel `build:studio:native:derivations` réussit ; ses garde-fous n’ont pas été contournés.

## Visual and interaction evidence / Preuves visuelles

The actual application was opened at `http://127.0.0.1:5237/` using the isolated qualification configuration. The portal and catalogue rendered without a blank page or framework overlay. Navigation, project creation and saving a renamed project were exercised. Screenshots use a temporary qualification account. Console checks found no application errors in the exercised flow.

Le portail et le catalogue ont été contrôlés sur le banc local isolé, sans page blanche ni écran d’erreur du framework. La navigation, la création d’un projet et l’enregistrement de son nouveau nom ont été exercés. Les captures utilisent le compte temporaire du banc. Aucune erreur applicative n’a été relevée dans la console sur ce parcours.

![Actual catalogue / Catalogue réel](images/catalogue.png)

Desktop viewport: 1440 × 1000. Mobile catalogue: 390 × 844, with no horizontal overflow observed. The small-screen menu and model selector remain visible.

Vue bureau : 1440 × 1000. Catalogue mobile : 390 × 844, sans débordement horizontal constaté ; le menu et le choix du modèle restent visibles.

## Limits / Limites

- The full export/codec/browser matrix, all roles, real network disks and long sessions were not repeated in this review.
- Local data and shared production media are not backed up by this Git repository.
- Public CI covers the portable source checks only; it does not certify the full application.
- The original graphic asset pack is required for complete UI, rendering and build reproduction.

La revue ne renouvelle pas la qualification complète de chaque codec, rôle, navigateur, disque réseau ou session longue. La CI publique ne couvre que les contrôles portables. Une recette complète nécessite les ressources originales et les postes cibles.
