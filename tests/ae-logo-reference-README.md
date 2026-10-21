# Comparaison locale du logo BA avec After Effects

Le banc compare le logo complet du moteur courant `ba-text-v2` à l'image After Effects `BroadcastTemplates/EXPORT/BTV_BA_1P/reference_aftereffects/frame_01780.png`. Son SHA-256 est épinglé ; il ne s'agit pas d'un rendu issu de l'adaptateur BA utilisé comme témoin.

Construire le banc depuis SRTBGraphics :

```powershell
node tests/ae-logo-reference-build.mjs
node --import tsx --test tests/ae-logo-reference.test.ts
```

Sur un serveur local existant qui sert `tests/`, `library/` et `studio-engines/`, ouvrir `/tests/ae-logo-reference.html`. Par exemple : `http://127.0.0.1:5196/tests/ae-logo-reference.html` avec le serveur de diagnostic existant, ou le même chemin sur le serveur de recette 5192. Ce banc ne démarre ni ne modifie aucun serveur. Il refuse une origine qui ne soit pas locale.

La construction lit le PNG autorisé hors du projet et l'intègre seulement dans `tests/ae-logo-reference.bundle.js`. Aucun fichier n'est ajouté à `public/`, aucun point d'entrée de l'application ne l'importe, aucune configuration de publication n'est modifiée. Ne pas copier ce bundle dans les livrables publiés. Les empreintes des modules et du JSON source sont enregistrées à la construction puis comparées aux ressources réellement servies avant la mesure ; reconstruire le banc après changement de ces fichiers.

Le bouton appelle le `goToTime` natif du moteur à 71,20 s, avec la configuration d'origine. Il vérifie la concordance de la réponse d'inspection, du statut, de l'animation et du rendu sur l'image source 1780. Il vérifie également la sortie à l'image locale 38 et BÉNIN/T/V à l'image locale 10. La chaîne de placements est comparée au JSON natif ; les cinq lettres BÉNIN restent présentes. Aucune modification de parent, d'échelle, de géométrie ou de remappage temporel n'est appliquée par le banc.

Le constructeur Lottie figé `KeyframedMultidimensionalProperty` remplace les deux tangentes spatiales `[0,0,0]` par `null` sur les positions rectilignes de V (index 4), T 4 (5) et T 2 (7). Le test exécute ce constructeur réel, extrait du module figé, pour prouver la mutation. Le garde-fou accepte uniquement cette paire de normalisations exacte sur la première clé de ces trois calques et la consigne dans `rendererNormalizations`. Il continue à refuser les tangentes non nulles, supprimées ou modifiées seules, les déplacements, les échelles et les changements de temps. Toute autre divergence affiche son chemin, sa valeur source et sa valeur observée dans `placementDifferences`. Aucun seuil numérique n'est ajouté.

Pour ne pas charger les vidéos d'exemple, les trois médias sont des images opaques locales, suivant la fixture existante de `overlay-logo-qualification`. Le banc vérifie le fond de sortie opaque 1920 × 1080 déjà installé par le moteur sous le logo à cette pose ; il recouvre ces médias. L'audio est désactivé. Le rendu utilise le `FrameRaster` actuel, à la taille native et avec des bitmaps exacts, sans fond ajouté.

Les mesures portent exclusivement sur `[690,460,555,155]` (logo BÉNIN TV complet) et `[1100,460,150,155]` (T/V), sous la forme x, y, largeur, hauteur. Elles donnent les différences RGB, alpha et RGBA prémultipliées, leurs maxima, les nombres de pixels différents et l'histogramme du delta RGB maximal. Le compteur `pixelsRgbOver16` reprend uniquement la mesure descriptive historique ; ce n'est pas un seuil d'acceptation.

Le rapport indique `status: measured` et `acceptanceCriterion: null`, jamais un PASS de fidélité. Les deux régions apparaissent en triptyques AE / moteur actuel / différence RGB amplifiée ×4.

Uniquement lorsque l'origine vaut exactement `http://127.0.0.1:5192`, le bouton enregistre le PNG candidat puis le JSON par POST sur l'endpoint local existant `/__video-evidence/ae-logo-reference-<timestamp>.png` et `.json`. Les deux fichiers portent le même horodatage ; le JSON contient leurs noms et le SHA-256 du PNG. Le serveur existant les conserve dans `reports/video-browser/`. En cas d'échec d'enregistrement, les mesures restent affichées avec l'erreur et l'état du PNG. Aucun projet n'est modifié et aucun fichier de référence AE n'est envoyé à un serveur distant. Le banc ne modifie pas le serveur.

Sur les autres origines locales, aucune requête d'enregistrement n'est envoyée. Les liens de téléchargement JSON/PNG restent disponibles sur tous les serveurs locaux ; aucun téléchargement vers les dossiers utilisateur n'est lancé automatiquement.

Ce contrôle d'une pose ne certifie pas les transitions, les autres modèles, Safari, ni le rendu physique d'un écran. Le cadre complet comprend des adaptations actuelles de texte et de sortie ; seules les régions annoncées sont mesurées. Une comparaison de PNG peut aussi inclure des différences d'anticrénelage ou de gestion des couleurs du navigateur : les écarts sont décrits, sans modifier les seuils existants.
