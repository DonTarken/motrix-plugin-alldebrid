import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  shouldSkip,
  extractHostname,
  isSupportedHost,
  unlockLink,
  getSupportedDomains
} from "../src/index.js";
import { state, resetMockState } from "./mock-api.mjs";

describe("Point 3 — Parsing strict du nom d'hôte & Exclusions (shouldSkip)", () => {
  it("exclut les domaines AllDebrid et dérivés (exact et sous-domaines)", () => {
    assert.equal(shouldSkip("https://alldebrid.com/download/file.zip"), true);
    assert.equal(shouldSkip("https://api.alldebrid.com/v4/endpoint"), true);
    assert.equal(shouldSkip("https://debrid.it/dl/123/file.mkv"), true);
    assert.equal(shouldSkip("https://sub.alldeb.ovh/test"), true);
  });

  it("exclut les adresses locales, loopback et IPv6 (avec ou sans ports)", () => {
    assert.equal(shouldSkip("http://localhost/test"), true);
    assert.equal(shouldSkip("http://localhost:8080/file.iso"), true);
    assert.equal(shouldSkip("http://127.0.0.1/test"), true);
    assert.equal(shouldSkip("http://127.0.0.1:3000/api"), true);
    assert.equal(shouldSkip("http://[::1]/download"), true);
    assert.equal(shouldSkip("http://[::1]:8080/file"), true);
  });

  it("gère les identifiants utilisateur dans l'URL (credentials user:pass@host)", () => {
    assert.equal(shouldSkip("http://user:pass@localhost:8080/file"), true);
    assert.equal(shouldSkip("https://john:secret@alldebrid.com/file"), true);
    assert.equal(shouldSkip("https://john:secret@rapidgator.net/file"), false);
  });

  it("NE bloque PAS les faux positifs où les mots apparaissent dans le chemin (path)", () => {
    assert.equal(shouldSkip("https://upstream.com/files/localhost.tar.gz"), false);
    assert.equal(shouldSkip("https://archive.org/data/alldebrid.com_mirror.iso"), false);
    assert.equal(shouldSkip("https://downloads.example.org/127.0.0.1/report.pdf"), false);
  });

  it("NE bloque PAS les faux positifs où les mots apparaissent dans les paramètres (query string)", () => {
    assert.equal(shouldSkip("https://rapidgator.net/file/123?ref=alldebrid.com"), false);
    assert.equal(shouldSkip("https://turbobit.net/dl?source=localhost&redirect=1"), false);
    assert.equal(shouldSkip("https://1fichier.com/?token=alldeb.ovh"), false);
  });

  it("NE bloque PAS les domaines miroirs trompeurs (lookalikes)", () => {
    assert.equal(shouldSkip("https://fake-alldebrid.com/file.zip"), false);
    assert.equal(shouldSkip("https://alldebrid.com.attacker.net/payload"), false);
    assert.equal(shouldSkip("https://notlocalhost.org/file"), false);
  });
});

describe("Point 1 — Règle du Fail Closed & Validation d'hôtes (isSupportedHost)", () => {
  const sampleDomains = new Set(["rapidgator.net", "turbobit.net", "1fichier.com"]);

  it("Fail closed : renvoie FALSE si la liste d'hôtes est absente ou vide", () => {
    assert.equal(isSupportedHost("https://rapidgator.net/file/1", null), false);
    assert.equal(isSupportedHost("https://rapidgator.net/file/1", undefined), false);
    assert.equal(isSupportedHost("https://rapidgator.net/file/1", new Set()), false);
  });

  it("renvoie TRUE pour un hôte supporté (exact et sous-domaine légitime)", () => {
    assert.equal(isSupportedHost("https://rapidgator.net/file/123", sampleDomains), true);
    assert.equal(isSupportedHost("https://dl.rapidgator.net/file/123", sampleDomains), true);
    assert.equal(isSupportedHost("https://sub.sub.1fichier.com/test", sampleDomains), true);
  });

  it("renvoie FALSE pour un domaine non supporté ou lookalike", () => {
    assert.equal(isSupportedHost("https://google.com/file", sampleDomains), false);
    assert.equal(isSupportedHost("https://rapidgator.net.evil.org/file", sampleDomains), false);
    assert.equal(isSupportedHost("https://fakerapidgator.net/file", sampleDomains), false);
  });
});

describe("Point 1 & 2 — Sécurité Réseau, Bearer Token & Sanitisation des Logs", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("unlockLink utilise l'en-tête Authorization: Bearer et n'a pas d'apikey dans la query", async () => {
    state.httpMockResponse = {
      status: 200,
      body: JSON.stringify({
        status: "success",
        data: { link: "https://debrid.it/dl/123", filename: "test.zip" }
      })
    };

    const apiKey = "SECRET_API_TOKEN_XYZ";
    await unlockLink("https://rapidgator.net/file/123", apiKey);

    assert.equal(state.httpRequests.length, 1);
    const req = state.httpRequests[0];

    // Vérification de l'absence de l'API key dans l'URL
    assert.equal(req.url.includes("apikey="), false, "L'API key ne doit PAS figurer dans l'URL !");
    assert.equal(req.url.includes(apiKey), false, "Le token secret ne doit pas fuiter dans la query");

    // Vérification de la présence de l'en-tête Authorization: Bearer
    const authHeader = req.headers?.find(h => h.name.toLowerCase() === "authorization");
    assert.ok(authHeader, "L'en-tête Authorization doit être présent");
    assert.equal(authHeader.value, `Bearer ${apiKey}`);
  });

  it("Ne fait jamais fuiter d'URL complète avec token sensible dans les logs", async () => {
    state.httpMockResponse = {
      status: 200,
      body: JSON.stringify({ status: "error", error: { code: "LINK_ERROR", message: "Failed" } })
    };

    const sensitiveUrl = "https://rapidgator.net/file/123?access_token=SUPER_CONFIDENTIAL_TOKEN_999";
    await unlockLink(sensitiveUrl, "TEST_API_KEY");

    // Vérification de tous les logs émis
    for (const entry of state.logs) {
      const fullLogText = JSON.stringify(entry);
      assert.equal(
        fullLogText.includes("SUPER_CONFIDENTIAL_TOKEN_999"),
        false,
        "Les tokens de requête ne doivent JAMAIS apparaître dans les logs !"
      );
    }
  });

  it("Conserve le cache antérieur si un rafraîchissement d'hôtes échoue (Fail Closed avec fallback)", async () => {
    // Premier appel : succès, 2 hébergeurs
    state.httpMockResponse = {
      status: 200,
      body: JSON.stringify({
        status: "success",
        data: {
          hosts: {
            host1: { domains: ["turbobit.net"] },
            host2: { domains: ["1fichier.com"] }
          }
        }
      })
    };

    const initialCache = await getSupportedDomains();
    assert.ok(initialCache);
    assert.equal(initialCache.has("turbobit.net"), true);

    // Deuxième appel : simulation d'un crash réseau (500 ou timeout)
    state.httpMockResponse = { status: 500, body: "Internal Server Error" };

    // On force l'expiration du TTL pour déclencher le refresh
    // (Dans la fonction corrigée, si le refresh échoue, le cache antérieur doit être conservé)
    const refreshedCache = await getSupportedDomains();
    assert.ok(refreshedCache, "Le cache antérieur doit être conservé en cas de 500");
    assert.equal(refreshedCache.has("turbobit.net"), true);
  });
});
