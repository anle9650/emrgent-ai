/**
 * NUCC taxonomy normalization for the NPI Registry provider search.
 *
 * `search_individual_providers`' `taxonomy_description` is validated against the
 * fixed NUCC taxonomy vocabulary, whose display names diverge from everyday
 * clinical terms in two ways the model reliably gets wrong:
 *
 *   - Spelling: NUCC uses "Orthopaedic Surgery", not "Orthopedic Surgery".
 *   - Vocabulary: the canonical name isn't the colloquial one — "Cardiology" is
 *     "Cardiovascular Disease", "ENT" is "Otolaryngology", "GI" is
 *     "Gastroenterology".
 *
 * So this can't be fixed by asking the model to spell better — it often doesn't
 * know the canonical token exists. Instead we snap whatever it passes to a
 * canonical NUCC display name deterministically, before the search runs. Shared
 * by the production MCP wrapper (`merge.ts`) and the eval stub (`agent.ts`) so
 * both behave identically.
 */

// Canonical NUCC display names for the specialties clinicians actually refer
// to. Not the full ~870-row NUCC set — just the physician taxonomies that come
// up in referrals. Matched by normalized key, so spelling variants (American
// vs. NUCC "ae") resolve here without a separate alias entry.
const CANONICAL_TAXONOMIES = [
  "Allergy & Immunology",
  "Anesthesiology",
  "Cardiovascular Disease",
  "Dermatology",
  "Endocrinology, Diabetes & Metabolism",
  "Family Medicine",
  "Gastroenterology",
  "General Surgery",
  "Hematology & Oncology",
  "Infectious Disease",
  "Internal Medicine",
  "Medical Oncology",
  "Nephrology",
  "Neurological Surgery",
  "Neurology",
  "Obstetrics & Gynecology",
  "Ophthalmology",
  "Orthopaedic Surgery",
  "Otolaryngology",
  "Pain Medicine",
  "Pediatrics",
  "Physical Medicine & Rehabilitation",
  "Plastic Surgery",
  "Podiatry",
  "Psychiatry",
  "Pulmonary Disease",
  "Rheumatology",
  "Sleep Medicine",
  "Urology",
  "Vascular Surgery",
] as const;

// Colloquial term (normalized key) -> canonical display name, for the semantic
// gaps where the everyday word isn't a spelling variant of the NUCC name.
const TAXONOMY_ALIASES: Record<string, string> = {
  allergist: "Allergy & Immunology",
  allergy: "Allergy & Immunology",
  immunology: "Allergy & Immunology",
  cardiac: "Cardiovascular Disease",
  cardiology: "Cardiovascular Disease",
  cardiologist: "Cardiovascular Disease",
  heart: "Cardiovascular Disease",
  derm: "Dermatology",
  dermatologist: "Dermatology",
  endocrine: "Endocrinology, Diabetes & Metabolism",
  endocrinology: "Endocrinology, Diabetes & Metabolism",
  endocrinologist: "Endocrinology, Diabetes & Metabolism",
  ent: "Otolaryngology",
  "ear nose and throat": "Otolaryngology",
  "ear nose throat": "Otolaryngology",
  gi: "Gastroenterology",
  gastrointestinal: "Gastroenterology",
  gastroenterologist: "Gastroenterology",
  hematology: "Hematology & Oncology",
  hematologist: "Hematology & Oncology",
  cancer: "Medical Oncology",
  oncology: "Medical Oncology",
  oncologist: "Medical Oncology",
  kidney: "Nephrology",
  nephrologist: "Nephrology",
  neurosurgery: "Neurological Surgery",
  neurosurgeon: "Neurological Surgery",
  neurologist: "Neurology",
  obgyn: "Obstetrics & Gynecology",
  "ob gyn": "Obstetrics & Gynecology",
  "obstetrics and gynecology": "Obstetrics & Gynecology",
  "obstetrics gynecology": "Obstetrics & Gynecology",
  eye: "Ophthalmology",
  ophthalmologist: "Ophthalmology",
  ortho: "Orthopaedic Surgery",
  orthopedics: "Orthopaedic Surgery",
  orthopedic: "Orthopaedic Surgery",
  "orthopedic surgery": "Orthopaedic Surgery",
  orthopaedics: "Orthopaedic Surgery",
  "orthopaedic surgeon": "Orthopaedic Surgery",
  "orthopedic surgeon": "Orthopaedic Surgery",
  otolaryngologist: "Otolaryngology",
  pain: "Pain Medicine",
  physiatry: "Physical Medicine & Rehabilitation",
  physiatrist: "Physical Medicine & Rehabilitation",
  "pm r": "Physical Medicine & Rehabilitation",
  rehab: "Physical Medicine & Rehabilitation",
  "plastic surgeon": "Plastic Surgery",
  podiatrist: "Podiatry",
  foot: "Podiatry",
  psych: "Psychiatry",
  psychiatrist: "Psychiatry",
  pulmonology: "Pulmonary Disease",
  pulmonary: "Pulmonary Disease",
  pulmonologist: "Pulmonary Disease",
  lung: "Pulmonary Disease",
  rheumatologist: "Rheumatology",
  urologist: "Urology",
  "vascular surgeon": "Vascular Surgery",
};

/**
 * Normalize a taxonomy term to a comparison key: lowercase, fold NUCC "ae" to
 * "e" (Orthopaedic -> orthopedic), "&" to "and", and reduce everything else to
 * single-spaced alphanumerics. Both the canonical names and model input pass
 * through this, so American/NUCC spelling differences collapse to one key.
 */
function normKey(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ae", "e")
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CANONICAL_BY_KEY = new Map<string, string>(
  CANONICAL_TAXONOMIES.map((name) => [normKey(name), name])
);

/**
 * Snap a model-supplied `taxonomy_description` to a canonical NUCC display name.
 *
 * Returns `undefined` for empty/nullish input (the caller should omit the
 * param). A value already containing a wildcard `*` is left untouched — that's a
 * deliberate partial-match the model asked for. Otherwise: exact canonical
 * match (spelling variants included via `normKey`), then the colloquial alias
 * map, then a unique prefix match (e.g. "orthopedic" -> "Orthopaedic Surgery").
 * Anything still unresolved is returned trimmed as-is, so unknown specialties
 * behave no worse than before.
 */
export function canonicalTaxonomyDescription(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return;
  }
  if (trimmed.includes("*")) {
    return trimmed;
  }

  const key = normKey(trimmed);

  const exact = CANONICAL_BY_KEY.get(key);
  if (exact) {
    return exact;
  }

  const alias = TAXONOMY_ALIASES[key];
  if (alias) {
    return alias;
  }

  // Unique prefix match, so a partial like "orthopedic" (no "surgery") still
  // resolves. Require >= 4 chars and exactly one candidate to avoid guessing.
  if (key.length >= 4) {
    const prefixHits: string[] = [];
    for (const [canonicalKey, name] of CANONICAL_BY_KEY) {
      if (canonicalKey.startsWith(key) || key.startsWith(canonicalKey)) {
        prefixHits.push(name);
      }
    }
    if (prefixHits.length === 1) {
      return prefixHits[0];
    }
  }

  return trimmed;
}

/**
 * Apply {@link canonicalTaxonomyDescription} to a `search_individual_providers`
 * argument object, returning a shallow copy with `taxonomy_description`
 * corrected (or removed when it normalizes to nothing). Other params pass
 * through untouched.
 */
export function normalizeProviderSearchArgs<T extends Record<string, unknown>>(
  args: T
): T {
  if (!("taxonomy_description" in args)) {
    return args;
  }
  const canonical = canonicalTaxonomyDescription(args.taxonomy_description);
  // Drop the key entirely when it normalizes to nothing (omitting is what the
  // validator wants), rather than passing an explicit `undefined`.
  const { taxonomy_description: _omit, ...rest } = args;
  return (
    canonical === undefined
      ? rest
      : { ...rest, taxonomy_description: canonical }
  ) as T;
}
