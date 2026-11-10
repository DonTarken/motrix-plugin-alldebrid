/**
 * Motrix AllDebrid Resolver Plugin
 *
 * Automatically intercepts supported host links added to Motrix,
 * resolves them via the official AllDebrid v4 API, and passes
 * the high-speed direct download link to Aria2.
 *
 * @author DonTarken
 * @license MIT
 */

import {
  commands,
  config,
  hooks,
  http,
  i18n,
  lifecycle,
  log,
  notify,
  storage,
} from "motrix:plugin-api";

const AGENT_NAME = "motrix-alldebrid";
const API_BASE = "https://api.alldebrid.com/v4";

// AllDebrid domains & aliases excluded from unrestricting
const EXCLUDED_HOSTS = [
  "alldebrid.com",
  "alldeb.ovh",
  "debrid.it",
  "localhost",
  "127.0.0.1",
  "[::1]",
];

// Helper to translate notification texts via Motrix's i18n module
function t(key, params) {
  try {
    if (typeof i18n?.t === "function") {
      return i18n.t(key, params);
    }
  } catch {}
  return key;
}

// Strict hostname verification (prevents false positives in path or query)
function shouldSkip(url) {
  if (!url || typeof url !== "string") return true;
  const lower = url.trim().toLowerCase();

  // Non-HTTP protocols
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

// Format expiration timestamp
function formatUnixTimestamp(ts) {
  if (!ts || isNaN(ts)) return "N/A";
  const d = new Date(ts * 1000);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Calculate remaining days
function getDaysRemaining(ts) {
  if (!ts || isNaN(ts)) return 0;
  const diff = ts * 1000 - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Retrieve AllDebrid API key:
 * 1. From extension configuration (config.get("apiKey"))
 * 2. Fallback to persistent storage (storage.get("apiKey"))
 */
async function getApiKey() {
  try {
    const fromConfig = await config.get("apiKey");
    if (fromConfig && typeof fromConfig === "string" && fromConfig.trim()) {
      return fromConfig.trim();
    }
  } catch (e) {
    log.debug("Failed to read config", { err: String(e) });
  }

  try {
    const stored = await storage.get("apiKey");
    if (stored && typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }
  } catch (e) {
    log.debug("Failed to read storage", { err: String(e) });
  }

  return null;
}

/**
 * Verify account and Premium subscription via /v4/user
 */
async function checkAccount(apiKey, triggerNotification = false) {
  if (!apiKey) {
    log.warn("AllDebrid: Missing API key");
    if (triggerNotification) {
      await notify.show({
        title: t("notif.configRequired.title"),
        body: t("notif.configRequired.body"),
        icon: "warning",
      });
    }
    return null;
  }

  try {
    const url = `${API_BASE}/user?agent=${AGENT_NAME}`;
    const res = await http.request({
      method: "GET",
      url,
      headers: [
        { name: "Authorization", value: `Bearer ${apiKey}` },
      ],
      responseType: "text",
      timeoutMs: 10000,
    });

    if (res.status !== 200) {
      log.warn("AllDebrid /user unexpected HTTP status", { status: res.status });
      if (triggerNotification) {
        await notify.show({
          title: t("notif.error.title"),
          body: t("notif.error.body", { status: res.status }),
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

      log.info("AllDebrid: Account validated", {
        username: u.username,
        isPremium: u.isPremium,
        daysRemaining: days,
      });

      if (triggerNotification) {
        if (u.isPremium) {
          await notify.show({
            title: t("notif.account.premium.title"),
            body: t("notif.account.premium.body", {
              username: u.username,
              expDate,
              days,
            }),
            icon: "success",
          });
        } else {
          await notify.show({
            title: t("notif.account.nonPremium.title"),
            body: t("notif.account.nonPremium.body", {
              username: u.username,
            }),
            icon: "error",
          });
        }
      }
      return u;
    } else if (parsed.status === "error") {
      const errCode = parsed.error?.code || "UNKNOWN";
      const errMsg = parsed.error?.message || "Unknown error";
      log.warn("AllDebrid /user error", { code: errCode, message: errMsg });
      if (triggerNotification) {
        await notify.show({
          title: t("notif.account.authError.title"),
          body: t("notif.account.authError.body", {
            code: errCode,
            message: errMsg,
          }),
          icon: "error",
        });
      }
    }
  } catch (e) {
    log.error("AllDebrid /user exception", { err: String(e) });
    if (triggerNotification) {
      await notify.show({
        title: t("notif.error.title"),
        body: t("notif.error.unknown", { err: String(e) }),
        icon: "error",
      });
    }
  }
  return null;
}

/**
 * Supported hosts cache management (/v4/hosts)
 */
let cachedDomains = null;
let lastHostsRefresh = 0;
const HOSTS_CACHE_TTL = 3600000; // 1 hour

async function getSupportedDomains(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedDomains && now - lastHostsRefresh < HOSTS_CACHE_TTL) {
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
        log.info("AllDebrid: Refreshed supported hosts list", {
          count: domains.size,
        });
        return domains;
      }
    }
  } catch (e) {
    log.warn("AllDebrid: Failed to fetch supported hosts list", {
      err: String(e),
    });
  }

  return cachedDomains;
}

function extractHostname(url) {
  if (!url || typeof url !== "string") return "";
  // Extract authority between :// and first /, ? or #
  const match = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  if (!match) return "";

  let host = match[1].toLowerCase();

  // Strip user credentials (user:pass@host)
  if (host.includes("@")) {
    host = host.split("@").pop();
  }

  // Handle bracketed IPv6 addresses [::1]:port
  if (host.startsWith("[")) {
    const bracketEnd = host.indexOf("]");
    if (bracketEnd !== -1) {
      return host.slice(0, bracketEnd + 1);
    }
  }

  // Strip port (host:8080)
  if (host.includes(":")) {
    host = host.split(":")[0];
  }
  return host.trim();
}

function isSupportedHost(url, domains) {
  // Fail closed: reject if host list is missing or empty
  if (!domains || domains.size === 0) return false;

  const host = extractHostname(url);
  if (!host) return false;

  if (domains.has(host)) return true;
  for (const d of domains) {
    if (host === d || host.endsWith("." + d)) return true;
  }
  return false;
}

/**
 * Unrestrict download link via /v4/link/unlock
 */
async function unlockLink(link, apiKey) {
  const url = `${API_BASE}/link/unlock?agent=${AGENT_NAME}`;
  const postData = `link=${encodeURIComponent(link)}`;

  const res = await http.request({
    method: "POST",
    url,
    headers: [
      { name: "Content-Type", value: "application/x-www-form-urlencoded" },
      { name: "Authorization", value: `Bearer ${apiKey}` },
    ],
    body: {
      type: "string",
      data: postData,
    },
    responseType: "text",
    timeoutMs: 15000,
  });

  if (res.status !== 200) {
    log.warn("AllDebrid /link/unlock non-200 HTTP status", {
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
    log.info("AllDebrid: Link could not be unrestricted", {
      code: parsed.error?.code,
      message: parsed.error?.message,
    });
  }

  return null;
}

/**
 * beforeCreate hook: intercept and rewrite download link
 */
hooks.beforeCreate(async (ctx) => {
  if (ctx.type !== "http") return ctx;

  const originalUrl = ctx.uris?.[0];
  if (!originalUrl || shouldSkip(originalUrl)) return ctx;

  const enabled = await config.get("enabled");
  if (enabled === false) return ctx;

  const apiKey = await getApiKey();
  if (!apiKey) {
    log.warn("AllDebrid: No API key configured.");
    try {
      await notify.show({
        title: t("notif.configRequired.title"),
        body: t("notif.configRequired.body"),
        icon: "warning",
        urgency: "low",
      });
    } catch {}
    return ctx;
  }

  try {
    const domains = await getSupportedDomains();
    if (!isSupportedHost(originalUrl, domains)) {
      log.debug("AllDebrid: Unsupported host, skipping", {
        host: extractHostname(originalUrl),
      });
      return ctx;
    }

    log.info("AllDebrid: Unrestricting link...", {
      host: extractHostname(originalUrl),
    });
    const result = await unlockLink(originalUrl, apiKey);

    if (result && result.directUrl) {
      log.info("AllDebrid: Link unrestricted successfully", {
        host: extractHostname(result.directUrl),
        filename: result.filename,
      });

      // Update URIs (filename is extracted automatically from CDN response)
      ctx.update({
        uris: [result.directUrl],
      });

      const showNotif = await config.get("showNotification");
      if (showNotif !== false) {
        try {
          await notify.show({
            title: t("notif.unlocked.title"),
            body: result.filename || t("notif.unlocked.body"),
            icon: "success",
            urgency: "low",
          });
        } catch {}
      }
    }
  } catch (err) {
    log.error("AllDebrid: Unexpected error", { err: String(err) });
  }

  return ctx;
});

/**
 * Manual command to check account status
 */
commands.register("community.alldebrid-resolver.checkAccount", async () => {
  const apiKey = await getApiKey();
  await checkAccount(apiKey, true);
});

lifecycle.onDeactivate(async () => {
  log.info("AllDebrid Resolver deactivated.");
});

// Exports for automated unit tests
function resetHostsCache() {
  cachedDomains = null;
  lastHostsRefresh = 0;
}

export {
  shouldSkip,
  extractHostname,
  isSupportedHost,
  unlockLink,
  getSupportedDomains,
  resetHostsCache,
  getApiKey,
  checkAccount,
};
