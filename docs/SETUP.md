# Development / Développement

[English presentation](../README.md) · [Présentation française](../README.fr.md)

## English

### Portable source checks

Use Node.js 24 LTS. Install the versions in `package-lock.json` with `npm ci`, then run:

```sh
npm run typecheck
npm run test:portable
```

These checks exercise the public source without production access. `test:portable` is an explicit selection of tests for session state, media trimming, matching and fingerprints, image sizing, form exit guards, conductor import and hashed asset history. It is not the complete application test suite.

### Full local studio

The original installation uses resources intentionally absent from this public source snapshot. Restore the **authorised asset pack** to the same paths:

- `public/library/v1.7.0/`: frozen template engines and their assets.
- `public/fonts/`: licensed BeninSemiBold and SuisseIntl fonts.
- `public/templates/`, `thumbnails/`, `social/`, `commercial-assets/` and `preview-media/`: templates and media used by the application.
- `public/studio-engines/`: pinned historical adapters, including the preserved `ba-text-v1` files. These cannot be replaced by arbitrary regenerated files.
- `public/licenses/`: corresponding third-party source archives required by release checks.
- `public/downloads/`: the internally qualified connector installer matching `connector/windows/release.json`, if performing the complete release build.

The historical software fallback additionally needs the qualified compressed FFmpeg WebAssembly core. It is not needed to describe or inspect the application, and has its own release block documented under `vendor/ffmpeg-core-0.12.10/`.

After restoring the assets:

```sh
npm run dev:qa
```

Open `http://127.0.0.1:5192/`. This configuration uses an isolated local database and a temporary test identity. It must stay on loopback and must never be deployed. Some media qualification scripts also expect the original sibling `BroadcastTemplates/` directory; see the individual script before running it.

`npm run dev:studio` starts the frontend only; it does not provide the authentication and application API by itself.

### Verification and build with the full asset pack

```sh
npm test
npm run test:studio
npm run build:studio:native:derivations
```

The last command is the verified current build profile. It creates `dist-studio-native/` and does **not** deploy it. The historical `build:studio` profile fails a feature-continuity guard in the reviewed snapshot; do not disable that guard to ship a build.

The included Wrangler configuration uses placeholder identifiers. Configure your own Firebase project, D1 database and private media storage separately. Set secrets through the provider's secret mechanism, not in committed files. `APP_ENV=production` remains the fail-closed default for deployment configuration. The example seed administrator uses `admin@example.com`.

The full source test suites have known failures listed in [VERIFICATION.md](VERIFICATION.md). Browser media support and performance require testing on the actual target workstations.

## Français

### Contrôles portables

Utiliser Node.js 24 LTS, puis `npm ci`, `npm run typecheck` et `npm run test:portable`. Ce dernier script vérifie un ensemble explicite de modules sans accès à la production : session, médias, empreintes, dimensions, protection des formulaires, import du conducteur et conservation des ressources versionnées. Il ne remplace pas la suite complète.

### Studio complet

Restaurer le **lot de ressources autorisées** dans les chemins listés ci-dessus. Il comprend les moteurs et ressources de `public/library/v1.7.0/`, les polices sous licence, les modèles, vignettes, médias, adaptateurs historiques et archives de sources tierces. Le build complet attend aussi l’installateur interne conforme au manifeste du connecteur. Ces fichiers ne sont pas distribués par ce dépôt.

Lancer ensuite `npm run dev:qa` et ouvrir `http://127.0.0.1:5192/`. Ce banc utilise une base locale isolée et un compte temporaire ; il doit rester sur l’interface locale et ne doit jamais être déployé. Certains scripts attendent aussi le dossier frère `BroadcastTemplates/` d’origine. `dev:studio` lance uniquement le frontend, sans fournir à lui seul l’API ni l’authentification.

Le profil actuel vérifié est `npm run build:studio:native:derivations`. Il produit `dist-studio-native/` sans publication. L’ancien `build:studio` échoue sur un contrôle de continuité des fonctionnalités ; ne pas contourner ce contrôle.

Les configurations publiques utilisent des identifiants de remplacement. Configurer séparément Firebase, D1 et le stockage privé ; conserver les secrets hors des fichiers suivis. Les configurations de déploiement restent en mode fermé par défaut (`APP_ENV=production`). Le compte initial d’exemple est `admin@example.com`.

Le dépôt Git ne remplace pas une sauvegarde des ressources privées, de la base D1 ou des médias partagés. Les échecs connus et les limites de la vérification sont détaillés dans [VERIFICATION.md](VERIFICATION.md).
