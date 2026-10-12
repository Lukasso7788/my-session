import React from "react";

import { captureAppError, captureProductEvent } from "../lib/analytics";
import { isDynamicImportFailure } from "../lib/dynamicImportRecovery";
import { describeErrorForDiagnostics, reportRoomDiagnostic } from "../lib/roomDiagnosticsReport";
import { markSameTabRoomResume } from "../lib/sameTabRoomResume";

/** Reload the room page and let the same tab rejoin automatically once. */
export function reloadRoomWithResume(routeId: string | null | undefined) {
  const id = String(routeId || "").trim();
  if (id) markSameTabRoomResume(id, id);
  window.location.reload();
}

type BoundaryState = { error: unknown };

type PanelBoundaryProps = {
  panel: "chat" | "tasks" | "music" | "pip-chat";
  routeId: string | null | undefined;
  sessionId: string | null | undefined;
  isLight: boolean;
  onClose?: () => void;
  children: React.ReactNode;
};

/**
 * Keeps a failing side panel from unmounting the room. A stale chunk after a
 * deploy can only be fixed by loading the new build, so that case offers a
 * refresh (with automatic rejoin) instead of a retry.
 */
export class RoomPanelErrorBoundary extends React.Component<PanelBoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    const staleChunk = isDynamicImportFailure(error);
    console.error(`[room] ${this.props.panel} panel failed`, error);
    captureAppError(error, `room-panel-${this.props.panel}`);
    captureProductEvent("room_panel_failed", { panel: this.props.panel, stale_chunk: staleChunk });
    void reportRoomDiagnostic("room_panel_failed", this.props.sessionId, {
      panel: this.props.panel,
      staleChunk,
      ...describeErrorForDiagnostics(error),
    });
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const staleChunk = isDynamicImportFailure(error);
    const { isLight, onClose, routeId } = this.props;
    const muted = isLight ? "text-black/60" : "text-white/65";
    const primary = isLight
      ? "bg-[#1B1B1B] text-white hover:bg-[#242424]"
      : "bg-[#5286F6] text-white hover:bg-[#6B98FA]";
    const secondary = isLight
      ? "border border-[#CFCFCF] bg-black/[0.03] text-black/75 hover:bg-black/[0.06]"
      : "border border-[#3A3A3A] bg-[#252525] text-white/80 hover:bg-[#2F2F2F]";

    return (
      <div role="alert" className={`flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center ${isLight ? "text-black" : "text-white"}`}>
        <div className="text-[15px] font-semibold">
          {staleChunk ? "MySession was updated" : "This panel ran into a problem"}
        </div>
        <p className={`max-w-[280px] text-[12px] leading-5 ${muted}`}>
          {staleChunk
            ? "Refresh to load the new version. You will rejoin this room automatically."
            : "Your room connection is fine. Try opening the panel again."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {staleChunk ? (
            <button type="button" onClick={() => reloadRoomWithResume(routeId)} className={`h-9 rounded-xl px-4 text-[12px] font-semibold ${primary}`}>
              Refresh
            </button>
          ) : (
            <button type="button" onClick={this.retry} className={`h-9 rounded-xl px-4 text-[12px] font-semibold ${primary}`}>
              Try again
            </button>
          )}
          {onClose ? (
            <button type="button" onClick={onClose} className={`h-9 rounded-xl px-4 text-[12px] font-semibold ${secondary}`}>
              Close panel
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

type SilentBoundaryProps = {
  area: string;
  sessionId: string | null | undefined;
  /** Close whatever failed (for example a modal) so the room stays usable. */
  onError?: () => void;
  /** Changing this value (for example a modal's open flag) clears a caught error. */
  resetKey?: unknown;
  children: React.ReactNode;
};

/** For optional room UI (modals, helpers): fail closed instead of crashing the room. */
export class RoomSilentErrorBoundary extends React.Component<SilentBoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error(`[room] ${this.props.area} failed`, error);
    captureAppError(error, `room-${this.props.area}`);
    void reportRoomDiagnostic("room_section_failed", this.props.sessionId, {
      area: this.props.area,
      staleChunk: isDynamicImportFailure(error),
      ...describeErrorForDiagnostics(error),
    });
    this.props.onError?.();
  }

  componentDidUpdate(previous: SilentBoundaryProps) {
    if (this.state.error && !Object.is(previous.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }

  render() {
    return this.state.error ? null : this.props.children;
  }
}

type CrashBoundaryProps = {
  routeId: string;
  children: React.ReactNode;
};

/** Last resort around the whole room: a recovery screen instead of a blank page. */
export class RoomCrashBoundary extends React.Component<CrashBoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const staleChunk = isDynamicImportFailure(error);
    console.error("[room] room crashed", error, info?.componentStack);
    captureAppError(error, "room");
    captureProductEvent("room_crashed", { stale_chunk: staleChunk });
    void reportRoomDiagnostic("room_crashed", this.props.routeId, {
      staleChunk,
      ...describeErrorForDiagnostics(error),
      componentStack: String(info?.componentStack || "").slice(0, 600),
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const staleChunk = isDynamicImportFailure(this.state.error);

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3F1F1] p-6" role="alert">
        <div className="w-full max-w-[440px] rounded-[28px] border border-[#CFCFCF] bg-white p-7 text-center shadow-sm">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1B1B1B]">
            {staleChunk ? "MySession was updated" : "The room hit a problem"}
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-black/60">
            {staleChunk
              ? "Refresh to load the new version and rejoin the room."
              : "Rejoin to continue with the same camera and microphone settings."}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => reloadRoomWithResume(this.props.routeId)}
              className="h-11 rounded-2xl bg-[#1B1B1B] text-[14px] font-semibold text-white transition hover:bg-[#242424]"
            >
              Rejoin room
            </button>
            <button
              type="button"
              onClick={() => window.location.replace("/sessions")}
              className="h-11 rounded-2xl border border-[#CFCFCF] bg-black/[0.03] text-[14px] font-semibold text-black/70 transition hover:bg-black/[0.06]"
            >
              Back to sessions
            </button>
          </div>
        </div>
      </main>
    );
  }
}
