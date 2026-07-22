import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { generateUI } from "./ai/tools/generate-ui";
import type { getWeather } from "./ai/tools/get-weather";
import type {
  createAppointment,
  createEncounter,
  createMedicalProblem,
  createMedication,
  createSurgery,
  getAppointments,
  getEncounters,
  getMedicalProblems,
  getMedications,
  getNextAppointment,
  getSoapNote,
  getSurgeries,
  searchPatients,
  sendMessage,
  sendReferral,
  updateMedicalProblem,
  updateMedication,
} from "./ai/tools/openemr";
import type { selectAppointmentSlot } from "./ai/tools/select-appointment-slot";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// Tools called directly — `ChatTools` infers each from `typeof`.
type DirectTools = {
  getWeather: typeof getWeather;
  searchPatients: typeof searchPatients;
  getEncounters: typeof getEncounters;
  getSoapNote: typeof getSoapNote;
  getAppointments: typeof getAppointments;
  getNextAppointment: typeof getNextAppointment;
  selectAppointmentSlot: typeof selectAppointmentSlot;
  createAppointment: typeof createAppointment;
  getMedicalProblems: typeof getMedicalProblems;
  getMedications: typeof getMedications;
  getSurgeries: typeof getSurgeries;
  createEncounter: typeof createEncounter;
  createMedicalProblem: typeof createMedicalProblem;
  updateMedicalProblem: typeof updateMedicalProblem;
  createMedication: typeof createMedication;
  updateMedication: typeof updateMedication;
  createSurgery: typeof createSurgery;
  sendMessage: typeof sendMessage;
  sendReferral: typeof sendReferral;
};

// Factory tools — the route calls the factory, so infer from its ReturnType.
type FactoryTools = {
  generateUI: typeof generateUI;
};

// Derive the tool map so adding a tool means one line in the bucket above,
// not a separate alias plus a map key.
export type ChatTools = {
  [K in keyof DirectTools]: InferUITool<DirectTools[K]>;
} & {
  [K in keyof FactoryTools]: InferUITool<ReturnType<FactoryTools[K]>>;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
