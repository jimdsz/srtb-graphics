# Nouveau cœur CBR minimal — recette locale, non qualifiée

Cette recette construit un **nouveau** cœur Emscripten mono-thread à partir de sources choisies et épinglées. Elle n'établit pas la provenance du binaire npm `@ffmpeg/core@0.12.10` installé. Aucun artefact n'est copié vers `vendor`, `public`, un build applicatif ou un hébergeur. `RELEASE_BLOCKED.md` reste présent.

## Commandes exécutables maintenant sous Windows

Depuis `C:\Users\SRTB_AD\Documents\ChatGPT\conversion fichiers\SRTBGraphics` :

```powershell
node --test tests/cbr-minimal-recipe.test.mjs
node scripts/prepare-cbr-minimal.mjs --check
node scripts/prepare-cbr-minimal.mjs --stage
```

`--check` vérifie les quatre archives déjà locales : taille, SHA-256, chemins d'archive et présence des notices. Il ne les extrait pas. `--stage` copie les buffers vérifiés et cette recette dans `.tools/cbr-minimal/context`, écrit leurs SHA-256 et **refuse un dossier déjà existant**. Il ne prend aucun fichier applicatif, média, police ou secret. Les archives conservées contiennent leurs notices et sources amont intégrales ; le sous-module amont `testdata` et les sous-modules de tests Emscripten ne participent pas à la recette.

## Chaîne épinglée, encore à transférer

La distribution WSL existante `PlayoutPilotRuntime` est déjà démarrée. Elle expose Docker client/serveur `29.7.2`, mais pas de compilateur Emscripten local. Le 23 septembre 2026, aucune image `emscripten/emsdk` n'y est installée. Aucune image n'a été téléchargée ni exécutée pour ce dossier.

L'image officielle `emscripten/emsdk:3.1.40`, interrogée uniquement pour ses métadonnées dans le registre, est figée à :

```text
emscripten/emsdk@sha256:c1e807a6e03ac5bd5b37bae2ace3c46c08579e2ddeb951037a3b8dac7067f2cc
linux/amd64
config sha256:c1a168efe38b60659e72194a0ac0f70be920d7747d686f891d1d425e3bbc1f4b
```

`sources.lock.json` contient les cinq digests des couches et leurs tailles : **652 159 522 octets comprimés** au total, hors métadonnées. C'est le seul transfert binaire supplémentaire identifié pour essayer cette recette ; ce dossier ne l'effectue pas. L'image contient Ubuntu 22.04, le SDK 3.1.40, Node 15.14.0, Python et les outils GNU nécessaires d'après ses métadonnées. Le SDK est un outil de compilation isolé, pas une dépendance serveur de l'application. La recette vérifie effectivement la version et l'identifiant Git du compilateur à son lancement. Les outils doivent encore être confirmés à l'exécution ; aucun succès de compilation n'est présumé.

Une fois cette image rendue disponible localement et le contexte préparé :

```powershell
wsl -d PlayoutPilotRuntime --exec bash '/mnt/c/Users/SRTB_AD/Documents/ChatGPT/conversion fichiers/SRTBGraphics/.tools/cbr-minimal/context/run-container.sh'
```

Cette commande vérifie le digest local et refuse toute récupération automatique (`--pull=never`). Le conteneur est privé de réseau, sans capacités supplémentaires, avec racine en lecture seule. Il voit uniquement le contexte de sources et `.tools/cbr-minimal/output`, créé exclusivement pour ce build. Son espace de travail et son cache sont temporaires ; aucune installation système ou modification de la distribution WSL n'est prévue. Le plafond de travail temporaire est 6 Gio, avec deux jobs de compilation. Un output existant entraîne un refus : le déplacer/archiver explicitement avant une nouvelle tentative.

## Entrées et configuration retenues

| Entrée | Commit | Rôle |
|---|---|---|
| FFmpeg 5.1.4 | `4729204c17f756e186d622060088371d10b34f7e` | Bibliothèques vidéo/conteneur |
| x264 core 164, fork ffmpegwasm | `33cac6b77d5b9259c552156013a817ab23119612` | Encodeur 8 bits 4:2:0 statique |
| ffmpeg.wasm v12.15 | `71aa99d37c02a7b4c435275ca9ef50e612f6efa1` | Bindings JS et `src/fftools` adaptés |
| Emscripten 3.1.40 | `5c27e79dd0a9c4e27ef2326841698cdd4f6b5784` | Référence des sources runtime/system ; le compilateur effectif provient de l'image épinglée |

Les quatre archives sont déjà présentes dans `.tools/cbr-source-candidates` ; aucune nouvelle archive de bibliothèque multimédia n'est nécessaire. Les trois premières sont extraites uniquement dans le conteneur. L'archive Emscripten est conservée comme référence source, elle n'est pas un SDK exécutable à elle seule.

Le cœur accepte des segments **vidéo H.264/MP4 uniquement**, via `file` sur MEMFS, puis encode en `libx264`/MP4. Le chemin produit emploie déjà `codec: 'avc'` ; un autre codec en entrée serait hors de ce profil minimal. L'audio est recopié par l'intégration Mediabunny existante, sans passer par ce cœur.

Filtres conservés : `null,format,scale,trim,transpose,hflip,vflip,rotate`. Ils couvrent notamment la rotation que `segmentBuffer()` conserve. `buffer` et `buffersink` sont enregistrés inconditionnellement par FFmpeg 5.1.4. Le muxeur MP4 sélectionne quelques composants internes supplémentaires (MOV, helpers RTP, BSF AAC/VP9 et parser AC3) : ce sont les dépendances internes déclarées par FFmpeg, pas de nouvelles bibliothèques externes. La configuration effective sera conservée dans `build-records/config_components.h`.

L'adaptateur `pkg-config-x264.sh` répond seulement aux requêtes x264 nécessaires à `configure` et refuse les autres paquets. Les options retenues désactivent threads et OpenCL ; x264 requiert donc `-lx264 -lm`, sans pthread/dl. L'adaptateur exige les fichiers compilés réels ; FFmpeg effectue ensuite ses vrais tests d'en-têtes et de lien. Cela évite une installation apt flottante ou un paquet supplémentaire non épinglé.

Le lien reprend les `src/fftools` adaptés de ffmpeg.wasm et garde son contrat `exec/reset/setLogger/FS`, ainsi que `ffprobe` conservé par les exports amont. `-sUSE_SDL=2` et `-lworkerfs.js` sont retirés : ce protocole n'en a pas besoin. Aucun téléchargement implicite de port SDL2 n'est autorisé. Les sources amont sont conservées sans patch ; le choix des composants et le lien sont définis ici dans `build.sh`.

## Dossier de sortie et qualification à réaliser

En cas de succès, `output` contiendra JS/WASM et leurs SHA-256. Dans tous les cas, un gestionnaire de sortie conserve le journal, le code de retour, les configurations disponibles, les versions et empreintes des outils, les empreintes des sources runtime Emscripten et du cache de bibliothèques système effectivement disponible. Les journaux `configure` restent donc consultables après un échec et la suppression du conteneur. Les empreintes du nouveau cœur ne devront remplacer celles du candidat précédent **qu'après qualification et intégration explicite**.

La fixture `tests/ffmpeg-cbr.worker.ts` utilise `lavfi/color/testsrc2` et l'ancien cœur : elle ne qualifie pas ce profil minimal. Employer des MP4 AVC de test produits en dehors du nouveau cœur, puis lancer les arguments exacts de `src/studio/video/cbr-fallback.worker.ts` :

```text
-i segment.mp4 -an -c:v libx264 -preset ultrafast
-b:v 50M -minrate 50M -maxrate 50M -bufsize 50M
-x264-params nal-hrd=cbr:filler=1 -pix_fmt yuv420p
-fps_mode passthrough -movflags +faststart -y segment-cbr.mp4
```

À mesurer avant toute substitution : deux encodages successifs et reset ; cas statique et mouvement ; 1920×1080 et dimensions sociales ; 25 i/s, couleur, rotation, nombre d'images ; jonctions de segments, derniers segments courts ; décodage indépendant ; débit moyen et fenêtres vidéo d'une seconde ; audio copié identiquement et synchronisé après remux ; annulation, nettoyage OPFS, mémoire et navigateurs visés. Le remplissage HRD n'améliore pas les détails de l'image. La politique actuelle distingue une cible de 50 Mb/s et un plancher accepté de 30 Mb/s ; aucune recette seule ne prouve le débit réellement mesuré.

## Périmètre des sources à distribuer, encore distinct du build

Le dossier local ne publie aucune source SRTB. L'accord porte sur le composant encodeur et l'intégration concernée. La fermeture directe observée comprend `cbr-fallback.ts`, `cbr-fallback.worker.ts`, `encoding-policy.ts`, `video-bitrate.ts`, `src/ffmpeg-core.d.ts`, les sources/builds du nouveau cœur et Mediabunny **1.58.1**, déclaré **MPL-2.0**. Le contenu exact des dépendances/types, la recette de compilation de cette intégration et ses points d'appel doivent être isolés et documentés avant une distribution. Cela ne constitue ni une permission de publier toute l'application, ni une preuve que cette liste est juridiquement suffisante.

Les [indications officielles FFmpeg](https://ffmpeg.org/legal.html) demandent la correspondance exacte entre les sources et le binaire ; leur checklist LGPL n'est pas une validation de ce build avec `--enable-gpl`/x264. La [FAQ ffmpeg.wasm](https://ffmpegwasm.netlify.app/docs/faq/) distingue le wrapper MIT du cœur qui suit les licences des composants. Les notices x264 et FFmpeg restent dans les archives. [Documentation officielle du SDK et de l'image](https://emscripten.org/docs/getting_started/downloads.html), [compilation de projets Emscripten](https://emscripten.org/docs/compiling/Building-Projects.html). Sources primaires consultées le 23 septembre 2026.

La compilation, la qualification, la complétude des sources de l'intégration et le mode effectif de mise à disposition restent des étapes distinctes. Aucune attestation juridique, correspondance historique npm ou reconstruction bit à bit n'est revendiquée.
