// components/AudioSink.tsx
import { useEffect, useRef } from "react";
import type { JitsiTrack } from "../lib/jitsiEngine";

export function AudioSink({ participants }: { participants: any[] }) {
    return (
        <>
            {participants
                .filter(p => !p.isLocal && p.audioTrack)
                .map(p => (
                    <AudioSinkItem
                        key={p.id}
                        audioTrack={p.audioTrack}
                    />
                ))}
        </>
    );
}

function AudioSinkItem({ audioTrack }: { audioTrack: JitsiTrack }) {
    const ref = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!ref.current) return;
        audioTrack.attach(ref.current);

        return () => {
            audioTrack.detach(ref.current!);
        };
    }, [audioTrack]);

    return <audio ref={ref} autoPlay playsInline />;
}
