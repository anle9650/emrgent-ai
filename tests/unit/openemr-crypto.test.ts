import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { decryptSecret, encryptSecret } from "@/lib/openemr/crypto";

// crypto.ts derives its key from AUTH_SECRET. Set a stable one for the suite.
const ORIGINAL_SECRET = process.env.AUTH_SECRET;

describe("openemr crypto", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-value";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      process.env.AUTH_SECRET = undefined;
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = ORIGINAL_SECRET;
    }
  });

  test("round-trips a secret", () => {
    const plaintext = "super-secret-client-value-123";
    assert.equal(decryptSecret(encryptSecret(plaintext)), plaintext);
  });

  test("uses a fresh IV so the same input yields different ciphertext", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), "same");
    assert.equal(decryptSecret(b), "same");
  });

  test("a tampered envelope fails GCM authentication", () => {
    const envelope = encryptSecret("secret");
    const bytes = Buffer.from(envelope, "base64");
    // Flip a bit in the ciphertext region (past iv + auth tag).
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = bytes.toString("base64");
    assert.throws(() => decryptSecret(tampered));
  });

  test("a value encrypted under a different secret does not decrypt", () => {
    const envelope = encryptSecret("secret");
    process.env.AUTH_SECRET = "a-different-secret";
    assert.throws(() => decryptSecret(envelope));
  });

  test("throws when AUTH_SECRET is unset", () => {
    process.env.AUTH_SECRET = undefined;
    delete process.env.AUTH_SECRET;
    assert.throws(() => encryptSecret("secret"), /AUTH_SECRET/);
  });
});
