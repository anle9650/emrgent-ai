"use client";

import { Component, Fragment, type ReactNode } from "react";
import {
  type A2UIComponent,
  type A2UISpec,
  MAX_TREE_DEPTH,
} from "@/lib/ai/a2ui/schema";
import { A2UI_REGISTRY, type A2UIRenderContext } from "./registry";

// Belt-and-braces guards: the generateUI tool validates the surface
// server-side, but specs also arrive from persisted history, so the renderer
// re-guards depth, cycles, and unknown references — all fail-soft.
function renderNode(
  id: string,
  byId: Map<string, A2UIComponent>,
  dataModel: A2UISpec["dataModel"],
  depth: number,
  path: ReadonlySet<string>
): ReactNode {
  const node = byId.get(id);
  if (!node || depth > MAX_TREE_DEPTH || path.has(id)) {
    return null;
  }

  const renderer = A2UI_REGISTRY[node.component] as (
    n: A2UIComponent,
    ctx: A2UIRenderContext
  ) => ReactNode;
  if (!renderer) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`A2UI: unknown component "${node.component}"`);
    }
    return null;
  }

  const childPath = new Set(path).add(id);
  return renderer(node, {
    dataModel,
    renderChild: (childId) => (
      <Fragment key={childId}>
        {renderNode(childId, byId, dataModel, depth + 1, childPath)}
      </Fragment>
    ),
  });
}

// A malformed persisted spec (or a renderer bug) should degrade to a quiet
// notice with the raw spec inspectable, never take down the message list.
// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require a class component.
class A2UIErrorBoundary extends Component<
  { spec: A2UISpec; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="rounded-xl border border-border/50 bg-card px-3.5 py-3 shadow-(--shadow-card)">
        <div className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          Couldn't render this view
        </div>
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Raw spec</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(this.props.spec, null, 2)}
          </pre>
        </details>
      </div>
    );
  }
}

export function A2UIView({ spec }: { spec: A2UISpec }) {
  const byId = new Map(spec.components.map((node) => [node.id, node]));

  return (
    <A2UIErrorBoundary spec={spec}>
      <div className="w-full" data-testid="a2ui-surface">
        {renderNode(spec.root, byId, spec.dataModel, 0, new Set())}
      </div>
    </A2UIErrorBoundary>
  );
}
