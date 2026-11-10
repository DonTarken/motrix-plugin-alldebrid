/**
 * Motrix AllDebrid Resolver Plugin
 *
 * Intercepte automatiquement les liens d'hébergeurs supportés ajoutés dans Motrix,
 * les débride via l'API officielle AllDebrid v4, et transmet le lien direct haute vitesse à Aria2.
 *
 * @author DonTarken
 * @license MIT
 */

import {
  commands,
  config,
  hooks,
  http,
  lifecycle,
  log,
  notify,
  storage,
} from "motrix:plugin-api";

const AGENT_NAME = "motrix-alldebrid";
const API_BASE = "https://api.alldebrid.com/v4";

// Domaines racines AllDebrid & dérivés à exclure strictement du débridage
const EXCLUDED_HOSTS = [
  "alldebrid.com",
  "alldeb.ovh",
  "debrid.it",
  "localhost",
  "127.0.0.1",
  "[::1]",
];

// Vérification stricte du nom d'hôte (évite les faux positifs dans le chemin ou la query)
function shouldSkip(url) {
  if (!url || typeof url !== "string") return true;
  const lower = url.trim().toLowerCase();

  // Protocoles non-HTTP
  if (
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("file:")
  ) {
    return true;
  }

  const host = extractHostname(lower);
  if (!host) return true;

  for (const d of EXCLUDED_HOSTS) {
    if (host === d || host.endsWith("." + d)) {
      return true;
    }
  }

  return false;
}

// Formatage de la date d'expiration
function formatUnixTimestamp(ts) {
  if (!ts || isNaN(ts)) return "N/A";
  const d = new Date(ts * 1000);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Calcul des jours restants
function getDaysRemaining(ts) {
  if (!ts || isNaN(ts)) return 0;
  const diff = ts * 1000 - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Récupération de la clé API AllDebrid :
 * 1. Depuis les paramètres de l'extension (config.get("apiKey"))
 * 2. Repli éventuel depuis le stockage persistant (storage.get("apiKey"))
 */
async function getApiKey() {
  try {
    const fromConfig = await config.get("apiKey");
    if (fromConfig && typeof fromConfig === "string" && fromConfig.trim()) {
      return fromConfig.trim();
    }
  } catch (e) {
    log.debug("Lecture config impossible", { err: String(e) });
  }

  try {
    const stored = await storage.get("apiKey");
    if (stored && typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }
  } catch (e) {
    log.debug("Lecture storage impossible", { err: String(e) });
  }

  return null;
}

/**
 * Vérification du compte et de l'abonnement Premium via l'API AllDebrid /v4/user
 */
async function checkAccount(apiKey, triggerNotification = false) {
  if (!apiKey) {
    log.warn("AllDebrid: Clé API manquante");
    if (triggerNotification) {
      await notify.show({
        title: "AllDebrid",
        body: "Aucune clé API configurée. Rendez-vous dans Extensions ➔ AllDebrid Resolver ➔ Ouvrir.",
        icon: "warning",
      });
    }
    return null;
  }

  try {
    const url = `${API_BASE}/user?agent=${AGENT_NAME}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await http.request({
      method: "GET",
      url,
      responseType: "text",
      timeoutMs: 10000,
    });

    if (res.status !== 200) {
      log.warn("AllDebrid /user statut HTTP inattendu", { status: res.status });
      if (triggerNotification) {
        await notify.show({
          title: "AllDebrid — Erreur",
          body: `Échec de communication avec AllDebrid (HTTP ${res.status})`,
          icon: "error",
        });
      }
      return null;
    }

    const parsed = JSON.parse(res.body);
    if (parsed.status === "success" && parsed.data?.user) {
      const u = parsed.data.user;
      const days = getDaysRemaining(u.premiumUntil);
      const expDate = formatUnixTimestamp(u.premiumUntil);

      log.info("AllDebrid: Compte validé", {
        username: u.username,
        isPremium: u.isPremium,
        daysRemaining: days,
      });

      if (triggerNotification) {
        if (u.isPremium) {
          await notify.show({
            title: "AllDebrid — Compte Premium Actif",
            body: `Utilisateur : ${u.username} | Expire le ${expDate} (${days} jours restants).`,
            icon: "success",
          });
        } else {
          await notify.show({
            title: "AllDebrid — Non Premium",
            body: `Compte ${u.username} reconnu, mais l'abonnement Premium a expiré.`,
            icon: "error",
          });
        }
      }
      return u;
    } else if (parsed.status === "error") {
      const errCode = parsed.error?.code || "UNKNOWN";
      const errMsg = parsed.error?.message || "Erreur inconnue";
      log.warn("AllDebrid /user erreur", { code: errCode, message: errMsg });
      if (triggerNotification) {
        await notify.show({
          title: "AllDebrid — Erreur d'authentification",
          body: `Erreur : ${errCode} (${errMsg})`,
          icon: "error",
        });
      }
    }
  } catch (e) {
    log.error("AllDebrid /user exception", { err: String(e) });
    if (triggerNotification) {
      await notify.show({
        title: "AllDebrid — Erreur",
        body: `Impossible de vérifier le compte : ${String(e)}`,
        icon: "error",
      });
    }
  }
  return null;
}

/**
 * Gestion du cache des hébergeurs supportés (/v4/hosts)
 */
let cachedDomains = null;
let lastHostsRefresh = 0;
const HOSTS_CACHE_TTL = 3600000; // 1 heure

async function getSupportedDomains() {
  const now = Date.now();
  if (cachedDomains && now - lastHostsRefresh < HOSTS_CACHE_TTL) {
    return cachedDomains;
  }

  try {
    const url = `${API_BASE}/hosts?agent=${AGENT_NAME}&hostsOnly=true`;
    const res = await http.request({
      method: "GET",
      url,
      responseType: "text",
      timeoutMs: 8000,
    });

    if (res.status === 200 && res.body) {
      const parsed = JSON.parse(res.body);
      if (parsed.status === "success" && parsed.data?.hosts) {
        const domains = new Set();
        const hostsObj = parsed.data.hosts;
        for (const key of Object.keys(hostsObj)) {
          const h = hostsObj[key];
          if (Array.isArray(h.domains)) {
            for (const d of h.domains) {
              domains.add(d.toLowerCase());
            }
          }
        }
        cachedDomains = domains;
        lastHostsRefresh = now;
        log.info("AllDebrid: Liste des hébergeurs rafraîchie", {
          count: domains.size,
        });
        return domains;
      }
    }
  } catch (e) {
    log.warn("AllDebrid: Échec de récupération de la liste des hébergeurs", {
      err: String(e),
    });
  }

  return cachedDomains;
}

function extractHostname(url) {
  if (!url || typeof url !== "string") return "";
  // Extraction de l'autorité entre :// et le premier /, ? ou #
  const match = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  if (!match) return "";

  let host = match[1].toLowerCase();

  // Retrait des credentials éventuels (user:pass@host)
  if (host.includes("@")) {
    host = host.split("@").pop();
  }

  // Gestion des adresses IPv6 entre crochets [::1]:port
  if (host.startsWith("[")) {
    const bracketEnd = host.indexOf("]");
    if (bracketEnd !== -1) {
      return host.slice(0, bracketEnd + 1);
    }
  }

  // Retrait du port (host:8080)
  if (host.includes(":")) {
    host = host.split(":")[0];
  }
  return host.trim();
}

function isSupportedHost(url, domains) {
  if (!domains || domains.size === 0) return true;
  const host = extractHostname(url);
  if (!host) return false;
  if (domains.has(host)) return true;
  for (const d of domains) {
    if (host === d || host.endsWith("." + d)) return true;
  }
  return false;
}

/**
 * Déverrouillage d'un lien via /v4/link/unlock
 */
async function unlockLink(link, apiKey) {
  const url = `${API_BASE}/link/unlock?agent=${AGENT_NAME}&apikey=${encodeURIComponent(apiKey)}`;
  const postData = `link=${encodeURIComponent(link)}`;

  const res = await http.request({
    method: "POST",
    url,
    headers: [
      { name: "Content-Type", value: "application/x-www-form-urlencoded" },
    ],
    body: {
      type: "string",
      data: postData,
    },
    responseType: "text",
    timeoutMs: 15000,
  });

  if (res.status !== 200) {
    log.warn("AllDebrid /link/unlock statut HTTP non-200", {
      status: res.status,
    });
    return null;
  }

  const parsed = JSON.parse(res.body);
  if (parsed.status === "success" && parsed.data?.link) {
    return {
      directUrl: parsed.data.link,
      filename: parsed.data.filename || parsed.data.file,
      filesize: parsed.data.filesize,
      host: parsed.data.host,
    };
  }

  if (parsed.status === "error") {
    log.info("AllDebrid: Lien non débridé", {
      code: parsed.error?.code,
      message: parsed.error?.message,
    });
  }

  return null;
}

/**
 * Hook beforeCreate : Interception et réécriture du lien de téléchargement
 */
hooks.beforeCreate(async (ctx) => {
  if (ctx.type !== "http") return ctx;

  const originalUrl = ctx.uris?.[0];
  if (!originalUrl || shouldSkip(originalUrl)) return ctx;

  const enabled = await config.get("enabled");
  if (enabled === false) return ctx;

  const apiKey = await getApiKey();
  if (!apiKey) {
    log.warn("AllDebrid: Aucune clé API configurée.");
    try {
      await notify.show({
        title: "AllDebrid — Configuration requise",
        body: "Veuillez renseigner votre clé API dans Extensions ➔ AllDebrid Resolver ➔ Ouvrir.",
        icon: "warning",
        urgency: "low",
      });
    } catch {}
    return ctx;
  }

  try {
    const domains = await getSupportedDomains();
    if (!isSupportedHost(originalUrl, domains)) {
      log.debug("AllDebrid: Domaine non supporté, pas de débridage", {
        url: originalUrl,
      });
      return ctx;
    }

    log.info("AllDebrid: Débridage en cours...", { url: originalUrl });
    const result = await unlockLink(originalUrl, apiKey);

    if (result && result.directUrl) {
      log.info("AllDebrid: Lien débridé avec succès !", {
        directUrl: result.directUrl,
        filename: result.filename,
      });

      // Seule la liste d'URIs est mise à jour (nom de fichier extrait automatiquement de l'URL CDN)
      ctx.update({
        uris: [result.directUrl],
      });

      const showNotif = await config.get("showNotification");
      if (showNotif !== false) {
        try {
          await notify.show({
            title: "Lien débridé avec succès !",
            body:
              result.filename ||
              "Téléchargement direct haute vitesse AllDebrid.",
            icon: "success",
            urgency: "low",
          });
        } catch {}
      }
    }
  } catch (err) {
    log.error("AllDebrid: Erreur inattendue", { err: String(err) });
  }

  return ctx;
});

/**
 * Commande manuelle pour vérifier l'état du compte
 */
commands.register("community.alldebrid-resolver.checkAccount", async () => {
  const apiKey = await getApiKey();
  await checkAccount(apiKey, true);
});

lifecycle.onDeactivate(async () => {
  log.info("AllDebrid Resolver désactivé.");
});

// Exports pour tests unitaires automatisés
export {
  shouldSkip,
  extractHostname,
  isSupportedHost,
  unlockLink,
  getSupportedDomains,
  getApiKey,
  checkAccount,
};
