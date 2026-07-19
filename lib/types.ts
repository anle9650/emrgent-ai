import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { createDocument } from "./ai/tools/create-document";
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
  getSoapNote,
  getSurgeries,
  searchPatients,
  updateMedicalProblem,
  updateMedication,
} from "./ai/tools/openemr";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { selectAppointmentSlot } from "./ai/tools/select-appointment-slot";
import type { updateDocument } from "./ai/tools/update-document";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type searchPatientsTool = InferUITool<typeof searchPatients>;
type getEncountersTool = InferUITool<typeof getEncounters>;
type getSoapNoteTool = InferUITool<typeof getSoapNote>;
type getAppointmentsTool = InferUITool<typeof getAppointments>;
type selectAppointmentSlotTool = InferUITool<typeof selectAppointmentSlot>;
type createAppointmentTool = InferUITool<typeof createAppointment>;
type getMedicalProblemsTool = InferUITool<typeof getMedicalProblems>;
type getMedicationsTool = InferUITool<typeof getMedications>;
type getSurgeriesTool = InferUITool<typeof getSurgeries>;
type createEncounterTool = InferUITool<typeof createEncounter>;
type createMedicalProblemTool = InferUITool<typeof createMedicalProblem>;
type updateMedicalProblemTool = InferUITool<typeof updateMedicalProblem>;
type createMedicationTool = InferUITool<typeof createMedication>;
type updateMedicationTool = InferUITool<typeof updateMedication>;
type createSurgeryTool = InferUITool<typeof createSurgery>;
type generateUITool = InferUITool<ReturnType<typeof generateUI>>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;

export type ChatTools = {
  getWeather: weatherTool;
  searchPatients: searchPatientsTool;
  getEncounters: getEncountersTool;
  getSoapNote: getSoapNoteTool;
  getAppointments: getAppointmentsTool;
  selectAppointmentSlot: selectAppointmentSlotTool;
  createAppointment: createAppointmentTool;
  getMedicalProblems: getMedicalProblemsTool;
  getMedications: getMedicationsTool;
  getSurgeries: getSurgeriesTool;
  createEncounter: createEncounterTool;
  createMedicalProblem: createMedicalProblemTool;
  updateMedicalProblem: updateMedicalProblemTool;
  createMedication: createMedicationTool;
  updateMedication: updateMedicationTool;
  createSurgery: createSurgeryTool;
  generateUI: generateUITool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
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
