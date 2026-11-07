# Motrix AllDebrid Resolver Plugin ⚡

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Motrix](https://img.shields.io/badge/Motrix->=2.0.0-orange.svg)](https://motrix.app)
[![AllDebrid](https://img.shields.io/badge/AllDebrid-API%20v4-green.svg)](https://alldebrid.com)

*Français : Voir [README.fr.md](README.fr.md) pour la documentation en français.*

An official community plugin (`.moext`) for the **[Motrix](https://motrix.app)** download manager that automatically intercepts, unlocks, and accelerates file hoster links using your **[AllDebrid](https://alldebrid.com)** premium account.

Turn Motrix into a sleek, fast, and modern alternative to **JDownloader**!

---

## ✨ Features

- **🚀 Transparent Automatic Unrestricting**: Paste any supported link (1fichier, Rapidgator, Turbobit, Mega, Katfile, DDownload, etc.) directly into Motrix or use the browser extension. The plugin intercepts it and replaces it with the high-speed direct CDN stream.
- **🛡️ JDownloader-Style Account Recognition**: 
  - Automatically verifies your AllDebrid API key when entered in Motrix Settings.
  - Detects account status, username, expiration date, and remaining days.
  - Dedicated command: *"Check AllDebrid Account Status"*.
- **⚡ Maximum Download Speeds**: Leverages Motrix's built-in **Aria2** engine to saturate your internet connection with multi-threaded, parallel connections (up to 16-64 threads).
- **📦 Batch / Multi-Link Support**: Add 20 or 50 split archive links (`.part01.rar`, `.part02.rar`...) in a single step; all links are resolved and queued automatically.
- **🔄 Resume Support**: Interrupted downloads can be paused and resumed without restarting from 0%.
- **🏷️ Real Filenames & Sizes**: Fetches original file names and sizes from the hoster before starting disk writes.
- **🔔 Native Notifications**: Discreet system alerts when a download is successfully unlocked or when subscription status changes.
- **⚡ Dynamic Hoster Cache**: Periodically caches supported domains via `/v4/hosts` to minimize network overhead on non-debrid links.

---

## 📥 Installation in Motrix

1. Make sure you have **Motrix v2.0.0 or later** installed.
2. Locate the packaged file **`alldebrid-resolver.moext`** in the `dist/` folder of this repository (or download it from Releases).
3. Open **Motrix**.
4. Go to **Preferences** (gear icon) ➔ **Plugins**.
5. Click **Install Plugin** (or drag & drop `alldebrid-resolver.moext` into the window).
6. Review and confirm the requested permissions (`http`, `notify`).
7. In the **AllDebrid** plugin settings tab:
   - Enter your **AllDebrid API Key** (generate one on [alldebrid.com/apikeys](https://alldebrid.com/apikeys)).
   - Ensure **Enable Automatic Unrestricting** is checked.
8. A notification will confirm that your account is recognized as **Premium Active**!

---

## 🛠️ Usage

Simply copy any supported download link and paste it into Motrix (`Ctrl + N` or `+` button). Motrix will automatically unlock the link and download it at full speed.

You can also right-click any link in your browser and choose **"Download with Motrix"** if you have the *Motrix WebExtension* installed.

---

## 🏗️ Development & Building

To rebuild the `.moext` package:

```bash
git clone https://github.com/DonTarken/motrix-plugin-alldebrid.git
cd motrix-plugin-alldebrid
npm run build
```

The output bundle will be generated in `dist/alldebrid-resolver.moext`.

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
Created with ❤️ by **[DonTarken](https://github.com/DonTarken)**.
