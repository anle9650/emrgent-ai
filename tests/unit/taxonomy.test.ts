import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canonicalTaxonomyDescription,
  normalizeProviderSearchArgs,
} from "@/lib/ai/mcp/taxonomy";

describe("canonicalTaxonomyDescription", () => {
  test("fixes American spelling to the NUCC 'ae' form", () => {
    assert.equal(
      canonicalTaxonomyDescription("Orthopedic Surgery"),
      "Orthopaedic Surgery"
    );
  });

  test("maps colloquial specialty names to their canonical NUCC name", () => {
    assert.equal(
      canonicalTaxonomyDescription("Cardiology"),
      "Cardiovascular Disease"
    );
    assert.equal(canonicalTaxonomyDescription("ENT"), "Otolaryngology");
    assert.equal(canonicalTaxonomyDescription("GI"), "Gastroenterology");
    assert.equal(
      canonicalTaxonomyDescription("OB/GYN"),
      "Obstetrics & Gynecology"
    );
    assert.equal(
      canonicalTaxonomyDescription("Endocrinology"),
      "Endocrinology, Diabetes & Metabolism"
    );
  });

  test("is case- and punctuation-insensitive", () => {
    assert.equal(canonicalTaxonomyDescription("dermatology"), "Dermatology");
    assert.equal(
      canonicalTaxonomyDescription("obstetrics and gynecology"),
      "Obstetrics & Gynecology"
    );
  });

  test("resolves a unique prefix to the full canonical name", () => {
    assert.equal(
      canonicalTaxonomyDescription("orthopedic"),
      "Orthopaedic Surgery"
    );
  });

  test("passes an already-canonical name through unchanged", () => {
    assert.equal(canonicalTaxonomyDescription("Neurology"), "Neurology");
    assert.equal(
      canonicalTaxonomyDescription("Orthopaedic Surgery"),
      "Orthopaedic Surgery"
    );
  });

  test("leaves a deliberate wildcard untouched", () => {
    assert.equal(canonicalTaxonomyDescription("Ortho*"), "Ortho*");
  });

  test("returns an unknown specialty trimmed, no worse than before", () => {
    assert.equal(
      canonicalTaxonomyDescription("  Astrophysics  "),
      "Astrophysics"
    );
  });

  test("treats empty/nullish as omit", () => {
    assert.equal(canonicalTaxonomyDescription(""), undefined);
    assert.equal(canonicalTaxonomyDescription("   "), undefined);
    assert.equal(canonicalTaxonomyDescription(null), undefined);
    assert.equal(canonicalTaxonomyDescription(undefined), undefined);
  });
});

describe("normalizeProviderSearchArgs", () => {
  test("corrects taxonomy_description in place, leaving other params alone", () => {
    const out = normalizeProviderSearchArgs({
      last_name: "Muldrow",
      taxonomy_description: "Orthopedic Surgery",
      state: "CA",
    });
    assert.deepEqual(out, {
      last_name: "Muldrow",
      taxonomy_description: "Orthopaedic Surgery",
      state: "CA",
    });
  });

  test("drops taxonomy_description when it normalizes to nothing", () => {
    const out = normalizeProviderSearchArgs({
      last_name: "Muldrow",
      taxonomy_description: "",
    });
    assert.deepEqual(out, { last_name: "Muldrow" });
  });

  test("is a no-op when taxonomy_description is absent", () => {
    const input = { first_name: "Alex", last_name: "Rivera" };
    assert.deepEqual(normalizeProviderSearchArgs(input), input);
  });
});
