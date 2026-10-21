# A/B local : masque V contre polygone exact

Ouvrir `http://127.0.0.1:5192/tests/ae-logo-mask-ab.html`, puis **Comparer A / B et conserver les preuves**. Ce banc ne démarre ni ne modifie le serveur. Sur cette origine exacte seulement, l'endpoint existant conserve un JSON et trois PNG dans `reports/video-browser/ae-logo-mask-ab-<timestamp>*`. Aucun téléchargement automatique dans un dossier utilisateur.

## Variable unique

La scène complète BA courante est chargée une seule fois, avec le transport natif `goToTime(71.2)` : image source 1780, sortie 38, BÉNIN et T/V 10. Les médias sont la même image opaque locale, recouverte par le fond natif de sortie vérifié. Aucun changement de durée, de géométrie source, de placement ou de code produit.

- A : le chemin V courant, avec son masque de soustraction BA.
- B : le polygone provenant du `repairAEMergePaths` figé, évalué à l'image 10 par une petite instance du **même Lottie BA** à partir d'une copie JSON brute fraîche. Seuls le `d` et le `mask` du chemin V de la scène A sont remplacés.
- A2 : restauration exacte des deux attributs. L'image entière A2 doit être strictement identique RGBA à A ; autrement le rapport est `inconclusive-control`.

Le banc contrôle les tangentes absolues Float32 évaluées, la première clé tenue à 11 utilisée à l'image 10, la translation de groupe `y=-103.117` et la couverture complète du rectangle soustrait. Le bord calculé par la fonction figée est `834.097 - 788.547 / 2` (439,8235 en décimal ; sa représentation JS exacte est 439.82349999999997). Aucun arrondi ni tolérance supplémentaire n'est ajouté.

Avant et après chaque capture, l'horloge reste arrêtée à la pose native, les placements/matrices restent identiques, et tout le DOM de la scène est comparé en n'exemptant que ces deux attributs du seul V actif. La même sérialisation doit d'abord reproduire exactement le chemin A existant. Cela évite notamment de recopier un chemin SVG ayant déjà incorporé la translation du groupe.

Le premier passage a révélé une seule différence entre les métadonnées du transform brut et rendu : Lottie ajoute `_render: true`. Un test exécute la fonction réelle `SVGShapeElement.searchShapes` du moteur figé et reproduit exactement cet ajout. Seule cette normalisation précise est acceptée et consignée ; `_render: false`, toute autre propriété ou tout décalage restent bloquants. Les JSON d'arrêt ne sont que des diagnostics : sans les trois captures, `localEvidence.complete` et `comparisonCaptured` restent faux.

## Référence et interprétation

Le PNG indépendant reste `BroadcastTemplates/EXPORT/BTV_BA_1P/reference_aftereffects/frame_01780.png`, SHA-256 `ba7bfb02f507a2c9026ef6ade4cf6744cd6a9bfe568cad37021b0a3fbe54a76c`, intégré **uniquement** au bundle local de test. Le build et le navigateur vérifient également les empreintes du moteur BA courant, du compositeur BA, du JSON brut, du moteur Lottie BA et de la fonction figée de réparation.

Pour les deux régions historiques — logo complet (690,460,555,155) et T/V (1100,460,150,155) — le JSON mesure AE/A, AE/B et A/B. Le bord droit du dernier N est compris dans la région historique T/V. Toutes les valeurs sont descriptives : `acceptanceCriterion: null`. Une diminution d'erreur à cette pose ne suffit pas, à elle seule, à autoriser une modification du produit ou à certifier d'autres poses/templates. Le **FAIL 68/64 du banc isolé reste FAIL**.

## Commandes ciblées

```powershell
node --import tsx --test tests/ae-logo-mask-ab.test.ts
node tests/ae-logo-mask-ab-build.mjs
node --check tests/ae-logo-mask-ab.bundle.js
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --skipLibCheck --types vite/client,node --allowImportingTsExtensions --resolveJsonModule tests/ae-logo-mask-ab.ts tests/ae-logo-mask-ab.test.ts
```

Le banc précédent `ae-logo-reference-*`, la bibliothèque figée et les entrées de publication ne sont pas modifiés.
