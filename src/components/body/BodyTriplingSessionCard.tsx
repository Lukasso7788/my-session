// src/components/body/BodyTriplingSessionCard.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type BookedUser = { id: string; full_name?: string | null; avatar_url?: string | null };

function getInitials(nameOrId: string) {
    const s = String(nameOrId || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * session_bookings ( user_id, profiles:profiles ( id, full_name, avatar_url ) )
 */
function extractBookers(session: any): BookedUser[] {
    const raw = session?.session_bookings || [];
    if (!Array.isArray(raw)) return [];

    const out: BookedUser[] = [];
    const seen = new Set<string>();

    for (const b of raw) {
        const uid = String(b?.user_id || "");
        if (!uid || seen.has(uid)) continue;
        const p = b?.profiles || null;

        out.push({
            id: uid,
            full_name: p?.full_name ?? b?.full_name ?? null,
            avatar_url: p?.avatar_url ?? b?.avatar_url ?? null,
        });

        seen.add(uid);
    }

    return out;
}

function AvatarCircle({ user, size = 30 }: { user: BookedUser; size?: number }) {
    const label = user?.full_name || "Participant";
    const initials = getInitials(label);

    return (
        <div
            className="rounded-full overflow-hidden flex items-center justify-center border border-[#E5E7EB] bg-white"
            style={{ width: size, height: size }}
            title={label}
        >
            {user?.avatar_url ? (
                <img src={user.avatar_url} alt={label} className="w-full h-full object-cover" draggable={false} />
            ) : (
                <div className="text-[10px] font-semibold text-[#111827] select-none">{initials}</div>
            )}
        </div>
    );
}

function UsersIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M16 11a3 3 0 1 0-6 0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
            <path
                d="M2.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
            <path
                d="M17 8a3 3 0 1 0 0 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.5"
            />
            <path
                d="M18.5 14c2 0 3.9 1 4.5 3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.5"
            />
        </svg>
    );
}

function ClockGreen({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"
                stroke="currentColor"
                strokeWidth="2"
            />
            <path
                d="M12 6v6l4 2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function formatStartLine(startISO?: string | null) {
    if (!startISO) return { topLabel: "Starts", value: "—" };

    const start = new Date(startISO);
    const now = new Date();

    const diffMs = start.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);

    // If within next 6 hours -> show "Starts in ..."
    if (diffMin > 0 && diffMin <= 360) {
        const h = Math.floor(diffMin / 60);
        const m = diffMin % 60;
        if (h <= 0) return { topLabel: "Starts in", value: `${m} mins` };
        return { topLabel: "Starts in", value: `${h} hr ${m} mins` };
    }

    // Else show "Starts at ..."
    const time = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return { topLabel: "Starts at", value: time };
}

function statusColors(filled: number, max: number) {
    const full = filled >= max;

    if (full) {
        return {
            pill: "border-[#FCA5A5] bg-[#FEE2E2] text-[#DC2626]",
            bubble: "bg-[#FEE2E2] text-[#DC2626]",
        };
    }

    // almost full -> blue, otherwise green
    if (filled >= max - 1) {
        return {
            pill: "border-[#93C5FD] bg-[#DBEAFE] text-[#1D4ED8]",
            bubble: "bg-[#DBEAFE] text-[#1D4ED8]",
        };
    }

    return {
        pill: "border-[#86EFAC] bg-[#DCFCE7] text-[#16A34A]",
        bubble: "bg-[#DCFCE7] text-[#16A34A]",
    };
}

export default function BodyTriplingSessionCard(props: {
    session: any;
    userId?: string;
    onBook: (sessionId: string) => void;
    onCancelBooking: (sessionId: string) => void;
}) {
    const { session, userId, onBook, onCancelBooking } = props;
    const navigate = useNavigate();

    const hostId = String(session?.host_id || "");
    const isHost = !!userId && hostId && userId === hostId;

    const bookers = useMemo(() => extractBookers(session), [session]);

    // Include host as participant visually (buddy tripling = 3 people total)
    const participantIds = useMemo(() => {
        const s = new Set<string>();
        if (hostId) s.add(hostId);
        for (const b of bookers) if (b?.id) s.add(String(b.id));
        return s;
    }, [bookers, hostId]);

    const maxParticipants = 3; // buddy tripling = group of 3
    const filledCount = Math.min(participantIds.size, maxParticipants);
    const remaining = Math.max(0, maxParticipants - filledCount);
    const isFull = filledCount >= maxParticipants;

    const hostName = (() => {
        if (isHost) return "You";
        return String(session?.host_name || "Host");
    })();

    const hostAvatar = (() => {
        // best effort: if host exists among bookers, use their avatar
        const fromBookers = bookers.find((u) => u.id === hostId);
        return fromBookers?.avatar_url || null;
    })();

    const avatarsForStack = useMemo(() => {
        // show host first, then bookers (excluding host)
        const hostUser: BookedUser | null = hostId
            ? { id: hostId, full_name: hostName, avatar_url: hostAvatar }
            : null;

        const rest = bookers.filter((u) => u.id !== hostId);

        const merged: BookedUser[] = [];
        if (hostUser) merged.push(hostUser);
        for (const u of rest) merged.push(u);

        // de-dupe
        const seen = new Set<string>();
        const out: BookedUser[] = [];
        for (const u of merged) {
            if (!u?.id) continue;
            if (seen.has(u.id)) continue;
            seen.add(u.id);
            out.push(u);
        }
        return out;
    }, [bookers, hostAvatar, hostId, hostName]);

    const stackMax = 4;
    const stack = avatarsForStack.slice(0, stackMax);
    const more = Math.max(0, avatarsForStack.length - stack.length);

    const startISO = session?.start_time || null;
    const startLine = formatStartLine(startISO);

    const initialBooked = useMemo(() => {
        if (!userId) return false;
        return participantIds.has(userId);
    }, [participantIds, userId]);

    const [isBooked, setIsBooked] = useState<boolean>(initialBooked);

    const colors = statusColors(filledCount, maxParticipants);

    const handleJoin = () => {
        navigate(`/room-iframe/${session.id}`);
    };

    const handleBook = () => {
        if (!userId) return navigate("/login");
        if (isHost) return; // host is already in
        if (isFull) return;
        onBook(session.id);
        setIsBooked(true);
    };

    const handleCancel = () => {
        if (!userId) return navigate("/login");
        if (isHost) return;
        onCancelBooking(session.id);
        setIsBooked(false);
    };

    // UI labels (match screenshot vibe)
    const secondaryLabel = isFull && !isBooked && !isHost ? "Fully booked" : isBooked ? "Cancel booking" : "Book session";
    const secondaryDisabled = isHost || (isFull && !isBooked);
    const primaryLabel = isFull && !isBooked && !isHost ? "Fully booked" : "Join session";
    const primaryDisabled = isFull && !isBooked && !isHost;

    return (
        <div className="border border-[#E5E7EB] bg-white rounded-[24px] p-5">
            {/* Top row: host + status */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {/* host avatar */}
                    <div className="rounded-full overflow-hidden border border-[#E5E7EB] bg-white w-10 h-10 shrink-0 flex items-center justify-center">
                        {hostAvatar ? (
                            <img src={hostAvatar} alt={hostName} className="w-full h-full object-cover" draggable={false} />
                        ) : (
                            <div className="text-[12px] font-semibold text-[#111827]">{getInitials(hostName)}</div>
                        )}
                    </div>

                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <div className="text-[16px] font-bold text-[#111827] truncate">{hostName}</div>
                            {isHost && (
                                <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-[#DBEAFE] text-[#1D4ED8]">
                                    Host
                                </span>
                            )}
                        </div>

                        {/* avatars row */}
                        <div className="mt-2 flex items-center gap-2">
                            <div className="flex items-center">
                                {stack.map((u, idx) => (
                                    <div key={u.id} className="relative" style={{ marginLeft: idx === 0 ? 0 : -10, zIndex: 50 - idx }}>
                                        <AvatarCircle user={u} size={26} />
                                    </div>
                                ))}
                            </div>
                            {more > 0 && <div className="text-[12px] text-[#606060]">+{more} more</div>}
                        </div>
                    </div>
                </div>

                {/* status */}
                <div className="flex items-center gap-2 shrink-0">
                    <div className={`text-[12px] font-semibold px-3 py-1 rounded-full border ${colors.pill}`}>
                        {filledCount}/{maxParticipants} filled
                    </div>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${colors.bubble}`}>
                        {remaining}
                    </div>
                </div>
            </div>

            <div className="my-4 border-t border-[#F0F0F0]" />

            {/* meta line */}
            <div className="flex items-center gap-2 text-[13px] text-[#111827]/70">
                <UsersIcon />
                <span className="font-semibold text-[#111827]/80">Today</span>
                <span>·</span>
                <span>Buddy Tripling · 90 min session</span>
            </div>

            {/* start time */}
            <div className="mt-3 flex items-center gap-2 text-[13px] text-[#111827]/70">
                <span className="text-[#16A34A]">
                    <ClockGreen />
                </span>
                <span className="font-semibold">{startLine.topLabel}</span>
                <span>{startLine.value}</span>
            </div>

            {/* buttons */}
            <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                    type="button"
                    disabled={secondaryDisabled}
                    onClick={() => {
                        if (secondaryDisabled) return;
                        if (isBooked) handleCancel();
                        else handleBook();
                    }}
                    className={[
                        "h-11 rounded-full border text-[13px] font-semibold transition flex items-center justify-center gap-2",
                        secondaryDisabled
                            ? "border-[#E5E7EB] text-[#9CA3AF] bg-[#F9FAFB]"
                            : isBooked
                                ? "border-[#FCA5A5] text-[#DC2626] bg-[#FEE2E2]/40 hover:bg-[#FEE2E2]"
                                : "border-[#E5E7EB] text-[#111827] bg-white hover:bg-[#F3F4F6]",
                    ].join(" ")}
                >
                    {secondaryLabel}
                </button>

                <button
                    type="button"
                    disabled={primaryDisabled}
                    onClick={() => {
                        if (primaryDisabled) return;
                        handleJoin();
                    }}
                    className={[
                        "h-11 rounded-full text-[13px] font-semibold transition flex items-center justify-center gap-2",
                        primaryDisabled ? "bg-[#111827]/30 text-white" : "bg-[#111827] text-white hover:opacity-90",
                    ].join(" ")}
                >
                    {primaryLabel}
                </button>
            </div>
        </div>
    );
}
