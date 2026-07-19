// No-execute client tools: the run pauses with the call at "input-available"
// until the chat UI resolves it via addToolOutput (e.g. the appointment slot
// picker). Registered here so server code can recognize a persisted pause —
// the sidebar's needs-user-input indicator queries against this list. A new
// interactive tool only needs an entry here to get the indicator.
export const INTERACTIVE_CLIENT_TOOLS = ["selectAppointmentSlot"] as const;

export const INTERACTIVE_CLIENT_TOOL_PART_TYPES = INTERACTIVE_CLIENT_TOOLS.map(
  (name) => `tool-${name}`
);
