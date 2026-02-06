import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

function useQuery() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

function injectJitsiScript(domain: string) {
    return new Promise<void>((resolve, reject) => {
        if (window.JitsiMeetExternalAPI) return resolve();

        const existing = document.querySelector<HTMLScriptElement>('script[data-jitsi-external-api="1"]');
        if (existing) {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => reject(new Error("Failed to load Jitsi script")));
            return;
        }

        const s = document.createElement("script");
        s.dataset.jitsiExternalApi = "1";
        s.async = true;
        s.src = `https://${domain}/external_api.js`;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${s.src}`));
        document.head.appendChild(s);
    });
}

export default function TestRoomPageIFrame() {
    const query = useQuery();

    const enabled = (import.meta as any).env.VITE_ENABLE_TEST_ROOM === "true";
    const expectedKey = (import.meta as any).env.VITE_TEST_ROOM_KEY || "";
    const providedKey = query.get("k") || "";

    const roomName =
        (import.meta as any).env.VITE_TEST_ROOM_NAME ||
        `mysession__test__${(import.meta as any).env.MODE || "dev"}`;

    const maxParticipants = Number((import.meta as any).env.VITE_TEST_ROOM_MAX || 16);

    // Если у тебя уже есть общий env под домен(а) Jitsi — подхватим его
    const defaultDomain =
        (import.meta as any).env.VITE_TEST_JITSI_DOMAIN ||
        (import.meta as any).env.VITE_JITSI_DOMAIN ||
        "meet.jitsi"; // fallback, на всякий

    const parentRef = useRef<HTMLDivElement | null>(null);
    const apiRef = useRef<any>(null);

    const [displayName, setDisplayName] = useState<string>(() => {
        const saved = localStorage.getItem("mysession_test_display_name");
        if (saved) return saved;
        const rnd = Math.random().toString(16).slice(2, 6).toUpperCase();
        return `TestUser-${rnd}`;
    });

    const canEnter = enabled && expectedKey && providedKey === expectedKey;

    useEffect(() => {
        localStorage.setItem("mysession_test_display_name", displayName);
    }, [displayName]);

    useEffect(() => {
        if (!canEnter) return;
        if (!parentRef.current) return;

        let cancelled = false;

        async function start() {
            await injectJitsiScript(defaultDomain);
            if (cancelled) return;

            // cleanup previous
            if (apiRef.current) {
                try {
                    apiRef.current.dispose();
                } catch { }
                apiRef.current = null;
            }

            const options = {
                roomName,
                parentNode: parentRef.current,
                width: "100%",
                height: "100%",
                userInfo: { displayName },

                // тут можно подхватить то, что у тебя уже используется в RoomPageIFrame
                // (я оставил нейтральные дефолты)
                configOverwrite: {
                    prejoinPageEnabled: false,
                    disableDeepLinking: true,
                    startWithAudioMuted: true,
                    startWithVideoMuted: false,
                },
                interfaceConfigOverwrite: {
                    // если ты и так скрываешь нативный UI через CSS на своем домене — можно оставить пустым
                },
            };

            const api = new window.JitsiMeetExternalAPI(defaultDomain, options);
            apiRef.current = api;

            // Попробуем включить tile view после подключения (если команда доступна)
            api.addListener("videoConferenceJoined", () => {
                try {
                    api.executeCommand("toggleTileView");
                } catch { }
            });

            // Лимит участников (работает, если ты модератор — обычно первый вошедший)
            api.addListener("participantJoined", async (p: any) => {
                try {
                    const list = await api.getParticipantsInfo(); // remote only
                    const total = (list?.length || 0) + 1; // + local
                    if (total > maxParticipants) {
                        try {
                            api.executeCommand("kickParticipant", p.id);
                        } catch { }
                    }
                } catch { }
            });
        }

        start().catch((e) => {
            console.error(e);
        });

        return () => {
            cancelled = true;
            if (apiRef.current) {
                try {
                    apiRef.current.dispose();
                } catch { }
                apiRef.current = null;
            }
        };
    }, [canEnter, defaultDomain, roomName, maxParticipants, displayName]);

    if (!enabled) {
        return (
            <div style={{ padding: 24, fontFamily: "system-ui" }}>
                <h2>Test room disabled</h2>
                <p>VITE_ENABLE_TEST_ROOM=false</p>
            </div>
        );
    }

    if (!expectedKey) {
        return (
            <div style={{ padding: 24, fontFamily: "system-ui" }}>
                <h2>Test room misconfigured</h2>
                <p>Set VITE_TEST_ROOM_KEY in your env.</p>
            </div>
        );
    }

    if (!canEnter) {
        return (
            <div style={{ padding: 24, fontFamily: "system-ui" }}>
                <h2>404</h2>
            </div>
        );
    }

    const joinUrl = `${window.location.origin}/room/test?k=${encodeURIComponent(expectedKey)}`;

    return (
        <div style={{ width: "100vw", height: "100vh", background: "#000", position: "relative" }}>
            {/* маленькая панель сверху */}
            <div
                style={{
                    position: "absolute",
                    zIndex: 10,
                    top: 12,
                    left: 12,
                    right: 12,
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    background: "rgba(0,0,0,0.55)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    color: "#fff",
                    fontFamily: "system-ui",
                }}
            >
                <div style={{ fontWeight: 700 }}>TEST ROOM</div>

                <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.95 }}>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>Name</span>
                    <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        style={{
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.18)",
                            color: "#fff",
                            borderRadius: 10,
                            padding: "6px 10px",
                            outline: "none",
                            width: 220,
                        }}
                    />
                </label>

                <button
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(joinUrl);
                        } catch { }
                    }}
                    style={{
                        marginLeft: "auto",
                        background: "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.18)",
                        color: "#fff",
                        borderRadius: 10,
                        padding: "6px 10px",
                        cursor: "pointer",
                    }}
                >
                    Copy link
                </button>
            </div>

            {/* контейнер для Jitsi */}
            <div ref={parentRef} style={{ width: "100%", height: "100%" }} />
        </div>
    );
}
