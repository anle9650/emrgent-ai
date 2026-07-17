"use client";

import {
  MessageSquareIcon,
  MicIcon,
  PanelLeftIcon,
  PenSquareIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/chat/sidebar-history";
import { SidebarUserNav } from "@/components/chat/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { type ScribeMode, useScribeMode } from "@/hooks/use-scribe-mode";
import { useScribeSession } from "@/hooks/use-scribe-session";
import { cn } from "@/lib/utils";
import { EcgIcon } from "../ecg-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  SCRIBE_STATUS_LABEL,
  ScribeStatusDot,
} from "./scribe/recording-indicator";
import { formatElapsed } from "./scribe/recording-panel";

const MODE_SEGMENTS: {
  mode: ScribeMode;
  label: string;
  icon: typeof MicIcon;
}[] = [
  { mode: "chat", label: "Chat", icon: MessageSquareIcon },
  { mode: "scribe", label: "Scribe", icon: MicIcon },
];

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { mutate } = useSWRConfig();
  const { mode, pendingMode, setMode, returnToScribeSession } = useScribeMode();
  const { indicatorState } = useScribeSession();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);

  // The committed mode flips only when a toggle's navigation lands; highlight
  // the destination immediately so the control responds to the click.
  const displayMode = pendingMode ?? mode;

  // In scribe mode with a live session, the New session slot becomes a
  // status button that jumps back to the recording panel.
  const liveSession = displayMode === "scribe" ? indicatorState : null;

  const handleDeleteAll = () => {
    setShowDeleteAllDialog(false);
    router.replace("/");
    // Scoped to the current mode: you delete what the list shows.
    mutate(unstable_serialize(getChatHistoryPaginationKey(mode)), [], {
      revalidate: false,
    });

    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?kind=${mode}`,
      {
        method: "DELETE",
      }
    );

    toast.success(
      mode === "scribe" ? "All scribe sessions deleted" : "All chats deleted"
    );
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0 pt-3">
          <SidebarMenu>
            <SidebarMenuItem className="flex flex-row items-center justify-between">
              {/* ECG mark + wordmark */}
              <div className="group/logo relative flex items-center">
                <SidebarMenuButton
                  asChild
                  className="h-8 w-auto gap-2.5 !px-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:!px-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:group-hover/logo:opacity-0"
                  tooltip="EMRgent AI"
                >
                  <Link href="/" onClick={() => setOpenMobile(false)}>
                    {/* ECG badge icon */}
                    <div className="flex size-[26px] shrink-0 items-center justify-center rounded-[5px] bg-primary">
                      <EcgIcon className="h-[10px] w-[18px] text-primary-foreground" />
                    </div>
                    {/* Wordmark — hidden when sidebar is icon-only */}
                    <span className="group-data-[collapsible=icon]:hidden">
                      <span
                        className="font-display text-[14px] font-bold tracking-[0.07em] text-sidebar-foreground"
                        style={{ fontVariant: "small-caps" }}
                      >
                        EMRgent
                      </span>
                      <span className="font-mono ml-1.5 text-[9px] tracking-[0.1em] text-primary">
                        AI
                      </span>
                    </span>
                  </Link>
                </SidebarMenuButton>

                {/* Toggle button — visible on hover in collapsed mode */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      className="pointer-events-none absolute inset-0 size-8 opacity-0 group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:group-hover/logo:opacity-100"
                      onClick={() => toggleSidebar()}
                    >
                      <PanelLeftIcon className="size-4" />
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent className="hidden md:block" side="right">
                    Open sidebar
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="group-data-[collapsible=icon]:hidden">
                <SidebarTrigger className="text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground" />
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="pt-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  {/* Expanded: two-segment Chat | Scribe control */}
                  <div className="flex h-8 items-center gap-0.5 rounded-md border border-sidebar-border p-0.5 group-data-[collapsible=icon]:hidden">
                    {MODE_SEGMENTS.map((segment) => (
                      <button
                        aria-pressed={displayMode === segment.mode}
                        className={cn(
                          "flex h-full flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-150",
                          displayMode === segment.mode
                            ? "bg-sidebar-accent text-sidebar-foreground"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground"
                        )}
                        key={segment.mode}
                        onClick={() => setMode(segment.mode)}
                        type="button"
                      >
                        <segment.icon className="size-3" />
                        <span>{segment.label}</span>
                      </button>
                    ))}
                  </div>
                  {/* Collapsed: single button cycling the mode */}
                  <SidebarMenuButton
                    className="hidden group-data-[collapsible=icon]:flex"
                    onClick={() =>
                      setMode(displayMode === "chat" ? "scribe" : "chat")
                    }
                    tooltip={
                      displayMode === "chat"
                        ? "Chat mode — switch to Scribe"
                        : "Scribe mode — switch to Chat"
                    }
                  >
                    {displayMode === "chat" ? (
                      <MessageSquareIcon className="size-3.5" />
                    ) : (
                      <MicIcon className="size-3.5 text-primary" />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  {liveSession ? (
                    <SidebarMenuButton
                      className="h-8 rounded-md border border-sidebar-border font-mono text-[10px] text-sidebar-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-sidebar-accent/50"
                      data-testid="sidebar-scribe-status"
                      onClick={() => {
                        setOpenMobile(false);
                        returnToScribeSession();
                      }}
                      tooltip={`Return to recording for ${liveSession.patientName}`}
                    >
                      {/* Icon-sized box so the dot centers in the collapsed
                          icon-only button. size-3.5 (not size-4): the border
                          leaves exactly 14px of content width when collapsed,
                          so a 16px box would overflow 2px to the right. */}
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        <ScribeStatusDot status={liveSession.status} />
                      </span>
                      <span className="tabular-nums">
                        {SCRIBE_STATUS_LABEL[liveSession.status]}
                        {liveSession.status !== "transcribing" &&
                          ` · ${formatElapsed(liveSession.elapsedMs)}`}
                      </span>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      className="h-8 rounded-md border border-sidebar-border font-mono text-[10px] tracking-[0.08em] uppercase text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      onClick={() => {
                        setOpenMobile(false);
                        router.push("/");
                      }}
                      tooltip="New Session"
                    >
                      <PenSquareIcon className="size-3.5" />
                      <span>New session</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
                {user && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="rounded-md font-mono text-[10px] tracking-[0.08em] uppercase text-sidebar-foreground/40 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setShowDeleteAllDialog(true)}
                      tooltip="Clear All"
                    >
                      <TrashIcon className="size-3.5" />
                      <span>Clear all</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarHistory user={user} />
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border pt-2 pb-3">
          {user && <SidebarUserNav user={user} />}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "scribe"
                ? "Clear all scribe sessions?"
                : "Clear all chats?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.{" "}
              {mode === "scribe"
                ? "All your scribe sessions will be permanently deleted."
                : "All your chat history will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
