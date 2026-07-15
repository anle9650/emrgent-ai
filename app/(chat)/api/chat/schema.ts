import { z } from "zod";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  // Generous cap: scribe kickoff messages embed a full encounter transcript
  // (a 1-hour visit is roughly 50k characters).
  text: z.string().min(1).max(50_000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user"]),
  parts: z.array(partSchema),
});

const toolApprovalMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.unknown())),
});

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  message: userMessageSchema.optional(),
  messages: z.array(toolApprovalMessageSchema).optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
  // Sent only by the scribe kickoff (per-call sendMessage body); absent means
  // a regular chat. Only consulted when the Chat row is first created.
  kind: z.enum(["chat", "scribe"]).optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
