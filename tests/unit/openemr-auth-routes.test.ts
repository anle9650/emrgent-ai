import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { needsOpenEmrProvider } from "@/lib/openemr/auth-routes";

describe("needsOpenEmrProvider", () => {
  test("builds the provider on the routes the OAuth flow needs", () => {
    // /providers is the regression: signIn("openemr") checks the provider list
    // here first, so the provider must be present or the flow never starts.
    assert.equal(needsOpenEmrProvider("/api/auth/providers"), true);
    assert.equal(needsOpenEmrProvider("/api/auth/signin/openemr"), true);
    assert.equal(needsOpenEmrProvider("/api/auth/callback/openemr"), true);
  });

  test("skips the provider on the hot path and unrelated auth routes", () => {
    // These must NOT trigger the cookie decode + DB read the provider needs.
    for (const path of [
      "/",
      "/chat/abc",
      "/settings/openemr",
      "/api/chat",
      "/api/auth/session",
      "/api/auth/csrf",
      "/api/auth/signin", // the generic sign-in page, not the openemr start
      "/api/auth/signin/credentials",
      "/api/auth/callback/credentials",
    ]) {
      assert.equal(needsOpenEmrProvider(path), false, path);
    }
  });
});
