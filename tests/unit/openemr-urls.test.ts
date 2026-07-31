import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeCallbackUrl } from "@/lib/auth-callback";
import {
  buildOpenEmrRedirectUri,
  deriveOpenEmrUrls,
  OPENEMR_CALLBACK_PATH,
} from "@/lib/openemr/urls";

describe("buildOpenEmrRedirectUri", () => {
  test("builds from proto and host", () => {
    assert.equal(
      buildOpenEmrRedirectUri({ proto: "https", host: "emrgent.example.org" }),
      "https://emrgent.example.org/api/auth/callback/openemr"
    );
  });

  test("defaults to https when no proto header is present", () => {
    assert.equal(
      buildOpenEmrRedirectUri({ host: "emrgent.example.org" }),
      "https://emrgent.example.org/api/auth/callback/openemr"
    );
  });

  test("preserves a non-https proto for local dev", () => {
    assert.equal(
      buildOpenEmrRedirectUri({ proto: "http", host: "localhost:3000" }),
      "http://localhost:3000/api/auth/callback/openemr"
    );
  });

  test("takes the first hop of a forwarded proto chain", () => {
    assert.equal(
      buildOpenEmrRedirectUri({ proto: "https,http", host: "example.org" }),
      "https://example.org/api/auth/callback/openemr"
    );
  });

  test("prefixes a base path without doubling separators", () => {
    assert.equal(
      buildOpenEmrRedirectUri({
        proto: "https",
        host: "example.org",
        basePath: "/emrgent/",
      }),
      "https://example.org/emrgent/api/auth/callback/openemr"
    );
  });

  test("an explicit origin wins over the request headers", () => {
    assert.equal(
      buildOpenEmrRedirectUri({
        origin: "https://canonical.example.org",
        proto: "http",
        host: "internal.local",
      }),
      "https://canonical.example.org/api/auth/callback/openemr"
    );
  });

  test("takes only the origin from an AUTH_URL carrying a path", () => {
    assert.equal(
      buildOpenEmrRedirectUri({ origin: "https://example.org/api/auth" }),
      "https://example.org/api/auth/callback/openemr"
    );
  });

  test("returns null when there's nothing to build from", () => {
    assert.equal(buildOpenEmrRedirectUri({}), null);
    assert.equal(buildOpenEmrRedirectUri({ origin: "not-a-url" }), null);
  });

  test("the path matches the Auth.js provider id", () => {
    assert.equal(OPENEMR_CALLBACK_PATH, "/api/auth/callback/openemr");
  });
});

describe("deriveOpenEmrUrls", () => {
  test("appends the default-site paths", () => {
    assert.deepEqual(deriveOpenEmrUrls("https://localhost:9300"), {
      issuer: "https://localhost:9300/oauth2/default",
      apiBase: "https://localhost:9300/apis/default",
    });
  });

  test("preserves a subpath-hosted install", () => {
    assert.deepEqual(deriveOpenEmrUrls("https://host.example.org/openemr"), {
      issuer: "https://host.example.org/openemr/oauth2/default",
      apiBase: "https://host.example.org/openemr/apis/default",
    });
  });

  test("tolerates surrounding whitespace and trailing slashes", () => {
    // The settings form calls this on every keystroke of a URL the user is
    // still typing, so it has to survive mid-edit input.
    assert.deepEqual(
      deriveOpenEmrUrls("  https://openemr.example.org///  "),
      deriveOpenEmrUrls("https://openemr.example.org")
    );
  });
});

describe("sanitizeCallbackUrl", () => {
  test("keeps a same-origin absolute path", () => {
    assert.equal(sanitizeCallbackUrl("/settings/openemr"), "/settings/openemr");
  });

  test("rejects protocol-relative and absolute URLs", () => {
    assert.equal(sanitizeCallbackUrl("//evil.example"), "/");
    assert.equal(sanitizeCallbackUrl("https://evil.example"), "/");
  });

  test("falls back when absent", () => {
    assert.equal(sanitizeCallbackUrl(null), "/");
    assert.equal(sanitizeCallbackUrl(undefined), "/");
    assert.equal(sanitizeCallbackUrl(""), "/");
  });
});
