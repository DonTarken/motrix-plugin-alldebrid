import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  shouldSkip,
  extractHostname,
  isSupportedHost,
  unlockLink,
  getSupportedDomains,
  resetHostsCache
} from "../src/index.js";
import { state, resetMockState } from "./mock-api.mjs";

describe("Strict Hostname Parsing & Exclusions (shouldSkip)", () => {
  it("excludes AllDebrid domains and subdomains", () => {
    assert.equal(shouldSkip("https://alldebrid.com/download/file.zip"), true);
    assert.equal(shouldSkip("https://api.alldebrid.com/v4/endpoint"), true);
    assert.equal(shouldSkip("https://debrid.it/dl/123/file.mkv"), true);
    assert.equal(shouldSkip("https://sub.alldeb.ovh/test"), true);
  });

  it("excludes local addresses, loopback, and IPv6 (with or without ports)", () => {
    assert.equal(shouldSkip("http://localhost/test"), true);
    assert.equal(shouldSkip("http://localhost:8080/file.iso"), true);
    assert.equal(shouldSkip("http://127.0.0.1/test"), true);
    assert.equal(shouldSkip("http://127.0.0.1:3000/api"), true);
    assert.equal(shouldSkip("http://[::1]/download"), true);
    assert.equal(shouldSkip("http://[::1]:8080/file"), true);
  });

  it("handles user credentials in URL (user:pass@host)", () => {
    assert.equal(shouldSkip("http://user:pass@localhost:8080/file"), true);
    assert.equal(shouldSkip("https://john:secret@alldebrid.com/file"), true);
    assert.equal(shouldSkip("https://john:secret@rapidgator.net/file"), false);
  });

  it("does not block false positives where keywords appear in path", () => {
    assert.equal(shouldSkip("https://upstream.com/files/localhost.tar.gz"), false);
    assert.equal(shouldSkip("https://archive.org/data/alldebrid.com_mirror.iso"), false);
    assert.equal(shouldSkip("https://downloads.example.org/127.0.0.1/report.pdf"), false);
  });

  it("does not block false positives where keywords appear in query string", () => {
    assert.equal(shouldSkip("https://rapidgator.net/file/123?ref=alldebrid.com"), false);
    assert.equal(shouldSkip("https://turbobit.net/dl?source=localhost&redirect=1"), false);
    assert.equal(shouldSkip("https://1fichier.com/?token=alldeb.ovh"), false);
  });

  it("does not block deceptive lookalike domains", () => {
    assert.equal(shouldSkip("https://fake-alldebrid.com/file.zip"), false);
    assert.equal(shouldSkip("https://alldebrid.com.attacker.net/payload"), false);
    assert.equal(shouldSkip("https://notlocalhost.org/file"), false);
  });
});

describe("Fail-Closed Policy & Host Validation (isSupportedHost)", () => {
  const sampleDomains = new Set(["rapidgator.net", "turbobit.net", "1fichier.com"]);

  it("fails closed: returns false when host list is missing or empty", () => {
    assert.equal(isSupportedHost("https://rapidgator.net/file/1", null), false);
    assert.equal(isSupportedHost("https://rapidgator.net/file/1", undefined), false);
    assert.equal(isSupportedHost("https://rapidgator.net/file/1", new Set()), false);
  });

  it("returns true for supported hosts (exact and legitimate subdomains)", () => {
    assert.equal(isSupportedHost("https://rapidgator.net/file/123", sampleDomains), true);
    assert.equal(isSupportedHost("https://dl.rapidgator.net/file/123", sampleDomains), true);
    assert.equal(isSupportedHost("https://sub.sub.1fichier.com/test", sampleDomains), true);
  });

  it("returns false for unsupported hosts and lookalikes", () => {
    assert.equal(isSupportedHost("https://google.com/file", sampleDomains), false);
    assert.equal(isSupportedHost("https://rapidgator.net.evil.org/file", sampleDomains), false);
    assert.equal(isSupportedHost("https://fakerapidgator.net/file", sampleDomains), false);
  });

  it("ensures unsupported URLs are never sent to /link/unlock and leave downloads unchanged", async () => {
    resetMockState();
    state.configStore.set("apiKey", "VALID_KEY_123");
    // Mock /hosts with only rapidgator
    state.httpMockResponse = {
      status: 200,
      body: JSON.stringify({
        status: "success",
        data: { hosts: { h1: { domains: ["rapidgator.net"] } } }
      })
    };

    const ctx = {
      type: "http",
      uris: ["https://private-server.org/confidential-archive.zip"],
      update: (patch) => { Object.assign(ctx, patch); }
    };

    const result = await state.beforeCreateHook(ctx);

    // Verify /link/unlock was NEVER called
    const unlockCalls = state.httpRequests.filter(r => r.url.includes("/link/unlock"));
    assert.equal(unlockCalls.length, 0, "Unsupported URL must NEVER be sent to /link/unlock!");
    assert.equal(result.uris[0], "https://private-server.org/confidential-archive.zip", "Original URL must remain untouched");
  });
});

describe("Network Security, Bearer Auth & Diagnostic Sanitization", () => {
  beforeEach(() => {
    resetMockState();
    resetHostsCache();
  });

  it("unlockLink uses Authorization: Bearer header and does not expose apikey in query", async () => {
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

    // Verify API key is absent from URL query
    assert.equal(req.url.includes("apikey="), false, "API key must NOT appear in URL query");
    assert.equal(req.url.includes(apiKey), false, "Secret token must not leak in query parameters");

    // Verify Authorization: Bearer header is present
    const authHeader = req.headers?.find(h => h.name.toLowerCase() === "authorization");
    assert.ok(authHeader, "Authorization header must be present");
    assert.equal(authHeader.value, `Bearer ${apiKey}`);
  });

  it("never leaks sensitive URLs or tokens in diagnostic logs", async () => {
    state.httpMockResponse = {
      status: 200,
      body: JSON.stringify({ status: "error", error: { code: "LINK_ERROR", message: "Failed" } })
    };

    const sensitiveUrl = "https://rapidgator.net/file/123?access_token=SUPER_CONFIDENTIAL_TOKEN_999";
    await unlockLink(sensitiveUrl, "TEST_API_KEY");

    // Verify all recorded logs
    for (const entry of state.logs) {
      const fullLogText = JSON.stringify(entry);
      assert.equal(
        fullLogText.includes("SUPER_CONFIDENTIAL_TOKEN_999"),
        false,
        "Query tokens must never appear in log entries"
      );
    }
  });

  it("retains previous cache if host refresh fails (fail-closed fallback)", async () => {
    // First call: successful response with 2 hosts
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

    // Second call: simulated network failure (500 or timeout) with forced refresh
    state.httpMockResponse = { status: 500, body: "Internal Server Error" };

    // Previous cache must be retained if refresh fails
    const refreshedCache = await getSupportedDomains(true);
    assert.ok(refreshedCache, "Previous cache must be preserved on HTTP 500");
    assert.equal(refreshedCache.has("turbobit.net"), true);
  });

  it("handles request timeouts when fetching hosts list without failing open", async () => {
    state.httpMockResponse = () => {
      const timeoutErr = new Error("Connection timed out after 8000ms");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    };
    const domains = await getSupportedDomains();
    assert.ok(domains === null || domains instanceof Set);
    assert.equal(isSupportedHost("https://unsupported-host.org/test", domains), false);
  });

  it("handles invalid JSON responses from /hosts gracefully without failing open", async () => {
    state.httpMockResponse = {
      status: 200,
      body: "<html>502 Bad Gateway - Not JSON</html>"
    };
    const domains = await getSupportedDomains();
    assert.ok(domains === null || domains instanceof Set);
    assert.equal(isSupportedHost("https://unsupported-host.org/test", domains), false);
  });
});
