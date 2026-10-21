# Connecteur Graphics — prototype local 0.1.0

État : noyau et raccordement « À faire » développés ; paquet **Windows x64 de pilote interne** construit, non signé, téléchargeable après connexion SRTB depuis la recherche des médias. Un compte développeur n’est pas nécessaire pour ce pilote. La distribution générale et la qualification de tous les postes restent distinctes. Si Windows bloque le paquet, ne pas contourner ses protections. Pour Mac, le parcours par dossiers dans le navigateur est retenu à la place d’un installateur Apple pour le moment. Livraison et limites : `reports/connector-guided-pilot-2026-09-28.md`.

## Choix Windows / Mac — 28 septembre 2026

**Windows :** `connector/windows/build.mjs` produit un installateur autonome de qualification avec Node officiel inclus. Installation par utilisateur, sans droits administrateur, service, démarrage automatique ou changement de pare-feu. Une icône près de l’horloge ouvre les autorisations et permet l’arrêt. Les paquets sont créés dans un nouveau dossier `.qa-delivery/connector-windows-*` ; ils ne remplacent pas un livrable existant. L’installateur refuse un dossier préexistant et les jonctions ; la désinstallation ne vise qu’une liste explicite de fichiers et conserve les médias, index et autorisations. Ce n’est pas encore un mécanisme de mise à jour.

Le runtime est épinglé à Node 24.21.0 x64 ; l’archive et `node.exe` sont comparés aux SHA-256 officiels. Le lanceur vérifie les fichiers embarqués avant de démarrer. Cette vérification d’intégrité ne remplace **pas** une signature de l’installateur/lanceur ni une qualification antivirus. Le runtime officiel est signé OpenJS ; le lanceur et l’installateur SRTB ne le sont pas encore. Ne jamais demander aux utilisateurs de désactiver SmartScreen ou Defender.

Construction sur Windows avec les dépendances officielles préalablement vérifiées dans `.tools/connector-packaging` :

```
node connector/windows/build.mjs
node connector/windows/qualify.mjs <chemin-absolu-du-payload-généré>
node --test connector/connector.test.mjs connector/desktop.test.mjs
```

La qualification utilise une copie synthétique dans `.qa-delivery`, sans installation, navigateur, inscription au registre ou parcours des disques utilisateur. Elle vérifie l’intégrité, le refus d’un fichier modifié, le démarrage du moteur embarqué sans emplacement autorisé et son arrêt à la fermeture du canal parent. Elle ne valide pas l’interface native d’installation/désinstallation, les mises à jour ou Windows ARM64.

Le test **distinct et mutatif** `connector/windows/qualify-install.ps1 -Installer <chemin-absolu>` exige l’autorisation d’installer puis désinstaller sur le poste. Il refuse toute installation/raccourci préexistant et vérifie l’empreinte du paquet ; il contrôle l’installation silencieuse, l’intégrité installée, le refus de réinstallation et de désinstallation d’un runtime verrouillé, puis retire uniquement le programme de test. Il ne modifie pas les protections Windows. Ne pas confondre cette recette silencieuse avec une validation de l’interface interactive ou du parcours HTTPS complet. Résultat du 28 septembre : 6 contrôles réussis, programme/raccourci/registre de test retirés ; voir `reports/connector-windows-mac-2026-09-28.md`.

**Mac, sans compte Apple :** « À faire » → « Retrouver les médias » → « Ajouter un dossier local ou réseau ». Connecter d’abord le partage réseau dans Finder puis sélectionner les dossiers accessibles. Chrome/Edge proposent l’autorisation de lecture et la mémorisation selon les possibilités du navigateur. Safari utilise le choix d’un dossier pour la session : après rechargement, il faut le sélectionner de nouveau. Graphics ne copie pas les fichiers dans son stockage persistant ; le partage des noms/chemins relatifs de l’index reste une action explicite distincte.

Ce parcours est déjà présent dans Graphics ; il ne donne pas accès à tous les disques ni une surveillance en arrière-plan et ne remplace pas entièrement le connecteur. Limites du parcours navigateur : 1 000 médias / 10 000 entrées / profondeur 12 par analyse, avec résultat partiel signalé. Chaque poste doit accorder son propre accès, même lorsque les métadonnées d’index sont partagées. Safari physique et le réseau SRTB restent à qualifier ; pas de prétention de validation Mac sur la seule base des tests automatisés.

## Parcours utilisateur prévu

Sur Windows, ouvrir le paquet pilote fourni : choisir un dossier, indexer ses médias, puis cliquer sur « Ouvrir Graphics et connecter ces dossiers ». Le site demande confirmation avant de contacter le connecteur et ouvre « À faire ». Le code à usage unique passe dans le fragment de navigation, immédiatement effacé avant la connexion au compte ; la capacité propriétaire ne quitte jamais la page locale. La saisie manuelle du code reste uniquement un secours pour un autre navigateur. Dans « À faire » → recherche des médias, « Connecteur déjà ouvert sur ce poste » reste utilisable même si les téléchargements ne sont pas encore publiés. Le choix de dossiers directement dans le navigateur reste disponible.

Le sélecteur natif est annulable et limité à deux minutes ; une réponse tardive après annulation ne crée pas d’accès. Les autres commandes ne sont plus bloquées pendant le choix. L’indexation conserve son ancien résultat si elle est interrompue ; la fermeture du fichier temporaire est attendue avant son retrait.

Le programme ne s’installe pas et ne démarre pas en arrière-plan de sa propre initiative. Aucun démarrage automatique configuré. Le connecteur conserve les emplacements sur le poste ; chaque navigateur doit être associé explicitement. Les permissions ne sont jamais partagées entre postes.

## Développement

Node.js 22.12+ (Windows ou macOS), modules intégrés uniquement :

```
node connector/main.mjs --data-dir <dossier-de-test-absolu>
node --test connector/connector.test.mjs
```

Ouvrir le programme affiche sa console locale dans le navigateur. Utiliser « Arrêter le connecteur » dans cette console, ou Ctrl+C : les sessions et lectures sont révoquées, les emplacements restent mémorisés. Fermer seulement l'onglet ne quitte pas le processus. `--no-open` évite d’ouvrir la page (tests). Ne pas lancer sur un poste de production à titre de service tant que la distribution n’est pas qualifiée. Le dossier de métadonnées par défaut est propre au compte système.

Le banc `node connector/ui-smoke.mjs --live-client` est réservé au développement : il crée son propre dossier temporaire et remplace le sélecteur natif. Il n'autorise que l'origine HTTP locale du banc sur le port 5192 ; `--production-ui` ajoute explicitement l'origine HTTPS Graphics pour les seuls médias fictifs. `--trace-requests` journalise méthode, chemin d'API, origine et statut, jamais jeton ni contenu. Il affiche exceptionnellement une capacité de contrôle éphémère de test ; le véritable point d'entrée ne la journalise pas. `tests/connector-live-qualification.html` vérifie recherche, lecture partielle et vidéo générée via l'API réelle. Cela ne qualifie ni le sélecteur natif, ni Safari, ni les installateurs.

## Garde-fous

- Écoute exclusivement sur `127.0.0.1:43871` ; aucune ouverture sur le LAN.
- Contrôle du Host, de l’origine et d’une association à code unique valable cinq minutes. Jetons de lecture aléatoires éphémères ; rien dans les paramètres enregistrés des projets.
- Le site ne peut ni autoriser un chemin arbitraire ni lancer une commande système. Le sélecteur appartient à la console locale, protégée par une capacité distincte.
- Lectures limitées aux emplacements choisis et aux extensions média ; exclusions, liens symboliques/jonctions ignorés ; identité du fichier revérifiée avant ouverture. Ceci n’est pas une protection contre un administrateur local malveillant capable de remplacer fichiers ou processus.
- Index de noms en métadonnées locales ; lecture complète par flux uniquement lors de la vérification du média choisi. Le rendu lit ensuite les plages d’octets nécessaires.
- Une indexation à la fois, deux vérifications de médias maximum, arrêt possible, délais d’attente pour réseau absent. Limites : 32 racines, 250 000 entrées par racine, profondeur64, fichier64Go. Une limite atteinte est signalée : pas de promesse d’index exhaustif.
- Retirer un emplacement, modifier ses exclusions ou déconnecter révoque les lectures. Les anciens index locaux ne constituent plus une permission. Ils restent sur le poste pour récupération/support ; la désinstallation de validation ne les supprime pas. Le retrait des autorisations s’effectue depuis la console avant désinstallation.
- Aucun client cloud dans le connecteur. Le partage facultatif par Graphics ne concerne que les références des fichiers explicitement reliés (nom, chemin relatif, taille, date), pas le contenu, le chemin absolu ou les autorisations.

## Qualification restant obligatoire avant distribution

1. Qualifier le paquet Windows x64 exact avec son runtime officiel vérifié et ses notices. Une signature d’éditeur est la voie prévue pour une distribution générale ; elle n'est pas imposée comme achat préalable au pilote interne non signé. Windows ARM64 et un éventuel connecteur natif Mac sont hors du premier lot. Le parcours Mac par navigateur n’a pas besoin de signature Apple. Aucun contournement des protections système.
2. Installer/désinstaller puis relancer sur les OS physiques ; vérifier picker, cancellation, arrêt, instances multiples, espace disque, droits limités et antivirus.
3. HTTPS Graphics → boucle locale : Chrome/Edge et Safari réels, permission réseau local et blocages mixed-content. Ne pas prétendre que Safari fonctionne sur la base de Chromium. Ne pas proposer de contournement de sécurité ; choix manuel si indisponible.
4. Gros fichiers réseau, interruptions SMB, reconnexion, dossiers de nombreux programmes, index volumineux, puis image/son/seek/export avec médias réellement reconnectés.
5. Vérifier sorties réseau et absence de jetons dans projets, journaux et index d’équipe ; confrontation de deux utilisateurs/postes et expiration des sessions.
6. La distribution générale suivra ces contrôles. La version interne Windows est maintenant proposée avec son empreinte, une mention non signée et un accès authentifié. Le manifeste `connector/windows/release.json` désigne le paquet exact ; la construction refuse des octets différents. Aucun paquet Mac ni Windows ARM64 n'est proposé.

Tests automatisés actuels : voir `connector/connector.test.mjs` et `tests/connector-integration.test.ts`. Ils couvrent des fixtures synthétiques, pas vos disques réseau ni Safari.
