import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadJitsiExternalAPI } from "../lib/jitsiIframeLoader";
import { JitsiIframeAdapter } from "../lib/jitsiIframeAdapter";

const JITSI_DOMAIN = "jitsi.lukassodesign.site";

function safeRoomName(raw: string) {
    const base = (raw || "default-room").trim().toLowerCase();
    const cleaned = base.replace(/[^a-z0-9-_]/g, "");
    return cleaned || "session-" + Math.random().toString(36).slice(2, 8);
}

export default function RoomPageIFrame() {
    const nav = useNavigate();
    const { roomId } = useParams();

    const roomName = useMemo(() => safeRoomName(roomId || "default-room"), [roomId]);
    const displayName = "Ярослав"; // TODO: подтянуть из профиля/сессии

    const hostRef = useRef<HTMLDivElement | null>(null);
    const adapterRef = useRef<JitsiIframeAdapter | null>(null);

    const [joined, setJoined] = useState(false);
    const [audioMuted, setAudioMuted] = useState(false);
    const [videoMuted, setVideoMuted] = useState(false);
    const [participants, setParticipants] = useState(1);

    useEffect(() => {
        let alive = true;

        (async () => {
            if (!hostRef.current) return;

            await loadJitsiExternalAPI(JITSI_DOMAIN);
            if (!alive) return;

            const adapter = new JitsiIframeAdapter(
                JITSI_DOMAIN,
                roomName,
                displayName,
                hostRef.current,
                {
                    onJoined: () => setJoined(true),
                    onLeft: () => {
                        setJoined(false);
                        // можно вернуть в список сессий
                        nav("/sessions");
                    },
                    onAudioMuteChanged: (m) => setAudioMuted(m),
                    onVideoMuteChanged: (m) => setVideoMuted(m),
                    onParticipantsChanged: (c) => setParticipants(Math.max(1, c)),
                    onError: (msg) => console.warn("[JitsiIframe]", msg),
                }
            );

            adapterRef.current = adapter;
            adapter.mount();
        })().catch((e) => {
            console.error(e);
            // fallback
            nav("/sessions");
        });

        return () => {
            alive = false;
            adapterRef.current?.dispose();
            adapterRef.current = null;
        };
    }, [nav, roomName, displayName]);

    const api = adapterRef.current;

    return (
        <div className="w-screen h-screen bg-black relative overflow-hidden">
            {/* Jitsi iframe host */}
            <div ref={hostRef} className="absolute inset-0" />

            {/* ТВОЙ кастомный UI поверх */}
            <div className="absolute inset-0 pointer-events-none">
                {/* top bar */}
                <div className="pointer-events-auto p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-white/90">
                            <div className="text-lg font-semibold">1 Hour — Pomodoro 15/3</div>
                            <div className="text-sm text-white/60">{participants} participants</div>
                        </div>

                        <div className="flex items-center gap-2 text-white/80 text-sm">
                            <div className="px-3 py-1 rounded-full bg-white/10">⏳ 1:16</div>
                            <div className="px-3 py-1 rounded-full bg-white/10">🌙</div>
                            <div className="px-3 py-1 rounded-full bg-white/10">Host: {displayName}</div>
                        </div>
                    </div>
                </div>

                {/* bottom controls */}
                <div className="absolute bottom-0 left-0 right-0 p-6 pointer-events-auto">
                    <div className="flex items-center justify-center gap-3">
                        <button
                            className="px-4 py-3 rounded-full bg-white/10 text-white"
                            onClick={() => adapterRef.current?.toggleAudio()}
                        >
                            {audioMuted ? "Unmute" : "Mute"}
                        </button>

                        <button
                            className="px-4 py-3 rounded-full bg-white/10 text-white"
                            onClick={() => adapterRef.current?.toggleVideo()}
                        >
                            {videoMuted ? "Camera On" : "Camera Off"}
                        </button>

                        <button
                            className="px-4 py-3 rounded-full bg-white/10 text-white"
                            onClick={() => adapterRef.current?.toggleScreenShare()}
                        >
                            Share
                        </button>

                        <button
                            className="px-5 py-3 rounded-full bg-red-600 text-white font-semibold"
                            onClick={() => adapterRef.current?.hangup()}
                        >
                            Leave
                        </button>
                    </div>
                </div>
            </div>

            {/* debug */}
            <div className="absolute bottom-2 left-2 text-xs text-white/40 pointer-events-none">
                mode: iframe • joined: {String(joined)}
            </div>
        </div>
    );
}
