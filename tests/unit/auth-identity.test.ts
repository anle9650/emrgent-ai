import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type AppIdentityUser, appIdentityFromUser } from "@/lib/auth-identity";

function appUser(overrides: Partial<AppIdentityUser> = {}): AppIdentityUser {
  return {
    id: "user-1",
    email: "clinician@emrgent.test",
    name: "A. Clinician",
    image: "https://emrgent.test/avatar.png",
    isAnonymous: false,
    ...overrides,
  };
}

describe("appIdentityFromUser", () => {
  test("keeps the app account's own email and name, not OpenEMR's", () => {
    const identity = appIdentityFromUser(appUser());

    assert.equal(identity?.id, "user-1");
    assert.equal(identity?.email, "clinician@emrgent.test");
    assert.equal(identity?.name, "A. Clinician");
    assert.equal(identity?.type, "regular");
  });

  test("returns null fields rather than omitting them, so a seeded OpenEMR profile value is overwritten", () => {
    const identity = appIdentityFromUser(
      appUser({ image: null, name: null })
    ) as Record<string, unknown>;

    // Presence matters as much as the value: the caller assigns these straight
    // onto a token Auth.js pre-filled from the OpenEMR profile, so a missing key
    // would silently leave the OpenEMR name/avatar in place.
    assert.ok("picture" in identity);
    assert.ok("name" in identity);
    assert.equal(identity.picture, null);
    assert.equal(identity.name, null);
  });

  test("does not promote a linking guest to a regular user", () => {
    const identity = appIdentityFromUser(
      appUser({ id: "guest-1", email: "guest-1754", isAnonymous: true })
    );

    assert.equal(identity?.type, "guest");
    assert.equal(identity?.id, "guest-1");
  });

  test("signals no prior identity when the row is missing", () => {
    // A stale session cookie can name a deleted user. The caller must fall
    // through to the OpenEMR email upsert instead of keying the session to an
    // id that no User row satisfies.
    assert.equal(appIdentityFromUser(null), null);
    assert.equal(appIdentityFromUser(undefined), null);
  });
});
