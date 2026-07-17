import { customProvider, gateway } from "ai";
import { useMockModels } from "../constants";
import { TRANSCRIPTION_MODEL, titleModel } from "./models";

export const myProvider = useMockModels
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (useMockModels && myProvider) {
    // Always the scripted mock: the caller passes real gateway ids
    // ("moonshotai/kimi-k2.5"), which the mock provider doesn't register.
    return myProvider.languageModel("chat-model");
  }

  return gateway.languageModel(modelId);
}

export function getTitleModel() {
  if (useMockModels && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return gateway.languageModel(titleModel.id);
}

// Callers must handle the test environment themselves (the transcribe route
// short-circuits to a canned transcript before ever asking for a model).
export function getTranscriptionModel() {
  return gateway.transcriptionModel(TRANSCRIPTION_MODEL);
}
