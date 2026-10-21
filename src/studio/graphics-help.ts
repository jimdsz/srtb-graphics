/** Local, explanatory content only. No API or project data belongs in this module. */
export type GraphicsHelpRole = 'admin' | 'designer' | 'broadcaster' | 'commercial';
export type GraphicsHelpPage = 'home' | 'planner' | 'projects' | 'programmes' | 'library' | 'media' | 'validation' | 'admin';
export type GraphicsHelpSection = GraphicsHelpPage | 'channels' | 'connector' | 'editor' | 'audio' | 'montage' | 'crop' | 'export' | 'sharing' | 'text' | 'logos' | 'graphics' | 'timing' | 'derivations' | 'habits';
export type GraphicsHelpTopic = GraphicsHelpSection | 'start';
export type HelpScene = 'overview' | 'programme' | 'episode' | 'team' | 'privacy' | 'local' | 'shared-media' | 'library' | 'editor' | 'audio' | 'crop' | 'review' | 'export' | 'channels' | 'text' | 'logos';
export interface HelpStep {
  title: string;
  body: string;
  cue: string;
  scene: HelpScene;
  labels: readonly [string, string, string];
}
export interface HelpTopic {
  id: GraphicsHelpTopic;
  title: string;
  short: string;
  scope: string;
  destination?: GraphicsHelpPage;
  steps: readonly HelpStep[];
}

const step = (title: string, body: string, cue: string, scene: HelpScene, labels: HelpStep['labels']): HelpStep => ({title, body, cue, scene, labels});

const topics: Record<GraphicsHelpTopic, HelpTopic> = {
  start: {id:'start', title:'Prise en main', short:'Les bons repères, en sept étapes.', scope:'À votre rythme', steps:[
    step('Votre chaîne, votre point de départ', 'La chaîne choisie en haut de l’écran détermine les émissions, les médias et les projets auxquels vous avez accès.', 'Repère : le nom de la chaîne dans l’en-tête.', 'channels', ['Chaîne choisie', 'Ressources de la chaîne', 'Membres autorisés']),
    step('Émission et épisode : deux repères', 'La fiche Émission garde le titre officiel et les habitudes de l’équipe. Le sujet, le média et la date d’un épisode se préparent dans À faire.', 'Une émission peut avoir plusieurs épisodes.', 'episode', ['Fiche Émission', 'Épisode du jour', 'Prochain épisode']),
    step('Préparer la journée ensemble', 'À faire rassemble les lignes du conducteur. Une liste enregistrée pour l’équipe est partagée ; chaque tâche conserve un responsable unique.', 'Une tâche attribuée ne partage pas son projet.', 'team', ['Liste d’équipe', 'Une tâche', 'Un responsable']),
    step('Votre projet commence en privé', 'Un projet privé est accessible à son auteur et aux administrateurs ou diffuseurs autorisés dans la chaîne. Le partage avec les infographistes est un choix explicite.', 'Repère : « Privé · partager » dans le projet.', 'privacy', ['Auteur', 'Admins · diffuseurs', 'Équipe si partagé']),
    step('Retrouver les fichiers sur ce poste', 'Les emplacements du catalogue sont des repères. Chaque poste doit autoriser ses dossiers. Un fichier local n’est pas envoyé par cette connexion.', 'Un média partagé dans Médias est un transfert volontaire distinct.', 'local', ['Disque ou réseau', 'Accès sur ce poste', 'Catalogue : repères']),
    step('Ajuster et vérifier', 'Dans le projet, Réglages organise les textes, les médias et le son. Contrôlez le cadrage et l’aperçu, puis enregistrez vos retouches.', 'Historique retrouve les notes et les révisions.', 'editor', ['Réglages', 'Aperçu', 'Enregistrer']),
    step('Valider et exporter sont distincts', 'L’envoi au diffuseur suit le circuit de validation. Exporter produit un fichier sur ce poste à partir des réglages affichés, sans changer le statut du projet.', 'Le guide n’effectue aucune de ces actions.', 'export', ['Réglages affichés', 'Exporter', 'Fichier sur ce poste']),
  ]},
  home: {id:'home',title:'Accueil',short:'Voir où en est la production.',scope:'Votre chaîne active',destination:'home',steps:[
    step('Lire la journée en un coup d’œil', 'Aujourd’hui regroupe le suivi de production et vos projets récents. Les éléments affichés respectent vos droits d’accès.', 'Commencez par la production qui demande votre attention.', 'overview', ['À préparer', 'À suivre', 'Vos projets']),
    step('Reprendre au bon endroit', 'Une préparation s’ouvre dans À faire. Un projet existant s’ouvre dans son éditeur. Nouveau projet mène à la Bibliothèque.', 'La Bibliothèque permet de choisir un modèle.', 'overview', ['Préparation → À faire', 'Projet → éditeur', 'Modèle → Bibliothèque']),
  ]},
  planner: {id:'planner',title:'À faire',short:'Du conducteur aux tâches de l’équipe.',scope:'Liste partagée après enregistrement',destination:'planner',steps:[
    step('Préparer une journée', 'Importez un conducteur compatible ou reprenez une préparation d’équipe. Vérifiez les dates, titres et horaires reconnus.', 'L’import est lu localement avant confirmation.', 'overview', ['Conducteur', 'Lignes de la journée', 'Habillages demandés']),
    step('Répartir les tâches', 'La préparation enregistrée est commune à la chaîne. Chaque tâche a un seul responsable ; son attribution ne rend pas le projet public à l’équipe.', 'Enregistrer pour l’équipe partage la liste.', 'team', ['Liste commune', 'Tâche attribuée', 'Projet privé']),
    step('Distinguer l’épisode du programme', 'Le champ Épisode / sous-titre décrit cette diffusion. Contrôlez son média et sa date, même si le titre de l’émission est déjà reconnu.', 'Une copie conservée sur ce poste reste locale jusqu’à l’enregistrement pour l’équipe.', 'episode', ['Titre de l’émission', 'Épisode / sous-titre', 'Date et média du jour']),
  ]},
  projects: {id:'projects',title:'Projets',short:'Retrouver et reprendre vos habillages.',scope:'Privés par défaut',destination:'projects',steps:[
    step('Choisir la bonne vue', 'Vos projets et les projets partagés ne sont pas la même liste. Les filtres affichent les projets accessibles dans la chaîne choisie.', 'Un projet absent peut appartenir à une autre chaîne ou rester privé.', 'privacy', ['Vos projets', 'Partagés avec l’équipe', 'Droits de la chaîne']),
    step('Partager en connaissance de cause', 'Privé signifie : auteur, administrateurs et diffuseurs autorisés. Partagé avec l’équipe permet aussi aux infographistes de la chaîne d’ouvrir et de modifier le projet.', 'Le partage concerne ce projet uniquement.', 'privacy', ['Auteur', 'Admins · diffuseurs', 'Infographistes si partagé']),
    step('Reprendre une version', 'Ouvrez le projet, ajustez Réglages et contrôlez l’aperçu. Historique conserve les notes et les révisions précédentes.', 'Une révision reprise doit être enregistrée pour devenir une nouvelle version.', 'editor', ['Projet', 'Réglages', 'Historique']),
  ]},
  programmes: {id:'programmes',title:'Émissions',short:'La mémoire commune d’une émission.',scope:'Fiches partagées par chaîne',destination:'programmes',steps:[
    step('Une fiche pour toute l’émission', 'Le titre officiel, les autres noms et le type d’émission aident l’équipe à reconnaître le même programme dans les conducteurs.', 'Exemple fictif : « Le magazine » reste la fiche de référence.', 'programme', ['Titre officiel', 'Autres noms', 'Habitudes d’équipe']),
    step('Chaque épisode garde ses détails', 'La fiche n’est pas la vidéo d’un épisode. Le sous-titre, la diffusion et le média du jour se règlent dans À faire et dans le projet préparé.', 'Ne créez pas une fiche Émission par date de diffusion.', 'episode', ['Le magazine', 'Épisode : le littoral', 'Épisode : les métiers']),
    step('Retrouver les ressources habituelles', 'Le logo partagé, la voix habituelle et les emplacements donnent des références à la préparation. Un lien d’emplacement n’autorise aucun dossier sur votre poste.', 'Les ressources restent à confirmer lors de la préparation.', 'local', ['Logo ou voix référencés', 'Emplacement du catalogue', 'Accès local à confirmer']),
    step('Enregistrer pour la chaîne', 'Les modifications enregistrées de la fiche sont communes à la chaîne. Les livrables habituels et l’habillage permanent relèvent des administrateurs et diffuseurs.', 'La fiche ne crée aucun projet à elle seule.', 'programme', ['Fiche enregistrée', 'Équipe de la chaîne', 'Futures préparations']),
  ]},
  library: {id:'library',title:'Bibliothèque',short:'Choisir un modèle d’habillage.',scope:'Modèles disponibles dans la chaîne',destination:'library',steps:[
    step('Choisir le résultat souhaité', 'Parcourez les modèles disponibles pour votre chaîne. Leur nom indique le type d’habillage à préparer.', 'Une chaîne sans modèles approuvés peut présenter une bibliothèque vide.', 'library', ['Modèle', 'Aperçu à la demande', 'Projet à personnaliser']),
    step('Regarder avant de commencer', 'L’aperçu se charge à votre demande. La création d’un projet reste une action séparée, que vous confirmez vous-même.', 'Le guide ne lance ni aperçu vidéo ni création.', 'editor', ['Choisir', 'Contrôler', 'Personnaliser']),
  ]},
  media: {id:'media',title:'Médias',short:'Les fichiers volontairement partagés.',scope:'Ressources partagées de la chaîne',destination:'media',steps:[
    step('Local ou partagé ?', 'Dans un projet, Choisir sur cet ordinateur ou le réseau utilise un fichier local. Dans Médias, Partager ce média transfère le fichier après votre consentement.', 'Choisir un fichier dans Médias ne l’envoie pas encore.', 'shared-media', ['Choisir un fichier', 'Confirmer le partage', 'Média de la chaîne']),
    step('Réutiliser une ressource d’équipe', 'Les images, séquences et sons partagés de cette chaîne peuvent être sélectionnés dans les réglages des projets.', 'Les ressources d’une autre chaîne restent séparées.', 'programme', ['Image', 'Séquence', 'Son']),
  ]},
  validation: {id:'validation',title:'À valider',short:'Suivre l’envoi et les corrections.',scope:'Selon votre rôle',destination:'validation',steps:[
    step('Retrouver le bon état', 'En attente, À corriger et Validés séparent les étapes du suivi. Les infographistes retrouvent leurs projets dans Mes envois.', 'Le statut indique la décision de validation, pas la présence d’un export.', 'review', ['En attente', 'À corriger', 'Validés']),
    step('Contrôler avant de décider', 'Les administrateurs et diffuseurs peuvent valider ou demander des corrections. L’auteur consulte les notes dans Historique et soumet sa nouvelle version.', 'Les corrections enregistrées doivent être soumises à nouveau.', 'review', ['Aperçu et notes', 'Corrections', 'Nouvel envoi']),
  ]},
  admin: {id:'admin',title:'Équipe & accès',short:'Gérer les membres et leurs rôles.',scope:'Administration',destination:'admin',steps:[
    step('Un rôle définit les actions', 'L’infographiste prépare les habillages. Le diffuseur contrôle la validation. L’administrateur gère aussi les membres et les accès.', 'Cette page est réservée aux administrateurs.', 'team', ['Infographiste', 'Diffuseur', 'Administrateur']),
    step('Vérifier aussi la chaîne', 'Le rôle et l’accès à une chaîne sont deux repères distincts. Les chaînes séparent leurs ressources et leurs membres autorisés.', 'Un changement d’accès concerne le travail réel de l’équipe.', 'channels', ['Membre', 'Rôle', 'Chaînes autorisées']),
    step('Suspendre ou supprimer ?', 'Pour une pause : Modifier, puis désactiver l’accès. Pour effacer : Supprimer, lire le bilan et confirmer l’adresse. Les contenus du membre sont effacés, même partagés.', 'La suppression est définitive et concerne toutes les chaînes.', 'review', ['Choisir l’action', 'Vérifier le bilan', 'Confirmer']),
  ]},
  channels: {id:'channels',title:'Chaînes',short:'Savoir dans quel espace vous travaillez.',scope:'Ressources séparées par chaîne',steps:[
    step('Choisir votre espace de travail', 'Le sélecteur de chaîne change le contexte des projets, émissions et médias. Vérifiez ce nom si une ressource semble manquer.', 'La recherche suit elle aussi la chaîne choisie.', 'channels', ['Chaîne choisie', 'Ses ressources', 'Ses membres']),
    step('Une nouvelle chaîne se prépare', 'Une chaîne nouvellement créée peut être vide. Ses membres, ses ressources et ses modèles autorisés doivent être configurés.', 'Créer une chaîne ne copie pas automatiquement la bibliothèque d’une autre.', 'library', ['Identité', 'Équipe et ressources', 'Modèles disponibles']),
  ]},
  connector: {id:'connector',title:'Connecteur',short:'Accéder aux dossiers de ce poste.',scope:'Autorisations locales',steps:[
    step('Autoriser les bons dossiers', 'Le connecteur donne accès aux dossiers choisis sur votre ordinateur ou le réseau. Ouvrir Graphics permet ensuite de connecter ce navigateur.', 'Connecter mes dossiers demande une autorisation explicite.', 'local', ['Dossier choisi', 'Connecteur', 'Ce navigateur']),
    step('Reprendre sur un autre poste', 'Le catalogue conserve des correspondances, pas l’autorisation de lire un disque. Sur un autre poste, reconnectez les dossiers et vérifiez le média proposé.', 'Aucune vidéo n’est transférée par le simple catalogue.', 'local', ['Catalogue partagé', 'Nouveau poste', 'Autorisation à refaire']),
  ]},
  editor: {id:'editor',title:'Éditeur',short:'Ajuster, contrôler, enregistrer.',scope:'Le projet ouvert',steps:[
    step('Trouver le bon réglage', 'Réglages regroupe les textes, les médias, le son et le graphisme selon le modèle. L’aperçu permet de contrôler le résultat.', 'Les réglages disponibles dépendent du modèle choisi.', 'editor', ['Textes et médias', 'Aperçu', 'Son et graphisme']),
    step('Enregistrer votre version', 'Le repère Modifications non enregistrées signale les retouches en cours. Enregistrez pour conserver une nouvelle révision du projet.', 'L’Historique réunit les notes et les révisions.', 'editor', ['Retouches', 'Enregistrer', 'Nouvelle révision']),
    step('Choisir la suite', 'Envoyer à la validation, partager avec l’équipe et exporter répondent à trois besoins distincts. Vérifiez le bouton choisi avant de continuer.', 'Ouvrir ce guide ne déclenche aucune action dans le projet.', 'review', ['Validation', 'Partage', 'Export']),
  ]},
  audio: {id:'audio',title:'Son & voix',short:'Vérifier ce que l’on entend et quand.',scope:'Selon les réglages du modèle',steps:[
    step('Choisir la bonne source', 'Dans Son, distinguez la musique d’habillage, le son du média et la voix off. Une voix habituelle de la fiche Émission reste un choix à confirmer.', 'Une référence de voix ne garantit pas son calage.', 'audio', ['Musique', 'Son du média', 'Voix off']),
    step('Utiliser une voix de l’équipe', 'Choisissez une voix, écoutez-la puis utilisez Utiliser et caler cette voix. Sur la BA, le fichier entier est placé à l’introduction et au carton ; ailleurs, le départ reste réglable.', 'Le nom du fichier ne confirme pas son contenu éditorial.', 'audio', ['Écouter la voix', 'Utiliser et caler', 'Contrôler le résultat']),
    step('Contrôler le passage utile', 'Réglez les repères IN / OUT et le volume, puis écoutez l’aperçu. Sur la BA, OUT = 0 est un repère non défini : choisissez les deux repères ou mesurez le fichier entier.', 'Mesurer la durée ne joue aucun son et ne confirme pas le contenu.', 'audio', ['Repère IN', 'Passage utile', 'Repère OUT']),
  ]},
  montage: {id:'montage',title:'Montage',short:'Assembler vos extraits directement dans le modèle.',scope:'Réglages → Médias → Montage',steps:[
    step('Commencer avec votre média', 'Dans Médias, choisissez Créer un montage. Le média actuel et ses points de début et de fin deviennent le premier extrait. Ajouter un extrait permet de choisir un autre fichier local ou partagé.', 'Dupliquer reprend le même fichier pour sélectionner un autre passage.', 'editor', ['Créer un montage', 'Ajouter un extrait', 'Choisir le fichier']),
    step('Garder les bons passages', 'Sélectionnez un extrait, puis Choisir un extrait visuellement. Déplacez la tête de lecture et utilisez Début ici et Fin ici. Les flèches déplacent l’extrait dans l’ordre de lecture.', 'Les fichiers d’origine restent intacts.', 'editor', ['Choisir l’extrait', 'Début et fin', 'Ordre de lecture']),
    step('Contrôler et enregistrer', 'Lisez l’aperçu pour contrôler les raccords, le son et la durée du modèle. Enregistrez le projet pour retrouver votre montage. L’export reprend les extraits dans cet ordre.', 'La durée des extraits et la durée de l’habillage peuvent différer selon les réglages de sortie et de boucle.', 'export', ['Aperçu et son', 'Enregistrer', 'Exporter']),
  ]},
  crop: {id:'crop',title:'Recadrage',short:'Garder le sujet visible au bon format.',scope:'Le média et son cadre',steps:[
    step('Le cadre est le résultat visible', 'Choisissez Remplir le cadre, puis Cadrer pour les réseaux. Glissez l’image pour placer le sujet ; Image entière conserve toute l’image et ne permet pas ce recadrage.', 'Sur un format vertical, les côtés peuvent sortir du cadre.', 'crop', ['Remplir le cadre', 'Cadrer pour les réseaux', 'Sujet dans le cadre']),
    step('Construire le mouvement', 'Choisissez un instant, puis Créer des repères ou Ajouter un repère ici. Déplacez l’image à chaque instant utile et utilisez Lire le mouvement pour vérifier.', 'Annuler le dernier cadrage revient sur la dernière retouche.', 'crop', ['Choisir l’instant', 'Ajouter un repère', 'Lire le mouvement']),
    step('Vérifier le suivi assisté', 'Le suivi assisté calcule une proposition sur le sujet choisi. Examinez-la avant Appliquer le mouvement, puis relisez le passage ; les repères manuels restent disponibles.', 'Le suivi ne reconnaît pas l’identité des personnes.', 'crop', ['Proposition de suivi', 'Appliquer le mouvement', 'Vérifier ou annuler']),
  ]},
  export: {id:'export',title:'Exporter',short:'Produire un fichier sur ce poste.',scope:'Export local, statut indépendant',steps:[
    step('Vérifier les réglages affichés', 'Exporter utilise les réglages actuellement affichés. Vérifiez les textes, les médias reconnectés, le son et le format souhaité.', 'L’export peut être lancé sans validation préalable ; il ne vaut pas validation.', 'export', ['Réglages affichés', 'Médias disponibles', 'Format choisi']),
    step('Ajouter à la file, continuer à travailler', 'Cliquez sur Ajouter à la file d’exports. Vous pouvez modifier ou ouvrir un autre projet. Le bouton Exports rassemble la progression et les fichiers à télécharger.', 'Gardez cet onglet ouvert : fermer ou recharger interrompt la file locale. La lecture de l’aperçu est mise en pause pendant le calcul.', 'export', ['Ajouter à la file', 'Continuer à travailler', 'Télécharger et contrôler']),
  ]},
  text: {id:'text',title:'Textes & typographie',short:'Personnaliser le texte sans perdre ses repères.',scope:'Un réglage par texte et par format',steps:[
    step('Choisir le texte à modifier', 'Cliquez sur un texte dans l’aperçu ou choisissez-le dans Texte à modifier. Ajustez le contenu, la couleur, la police et la taille.', '100 % correspond à la taille d’origine du modèle.', 'text', ['Texte sélectionné', 'Police · taille · couleur', 'Aperçu actualisé']),
    step('Placer et corriger', 'Glissez le texte ou utilisez les flèches : 1 pixel, Maj + flèche : 10 pixels. Annuler le réglage revient sur la dernière retouche de typographie.', 'Chaque format garde ses réglages ; contrôlez les marges et l’animation.', 'text', ['Sélectionner', 'Déplacer', 'Contrôler']),
    step('Retrouver la charte', 'Rétablir la charte retrouve la mise en forme du modèle. Une police importée est locale : un autre poste devra importer le même fichier.', 'Les textes gardent leur animation après personnalisation.', 'editor', ['Mise en forme', 'Rétablir la charte', 'Animation conservée']),
  ]},
  logos: {id:'logos',title:'Logos & sponsors',short:'Choisir, afficher et placer le bon logo.',scope:'Selon les emplacements du modèle',steps:[
    step('Image choisie et affichage sont distincts', 'Pour le logo supplémentaire, choisissez une image puis cochez Afficher ce logo supplémentaire. Le logo de la chaîne et les sponsors se règlent séparément.', 'Masquer conserve le fichier et ses réglages.', 'logos', ['Choisir l’image', 'Afficher le logo', 'Vérifier l’aperçu']),
    step('Régler la position et l’apparition', 'Le logo supplémentaire propose position, taille et apparition : sans animation, fondu ou glissement. Contrôlez chaque format et les marges.', 'Les sponsors suivent leur emplacement et leur animation de modèle.', 'logos', ['Position', 'Taille', 'Apparition']),
  ]},
  graphics: {id:'graphics',title:'Graphisme & placement',short:'Ajuster l’habillage, pas le cadrage de la vidéo.',scope:'Selon le modèle et le format',steps:[
    step('Couleurs et placement', 'Graphisme rassemble les couleurs, les fonds et les placements disponibles. Pour changer un texte seul, utilisez Textes ; pour déplacer l’image, utilisez Médias.', 'Contrôlez l’entrée, la lecture et la sortie après vos retouches.', 'editor', ['Couleurs et fonds', 'Blocs d’habillage', 'Aperçu et marges']),
    step('Réduire le carton des réseaux', 'En 4:5 ou 9:16, Taille du carton propose Petit, Moyen et Grand. Le fond et le contenu restent proportionnels ; chaque format conserve sa taille.', 'Rétablir ce carton retrouve sa taille de référence. Vérifiez la lisibilité sur téléphone.', 'editor', ['Choisir le format', 'Taille du carton', 'Contrôler le résultat']),
  ]},
  timing: {id:'timing',title:'Durée & sortie',short:'Distinguer la lecture de l’animation de fin.',scope:'Selon le modèle et le mode de sortie',steps:[
    step('Lire les trois temps', 'L’entrée installe l’habillage, la lecture présente le contenu, puis la sortie joue l’animation de fin. Vérifiez le passage utile dans l’aperçu.', 'La pause et l’inspection d’une image sont silencieuses.', 'overview', ['Entrée', 'Lecture', 'Sortie']),
    step('Prévoir la fin de l’export', 'En TV, OUT déclenche l’animation de fin. Les BA 4:5 et 9:16 commencent directement sur les extraits et se terminent sans animation ajoutée.', 'Sans boucle, une BA sociale s’arrête au plus tard à la fin des extraits. Contrôlez le fichier obtenu.', 'export', ['Choisir le format', 'Vérifier les extraits', 'Contrôler la fin']),
  ]},
  derivations: {id:'derivations',title:'Déclinaisons',short:'Préparer des versions, puis les exporter.',scope:'Si disponible pour ce modèle',steps:[
    step('Examiner les versions proposées', 'Les déclinaisons partent d’un habillage existant : annonces, formats sociaux ou autres éléments selon le modèle. Vous choisissez ce qui sera préparé.', 'Chaque projet créé reste ajustable séparément.', 'library', ['Projet source', 'Propositions', 'Projets distincts']),
    step('Préparer n’est pas exporter', 'La préparation crée les projets confirmés. L’export produit ensuite leurs fichiers ; contrôlez les médias, les voix et les réglages de chaque version.', 'Une file en cours doit se terminer ou être annulée avant un autre export.', 'export', ['Préparer les projets', 'Vérifier chaque version', 'Exporter les fichiers']),
  ]},
  habits: {id:'habits',title:'Habitudes & recettes',short:'Réutiliser des choix confirmés par l’équipe.',scope:'Règles partagées approuvées',steps:[
    step('Confirmer les habitudes observées', 'Les habitudes s’appuient sur des choix confirmés dans les préparations. Elles peuvent proposer une association d’émission, d’emplacement et de livrables.', 'Une proposition n’est pas une règle active.', 'programme', ['Choix confirmés', 'Habitude proposée', 'À examiner']),
    step('Approuver avant de réutiliser', 'Un administrateur ou un diffuseur approuve la règle partagée. Les médias proposés restent à vérifier : la règle ne devine pas le bon épisode.', 'Aucun apprentissage automatique ne remplace votre confirmation.', 'review', ['Proposition', 'Approbation', 'Règle partagée']),
  ]},
  sharing: {id:'sharing',title:'Qui voit quoi ?',short:'Quatre repères pour travailler ensemble.',scope:'Dans les limites de la chaîne',steps:[
    step('Fiches et listes : un socle commun', 'Les fiches Émissions enregistrées et les préparations enregistrées pour l’équipe sont communes aux membres autorisés de la chaîne.', 'Une copie locale non enregistrée pour l’équipe ne devient pas partagée.', 'team', ['Émissions', 'Listes enregistrées', 'Équipe de la chaîne']),
    step('Tâche collective, projet privé', 'Une attribution désigne le responsable d’une tâche. Le projet reste privé par défaut, avec accès à l’auteur et aux administrateurs ou diffuseurs autorisés.', 'Attribuer une tâche ne donne pas accès à son projet privé.', 'privacy', ['Tâche visible', 'Responsable unique', 'Projet privé']),
    step('Partager le projet est un choix', 'Partagé avec l’équipe autorise aussi les infographistes de la chaîne à ouvrir et modifier ce projet. Les autres projets gardent leur propre visibilité.', 'Le bouton de partage est dans le projet.', 'privacy', ['Ce projet', 'Partage explicite', 'Infographistes de la chaîne']),
    step('Fichiers et repères sont différents', 'Le catalogue d’emplacements partage des repères, pas les fichiers ni les permissions du disque. Médias permet un vrai transfert, uniquement après confirmation.', 'Chaque poste autorise ses propres dossiers.', 'local', ['Catalogue : références', 'Dossiers : accès local', 'Médias : transfert choisi']),
  ]},
};

export const HELP_TOPIC_ORDER: readonly GraphicsHelpTopic[] = ['start','sharing','home','planner','projects','programmes','library','media','validation','editor','text','logos','graphics','audio','montage','crop','timing','export','derivations','habits','connector','channels','admin'];
export function isHelpTopic(value: unknown): value is GraphicsHelpTopic {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(topics,value);
}
export function helpTopic(id: GraphicsHelpTopic | string, role: GraphicsHelpRole = 'designer'): HelpTopic {
  const topic = topics[isHelpTopic(id) ? id : 'home'];
  return topic.id === 'validation' && role === 'designer' ? {...topic,title:'Mes envois'} : topic;
}
export function availableHelpTopics(role: GraphicsHelpRole): HelpTopic[] {
  if(role==='commercial')return [];
  return HELP_TOPIC_ORDER.filter(id=>id!=='admin'||role==='admin').map(id=>helpTopic(id,role));
}
export function safeHelpDestination(topic: HelpTopic, role: GraphicsHelpRole): GraphicsHelpPage | undefined {
  if(role==='commercial')return undefined;
  if (topic.destination === 'admin' && role !== 'admin') return undefined;
  return topic.destination;
}

export const HELP_VERSION = 1;
export interface HelpProgress {
  version: typeof HELP_VERSION;
  dismissed: boolean;
  last: {topic: GraphicsHelpTopic; step: number} | null;
  completed: GraphicsHelpTopic[];
}
export interface HelpStorage {getItem(key: string): string | null; setItem(key: string, value: string): void}
export function helpStorageKey(memberId: string): string {
  return `srtb.graphics.guide.v${HELP_VERSION}:${encodeURIComponent(memberId.trim().toLowerCase())}`;
}
export function emptyHelpProgress(): HelpProgress {return {version:HELP_VERSION,dismissed:false,last:null,completed:[]};}
export function parseHelpProgress(raw: string | null): HelpProgress {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if(!value || typeof value!=='object' || !('version' in value) || value.version!==HELP_VERSION) return emptyHelpProgress();
    const record=value as Record<string, unknown>;
    let last: HelpProgress['last']=null;
    if(record.last && typeof record.last==='object'){
      const candidate=record.last as Record<string,unknown>;
      if(isHelpTopic(candidate.topic)&&Number.isInteger(candidate.step)&&typeof candidate.step==='number'&&candidate.step>=0&&candidate.step<helpTopic(candidate.topic).steps.length)last={topic:candidate.topic,step:candidate.step};
    }
    return {version:HELP_VERSION,dismissed:record.dismissed===true,last,completed:Array.isArray(record.completed)?[...new Set(record.completed.filter(isHelpTopic))]:[]};
  }catch{return emptyHelpProgress();}
}
function browserStorage(): HelpStorage | undefined {
  try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}
}
export function readHelpProgress(memberId: string, storage: HelpStorage | undefined = browserStorage()): HelpProgress {
  if(!memberId.trim())return emptyHelpProgress();
  try{return parseHelpProgress(storage?.getItem(helpStorageKey(memberId))??null);}catch{return emptyHelpProgress();}
}
export function writeHelpProgress(memberId: string, progress: HelpProgress, storage: HelpStorage | undefined = browserStorage()): boolean {
  if(!memberId.trim()||!storage)return false;
  try{storage.setItem(helpStorageKey(memberId),JSON.stringify(parseHelpProgress(JSON.stringify(progress))));return true;}catch{return false;}
}
