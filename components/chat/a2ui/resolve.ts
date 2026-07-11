// JSON-pointer resolution (RFC 6901-ish, tolerant of a missing leading
// slash) for A2UI `path` bindings. Returns undefined when any segment is
// absent — callers render fail-soft.
export function getPath(data: unknown, pointer: string): unknown {
  const segments = pointer
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current: unknown = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return;
    }
  }
  return current;
}

type Binding = string | number | boolean | { path: string };

// A binding is either a literal or a pointer into the spec's dataModel.
export function resolveBinding(
  binding: Binding,
  dataModel: Record<string, unknown> | undefined
): unknown {
  if (typeof binding === "object" && binding !== null) {
    return getPath(dataModel, binding.path);
  }
  return binding;
}

// Render-ready scalar for a resolved binding; "—" for anything unresolvable.
export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "—";
}
