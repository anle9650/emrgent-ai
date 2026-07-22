"use client";

import type { ReactNode } from "react";
import type { A2UIComponent } from "@/lib/ai/a2ui/schema";
import {
  A2UIAppointmentsCard,
  A2UIEncountersCard,
  A2UIMedicalIssuesCard,
  A2UIPatientsCard,
  A2UIReferralCard,
  A2UISoapNoteCard,
  A2UIViewChartCard,
} from "./domain-cards";
import {
  A2Badge,
  A2Card,
  A2Column,
  A2Divider,
  A2List,
  A2ListItem,
  A2Row,
  A2RowItem,
  A2Stat,
  A2Table,
  A2Text,
  UnavailableChip,
} from "./primitives";
import { formatValue, getPath, resolveBinding } from "./resolve";

export type A2UIRenderContext = {
  dataModel: Record<string, unknown> | undefined;
  renderChild: (id: string) => ReactNode;
};

type NodeOf<K extends A2UIComponent["component"]> = Extract<
  A2UIComponent,
  { component: K }
>;

type Registry = {
  [K in A2UIComponent["component"]]: (
    node: NodeOf<K>,
    ctx: A2UIRenderContext
  ) => ReactNode;
};

// Catalog name -> renderer. New catalog entries are added here, in the zod
// union in lib/ai/a2ui/schema.ts, and in A2UI_CATALOG_PROMPT alongside it.
export const A2UI_REGISTRY: Registry = {
  Card: (node, ctx) => (
    <A2Card accent={node.accent} title={node.title}>
      {node.children.map((id) => ctx.renderChild(id))}
    </A2Card>
  ),
  Row: (node, ctx) => (
    <A2Row gap={node.gap}>
      {node.children.map((id) => (
        <A2RowItem key={id}>{ctx.renderChild(id)}</A2RowItem>
      ))}
    </A2Row>
  ),
  Column: (node, ctx) => (
    <A2Column gap={node.gap}>
      {node.children.map((id) => ctx.renderChild(id))}
    </A2Column>
  ),
  List: (node, ctx) => (
    <A2List>
      {node.children.map((id) => (
        <A2ListItem key={id}>{ctx.renderChild(id)}</A2ListItem>
      ))}
    </A2List>
  ),
  Divider: () => <A2Divider />,
  Text: (node, ctx) => (
    <A2Text variant={node.variant}>
      {formatValue(resolveBinding(node.text, ctx.dataModel))}
    </A2Text>
  ),
  Stat: (node, ctx) => (
    <A2Stat
      delta={
        node.delta === undefined
          ? undefined
          : formatValue(resolveBinding(node.delta, ctx.dataModel))
      }
      label={node.label}
      tone={node.tone}
      unit={node.unit}
      value={formatValue(resolveBinding(node.value, ctx.dataModel))}
    />
  ),
  Table: (node, ctx) => {
    const rows = getPath(ctx.dataModel, node.rowsPath);
    if (!Array.isArray(rows)) {
      return <UnavailableChip reason={`no table rows at ${node.rowsPath}`} />;
    }
    return <A2Table columns={node.columns} rows={rows} />;
  },
  Badge: (node) => <A2Badge text={node.text} tone={node.tone} />,
  PatientsCard: (node) => <A2UIPatientsCard node={node} />,
  EncountersCard: (node) => <A2UIEncountersCard node={node} />,
  AppointmentsCard: (node) => <A2UIAppointmentsCard node={node} />,
  MedicalIssuesCard: (node) => <A2UIMedicalIssuesCard node={node} />,
  SoapNoteCard: (node) => <A2UISoapNoteCard node={node} />,
  ViewChartCard: (node) => <A2UIViewChartCard node={node} />,
  ReferralCard: (node) => <A2UIReferralCard node={node} />,
};
