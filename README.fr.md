# Plugin AllDebrid pour Motrix ⚡

[![Licence : MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Motrix](https://img.shields.io/badge/Motrix->=2.0.0-orange.svg)](https://motrix.app)
[![AllDebrid](https://img.shields.io/badge/AllDebrid-API%20v4-green.svg)](https://alldebrid.com)

Plugin communautaire officiel (`.moext`) pour le gestionnaire de téléchargement **[Motrix](https://motrix.app)** qui intercepte, débride et accélère automatiquement les liens d'hébergeurs de fichiers grâce à votre compte premium **[AllDebrid](https://alldebrid.com)**.

Transformez Motrix en une alternative moderne, élégante et ultra-légère à **JDownloader** !

---

## ✨ Fonctionnalités

- **🚀 Débridage automatique et transparent** : Collez n'importe quel lien supporté (1fichier, Rapidgator, Turbobit, Mega, Katfile, DDownload, etc.) directement dans Motrix ou via l'extension de navigateur. Le plugin intercepte le lien et le remplace par le flux direct haute vitesse CDN.
- **🛡️ Reconnaissance de compte style JDownloader** :
  - Vérification automatique de votre clé API AllDebrid dès sa saisie dans les paramètres.
  - Détection du statut d'abonnement, du nom d'utilisateur, de la date d'expiration et du nombre de jours restants.
  - Commande dédiée : *"Vérifier le statut du compte AllDebrid"*.
- **⚡ Vitesse de téléchargement maximale** : Exploite le moteur multi-sources **Aria2** de Motrix pour saturer votre connexion fibre grâce au téléchargement multi-connexions en parallèle (jusqu'à 16-64 threads).
- **📦 Téléchargement groupé (Batch)** : Ajoutez 20 ou 50 liens d'archives découpées (`.part01.rar`, `.part02.rar`...) en une seule fois ; tous les liens sont résolus et mis en file d'attente automatiquement.
- **🔄 Reprise des téléchargements (Resume)** : Les téléchargements interrompus peuvent être mis en pause et repris sans recommencer à 0 %.
- **🏷️ Noms réels et tailles préservés** : Récupère les métadonnées et le vrai nom du fichier d'origine avant le début de l'écriture sur le disque.
- **🔔 Notifications natives** : Alertes système discrètes lorsqu'un lien est débridé ou lors du contrôle de l'abonnement.
- **⚡ Cache dynamique des hébergeurs** : Met en cache la liste des hébergeurs via `/v4/hosts` pour ne pas solliciter l'API sur des liens directs non débridables.

---

## 📥 Guide d'Installation dans Motrix

1. Assurez-vous d'avoir **Motrix v2.0.0 ou supérieur** installé sur votre ordinateur.
2. Repérez le fichier **`alldebrid-resolver.moext`** généré dans le dossier `dist/` de ce dépôt.
3. Ouvrez **Motrix**.
4. Allez dans les **Préférences** (icône d'engrenage en bas à gauche) ➔ onglet **Plugins**.
5. Cliquez sur **Installer un plugin** (ou glissez-déposez le fichier `alldebrid-resolver.moext`).
6. Confirmez l'écran des permissions demandées (`http`, `notify`).
7. Dans l'onglet des paramètres du plugin **AllDebrid** :
   - Renseignez votre **Clé API AllDebrid** (générée sur [alldebrid.com/apikeys](https://alldebrid.com/apikeys)).
   - Vérifiez que l'option **Activer le débridage automatique** est bien cochée.
8. Une notification système confirme immédiatement que votre compte est **Premium Actif** avec votre solde de jours restants !

---

## 🛠️ Utilisation quotidienne

Copiez simplement n'importe quel lien d'hébergeur supporté et collez-le dans Motrix (`Ctrl + N` ou bouton `+`). Motrix s'occupe de tout et lance le téléchargement à pleine vitesse.

Vous pouvez aussi utiliser l'extension de navigateur Motrix pour faire un simple clic droit **"Télécharger avec Motrix"** sur n'importe quel lien web.

---

## 🏗️ Développement et Compilation

Pour recompiler le paquet `.moext` à partir des sources :

```bash
git clone https://github.com/DonTarken/motrix-plugin-alldebrid.git
cd motrix-plugin-alldebrid
npm run build
```

Le fichier compilé est généré dans `dist/alldebrid-resolver.moext`.

---

## 📄 Licence

Ce projet est sous licence open-source [MIT](LICENSE).  
Créé avec ❤️ par **[DonTarken](https://github.com/DonTarken)**.
