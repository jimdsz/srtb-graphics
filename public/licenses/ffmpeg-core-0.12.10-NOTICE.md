# FFmpeg CBR local — avis de composant

Ce dossier isole le moteur WebAssembly utilisé uniquement comme repli local de l’export MP4 lorsque le flux H.264 produit par WebCodecs mesure moins de 30 Mb/s.

- Paquet binaire : `@ffmpeg/core` 0.12.10, variante mono-thread.
- Licence déclarée par le paquet : `GPL-2.0-or-later`.
- Codecs utilisés : FFmpeg et libx264 (`libx264` active le régime GPL du binaire).
- Projet amont : <https://github.com/ffmpegwasm/ffmpeg.wasm>
- Recette amont candidate : tag [`v12.15`](https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15), commit `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`, annonçant les cores 0.12.10. Ce rapprochement n’est pas une attestation complète des sources ayant produit le binaire.
- FFmpeg : <https://ffmpeg.org/>
- x264 : <https://code.videolan.org/videolan/x264>
- Texte GPL v2 : <https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>
- Copie locale du texte : `LICENSE.GPL-2.0-or-later.txt` (également livrée dans `public/licenses`).

Empreintes du binaire qualifié :

- `ffmpeg-core.js` SHA-256 : `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3`
- `ffmpeg-core.wasm` SHA-256 : `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`

Le worker applicatif communique avec ce composant par messages et ne lui transmet que des segments MP4 temporaires générés localement. Le périmètre autorisé pour la distribution libre couvre l’encodeur et l’intégration concernée, pas l’application entière. Les archives de sources à préparer doivent exclure les médias, les polices SRTB, les secrets, le code serveur et les données utilisateurs.

## Blocage de publication

Cet avis et l’archive npm ne constituent pas à eux seuls une validation juridique ni le « Corresponding Source » complet. Avant toute publication, joindre le code source exact du build FFmpeg et de toutes ses bibliothèques incluses, bindings et scripts/dépendances, ainsi que les sources de l’intégration autorisée, avec les mentions et textes de licence requis. L’accord de distribution libre a été donné ; il ne dispense pas de compléter et vérifier ce dossier et son mode de distribution. Le marqueur `RELEASE_BLOCKED.md` reste en place tant que ces conditions ne sont pas satisfaites. Aucune licence de l’application entière n’est présumée par cet avis.
