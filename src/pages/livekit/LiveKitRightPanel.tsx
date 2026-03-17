import React, { useMemo, useState } from "react";
import ChatPanel from "../../components/ChatPanel";
import { IntentionsPanel } from "../../components/IntentionsPanel";
import { Icon, RightPanelTab, RoomTheme } from "./LiveKitUI";

type ParticipantItem = {
    id: string;
    label: string;
    isLocal: boolean;
    micMuted?: boolean;
    camMuted?: boolean;
    participantIdentity?: string;
    participantUserId?: string;
};

export function LiveKitRightPanel(props: {
    theme: RoomTheme;
    isLight: boolean;
    panelBg: string;

    rightTab: RightPanelTab;
    onClose: () => void;

    participantsCount: number;
    participants: ParticipantItem[];

    rolesError: string;
    rolesLoading: boolean;

    isHost: boolean;
    isSelfModerator: boolean;
    moderatorUserIds: string[];

    looksLikeUuid: (v: string) => boolean;
    extractBaseUserIdFromIdentity: (identity: string) => string;

    sessionId: string;
    authUserId: string | null;
    displayName: string;

    timerText: string; // remainingTime
}) {
    const {
        theme,
        isLight,
        panelBg,
        rightTab,
        onClose,
        participantsCount,
        participants,
        rolesError,
        rolesLoading,
        isHost,
        isSelfModerator,
        moderatorUserIds,
        looksLikeUuid,
        extractBaseUserIdFromIdentity,
        sessionId,
        authUserId,
        displayName,
        timerText,
    } = props;

    const [participantsSearch, setParticipantsSearch] = useState("");

    const filteredParticipants = useMemo(() => {
        const q = participantsSearch.trim().toLowerCase();
        if (!q) return participants;
        return participants.filter((t) => (t.label || "").toLowerCase().includes(q));
    }, [participants, participantsSearch]);

    const ChatPanelAny = ChatPanel as any;

    return (
        <div
            className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg} ${theme === "dark" ? "dark" : ""}`}
            data-theme={theme}
        >
            {rightTab === "participants" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className="flex items-center gap-2">
                            <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Participants</span>
                            <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>({participantsCount})</span>
                        </div>
                        <button
                            onClick={onClose}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                }`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-4">
                        <div className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"}`}>
                            <input
                                value={participantsSearch}
                                onChange={(e) => setParticipantsSearch(e.target.value)}
                                placeholder="Search participants..."
                                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"
                                    }`}
                            />
                        </div>
                        {rolesError ? <div className={`mt-2 text-[12px] ${isLight ? "text-red-600" : "text-red-300"}`}>{rolesError}</div> : null}
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                        <div className="flex flex-col gap-2">
                            {filteredParticipants.map((p) => {
                                const name = p.isLocal ? "You" : p.label || "Guest";
                                const initials =
                                    name
                                        .split(" ")
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((x) => x[0]?.toUpperCase())
                                        .join("") || "U";

                                const pidBase = String(p.participantUserId || extractBaseUserIdFromIdentity(String(p.participantIdentity || ""))).toLowerCase();

                                const isMod = !p.isLocal
                                    ? looksLikeUuid(pidBase)
                                        ? moderatorUserIds.includes(pidBase)
                                        : false
                                    : isSelfModerator && !isHost;

                                const roleText = p.isLocal ? (isHost ? "Host" : isMod ? "Moderator" : "You") : isMod ? "Moderator" : "Participant";

                                return (
                                    <div key={p.id} className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"}`}>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div
                                                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${p.isLocal
                                                        ? isLight
                                                            ? "bg-blue-500/15 text-blue-700"
                                                            : "bg-emerald-500/80 text-[#02140B]"
                                                        : isLight
                                                            ? "bg-black/5 text-black/75"
                                                            : "bg-white/10 text-white/85"
                                                    }`}
                                            >
                                                {initials}
                                            </div>

                                            <div className="min-w-0">
                                                <div className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"}`}>{name}</div>

                                                <div className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"}`}>
                                                    {roleText}
                                                    {(!p.isLocal && isMod) || (p.isLocal && isMod && !isHost) ? " • Moderator" : ""}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <div
                                                className={
                                                    "w-8 h-8 rounded-lg flex items-center justify-center " +
                                                    (p.micMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                                                }
                                                title={p.micMuted ? "Muted" : "Unmuted"}
                                            >
                                                <Icon name={p.micMuted ? "mic-off" : "mic-on"} theme={theme} className={`w-4 h-4 ${p.micMuted ? "opacity-90" : "opacity-80"}`} />
                                            </div>

                                            <div
                                                className={
                                                    "w-8 h-8 rounded-lg flex items-center justify-center " +
                                                    (p.camMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                                                }
                                                title={p.camMuted ? "Video off" : "Video on"}
                                            >
                                                <Icon
                                                    name={p.camMuted ? "camera-off" : "camera-on"}
                                                    theme={theme}
                                                    className={`w-4 h-4 ${p.camMuted ? "opacity-90" : "opacity-80"}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className={`p-3 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <button
                            onClick={() => { }}
                            disabled={rolesLoading}
                            className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                }`}
                        >
                            <span className="text-lg">+</span>
                            <span>Invite People</span>
                        </button>
                    </div>
                </div>
            )}

            {rightTab === "chat" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Chat</div>
                        <button
                            onClick={onClose}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                }`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 p-3 overflow-hidden">
                        <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"}`}>
                            <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                                {sessionId ? (
                                    <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                                        <ChatPanelAny
                                            sessionId={sessionId}
                                            theme={theme}
                                            showHeader={false}
                                            title="Chat"
                                            onClose={onClose}
                                            embedded={true}
                                            hideHeader={true}
                                            authUserId={authUserId}
                                            displayName={displayName}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {rightTab === "intentions" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Intentions</div>
                        <button
                            onClick={onClose}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                }`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden p-3">
                        <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"}`}>
                            <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                                <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                                    <IntentionsPanel key={`intentions-${sessionId}-${theme}`} theme={theme} sessionId={sessionId} timerText={timerText || "--:--"} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}