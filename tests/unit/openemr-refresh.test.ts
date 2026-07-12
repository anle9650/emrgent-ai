import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  clearOpenEmrRefreshCacheForTests,
  refreshOpenEmrTokens,
} from "@/lib/openemr/refresh";

const originalFetch = globalThis.fetch;

type FetchStub = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

let fetchCalls: { body: URLSearchParams }[] = [];

function stubFetch(handler: (call: number) => Promise<Response> | Response) {
  globalThis.fetch = ((_input, init) => {
    fetchCalls.push({
      body: new URLSearchParams(String(init?.body)),
    });
    return Promise.resolve(handler(fetchCalls.length));
  }) as FetchStub as typeof fetch;
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      scope: "openid",
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("refreshOpenEmrTokens", () => {
  beforeEach(() => {
    clearOpenEmrRefreshCacheForTests();
    fetchCalls = [];
    process.env.OPENEMR_ISSUER = "https://openemr.test/oauth2/default";
    process.env.OPENEMR_CLIENT_ID = "client";
    process.env.OPENEMR_CLIENT_SECRET = "secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("exchanges a refresh token and rotates it", async () => {
    stubFetch(() => tokenResponse());

    const result = await refreshOpenEmrTokens("old-refresh");

    assert.equal(result.status, "refreshed");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.get("grant_type"), "refresh_token");
    assert.equal(fetchCalls[0].body.get("refresh_token"), "old-refresh");
    if (result.status === "refreshed") {
      assert.equal(result.tokens.accessToken, "new-access");
      assert.equal(result.tokens.refreshToken, "new-refresh");
      assert.ok((result.tokens.expiresAt ?? 0) > Math.floor(Date.now() / 1000));
    }
  });

  test("keeps the old refresh token when none is returned", async () => {
    stubFetch(() => tokenResponse({ refresh_token: undefined }));

    const result = await refreshOpenEmrTokens("old-refresh");

    assert.equal(result.status, "refreshed");
    if (result.status === "refreshed") {
      assert.equal(result.tokens.refreshToken, "old-refresh");
    }
  });

  test("concurrent calls with the same token share one request", async () => {
    stubFetch(() => tokenResponse());

    const [a, b] = await Promise.all([
      refreshOpenEmrTokens("old-refresh"),
      refreshOpenEmrTokens("old-refresh"),
    ]);

    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(a, b);
  });

  test("a later call with the consumed token gets the memoized rotation", async () => {
    stubFetch(() => tokenResponse());

    const first = await refreshOpenEmrTokens("old-refresh");
    // Simulates a request still holding the stale cookie after rotation: a
    // real second exchange would fail (OpenEMR revoked "old-refresh").
    const second = await refreshOpenEmrTokens("old-refresh");

    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(second, first);
  });

  test("different refresh tokens do not share cache entries", async () => {
    stubFetch(() => tokenResponse());

    await refreshOpenEmrTokens("token-a");
    await refreshOpenEmrTokens("token-b");

    assert.equal(fetchCalls.length, 2);
  });

  test("a rejected refresh token reports expired and is briefly memoized", async () => {
    stubFetch(() => new Response('{"error":"invalid_grant"}', { status: 400 }));

    const first = await refreshOpenEmrTokens("revoked");
    const second = await refreshOpenEmrTokens("revoked");

    assert.equal(first.status, "expired");
    assert.equal(second.status, "expired");
    assert.equal(fetchCalls.length, 1);
  });

  test("a network failure reports unavailable and is retried next call", async () => {
    globalThis.fetch = (() => {
      fetchCalls.push({ body: new URLSearchParams() });
      return Promise.reject(new TypeError("fetch failed"));
    }) as FetchStub as typeof fetch;

    const first = await refreshOpenEmrTokens("old-refresh");
    assert.equal(first.status, "unavailable");

    stubFetch(() => tokenResponse());
    const second = await refreshOpenEmrTokens("old-refresh");

    assert.equal(second.status, "refreshed");
    assert.equal(fetchCalls.length, 2);
  });

  test("a malformed token response reports unavailable", async () => {
    stubFetch(
      () => new Response("<html>gateway error</html>", { status: 200 })
    );

    const result = await refreshOpenEmrTokens("old-refresh");

    assert.equal(result.status, "unavailable");
  });
});
