import { z } from "zod";

// An A2UI-inspired dialect (https://a2ui.org, v0.9): one `generateUI` call
// carries what A2UI splits across `beginRendering` + `surfaceUpdate` +
// `dataModelUpdate` JSONL messages, and component props are flattened from
// A2UI's `{id, component: {Card: {...}}}` nesting to `{id, component: "Card",
// ...props}` — friendlier to a tool-call discriminated union. The surface
// model is the same: a flat component list referencing children by id, plus a
// data model bound via JSON-pointer paths. Migrating to a spec-compliant
// renderer later is a mechanical transform.

const componentId = z.string().min(1).max(64);

// A prop is either a literal or a JSON-pointer path into `dataModel`
// (e.g. { path: "/comparison/bpDelta" }).
const binding = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.object({ path: z.string() }),
]);

const tone = z.enum(["neutral", "positive", "warning", "critical"]);

// Domain cards render a prior data tool's output verbatim — the model points
// at the tool call instead of transcribing clinical values. Maps each card to
// the tool part types it may source from; enforced server-side in the
// generateUI tool and again client-side by the renderer.
export const DOMAIN_CARD_SOURCES = {
  PatientsCard: ["tool-searchPatients"],
  EncountersCard: ["tool-getEncounters"],
  AppointmentsCard: ["tool-getAppointments"],
  MedicalIssuesCard: [
    "tool-getMedicalProblems",
    "tool-getMedications",
    "tool-getSurgeries",
  ],
  SoapNoteCard: ["tool-getSoapNote"],
} as const;

export type DomainCardName = keyof typeof DOMAIN_CARD_SOURCES;

const sourceToolCallId = z
  .string()
  .describe(
    "Copied verbatim from the `sourceToolCallId` field of a data tool's result."
  );

export const componentSchema = z.discriminatedUnion("component", [
  // -- Layout primitives -----------------------------------------------------
  z.object({
    id: componentId,
    component: z.literal("Card"),
    children: z.array(componentId),
    title: z.string().optional(),
    accent: tone.optional(),
  }),
  z.object({
    id: componentId,
    component: z.literal("Row"),
    children: z.array(componentId),
    gap: z.enum(["sm", "md", "lg"]).optional(),
  }),
  z.object({
    id: componentId,
    component: z.literal("Column"),
    children: z.array(componentId),
    gap: z.enum(["sm", "md", "lg"]).optional(),
  }),
  z.object({
    id: componentId,
    component: z.literal("List"),
    children: z.array(componentId),
  }),
  z.object({ id: componentId, component: z.literal("Divider") }),
  // -- Content primitives (literals or dataModel bindings) --------------------
  z.object({
    id: componentId,
    component: z.literal("Text"),
    text: binding,
    variant: z.enum(["heading", "body", "muted", "label"]).optional(),
  }),
  z.object({
    id: componentId,
    component: z.literal("Stat"),
    label: z.string(),
    value: binding,
    unit: z.string().optional(),
    delta: binding.optional(),
    tone: tone.optional(),
  }),
  z.object({
    id: componentId,
    component: z.literal("Table"),
    columns: z
      .array(z.object({ header: z.string(), path: z.string() }))
      .min(1)
      .max(8),
    rowsPath: z
      .string()
      .describe(
        "JSON pointer to an array of row objects in dataModel; column `path`s resolve within each row."
      ),
  }),
  z.object({
    id: componentId,
    component: z.literal("Badge"),
    text: z.string(),
    tone: tone.optional(),
  }),
  // -- Domain cards (render prior tool output verbatim) -----------------------
  z.object({
    id: componentId,
    component: z.literal("PatientsCard"),
    sourceToolCallId,
    uuids: z
      .array(z.string())
      .optional()
      .describe("Subset of patient `uuid`s to show; omit for all."),
  }),
  z.object({
    id: componentId,
    component: z.literal("EncountersCard"),
    sourceToolCallId,
    eids: z
      .array(z.number())
      .optional()
      .describe("Subset of encounter `eid`s to show; omit for all."),
  }),
  z.object({
    id: componentId,
    component: z.literal("AppointmentsCard"),
    sourceToolCallId,
  }),
  z.object({
    id: componentId,
    component: z.literal("MedicalIssuesCard"),
    sourceToolCallId,
  }),
  z.object({
    id: componentId,
    component: z.literal("SoapNoteCard"),
    sourceToolCallId,
  }),
]);

export type A2UIComponent = z.infer<typeof componentSchema>;

export const generateUiInputSchema = z.object({
  root: componentId.describe("`id` of the root component."),
  components: z.array(componentSchema).min(1).max(64),
  dataModel: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      "Values referenced by `path` bindings. Derived/computed values only — never copy patient record fields here; use domain cards for those."
    ),
});

export type A2UISpec = z.infer<typeof generateUiInputSchema>;

export const MAX_TREE_DEPTH = 16;

// Structural checks zod can't express: id uniqueness, ref resolution, and
// that the tree hangs together from `root` without cycles or runaway depth.
// Returns human-readable errors for the model to self-correct on.
export function validateSurface(spec: A2UISpec): string[] {
  const errors: string[] = [];
  const byId = new Map<string, A2UIComponent>();

  for (const component of spec.components) {
    if (byId.has(component.id)) {
      errors.push(`Duplicate component id "${component.id}".`);
    }
    byId.set(component.id, component);
  }

  if (!byId.has(spec.root)) {
    errors.push(`Root id "${spec.root}" is not in \`components\`.`);
    return errors;
  }

  const visited = new Set<string>();
  const walk = (id: string, depth: number, path: Set<string>) => {
    if (depth > MAX_TREE_DEPTH) {
      errors.push(`Tree exceeds max depth of ${MAX_TREE_DEPTH}.`);
      return;
    }
    if (path.has(id)) {
      errors.push(`Cycle detected at component "${id}".`);
      return;
    }
    visited.add(id);
    const node = byId.get(id);
    if (!node || !("children" in node)) {
      return;
    }
    for (const childId of node.children) {
      if (byId.get(childId)) {
        walk(childId, depth + 1, new Set(path).add(id));
      } else {
        errors.push(`Component "${id}" references unknown child "${childId}".`);
      }
    }
  };
  walk(spec.root, 0, new Set());

  for (const id of byId.keys()) {
    if (!visited.has(id)) {
      errors.push(`Component "${id}" is not reachable from root.`);
    }
  }

  return errors;
}

// Catalog reference injected into the system prompt — kept beside the schema
// so the two can't drift.
export const A2UI_CATALOG_PROMPT = `\
Layout: Card {title?, accent?, children} · Row {children, gap?} · Column {children, gap?} · List {children} · Divider {}
Content: Text {text, variant?: heading|body|muted|label} · Stat {label, value, unit?, delta?, tone?} · Table {columns: [{header, path}], rowsPath} · Badge {text, tone?}
Tones: neutral | positive | warning | critical
Domain cards (render a data tool's results verbatim; bind by copying the \`sourceToolCallId\` field from that tool's result):
- PatientsCard {sourceToolCallId, uuids?} — from searchPatients
- EncountersCard {sourceToolCallId, eids?} — from getEncounters (includes SOAP note + vitals per encounter)
- AppointmentsCard {sourceToolCallId} — from getAppointments
- MedicalIssuesCard {sourceToolCallId} — from getMedicalProblems / getMedications / getSurgeries
- SoapNoteCard {sourceToolCallId} — from getSoapNote`;
