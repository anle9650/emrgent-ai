import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { deleteAllChatsByUserId, getChatsByUserId } from "@/lib/db/queries";
import type { ChatKind } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";

// The sidebar history is bifurcated by mode: `?kind=chat|scribe` scopes both
// listing and clear-all to that kind. Absent/invalid kind means no filter.
function parseKind(searchParams: URLSearchParams): ChatKind | undefined {
  const kind = searchParams.get("kind");
  return kind === "chat" || kind === "scribe" ? kind : undefined;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") || "10", 10), 1),
    50
  );
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");

  if (startingAfter && endingBefore) {
    return new ChatbotError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chats = await getChatsByUserId({
    id: session.user.id,
    limit,
    startingAfter,
    endingBefore,
    kind: parseKind(searchParams),
  });

  return Response.json(chats);
}

export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const result = await deleteAllChatsByUserId({
    userId: session.user.id,
    kind: parseKind(request.nextUrl.searchParams),
  });

  return Response.json(result, { status: 200 });
}
