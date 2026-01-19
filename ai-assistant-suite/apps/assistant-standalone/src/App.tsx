import { useEffect, useMemo, useState } from "react";
import { AssistantRoot } from "@assistant/ui";
import type { CapturedFrame } from "./features/vision/useAIVision";
import { useAIVision } from "./features/vision/useAIVision";

export default function App() {
  const vision = useAIVision({
    autoCaptureEveryMs: 0,
    jpegQuality: 0.75,
    maxWidth: 900,
  });

  const [clipFrames, setClipFrames] = useState<CapturedFrame[]>([]);
  const [isRecordingClip, setIsRecordingClip] = useState(false);

  useEffect(() => {
    return () => {
      setClipFrames((prev) => {
        prev.forEach((f) => URL.revokeObjectURL(f.url));
        return [];
      });
      vision.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSource = async () => {
    if (vision.isOn || vision.isPaused || vision.isRequesting) {
      vision.stop();
    }
    await vision.start();
  };

  const handleClip5s = async () => {
    if (!vision.isOn && !vision.isPaused) {
      await handleSource();
    }
    setIsRecordingClip(true);
    try {
      const frames = await vision.recordClipFrames(5, 1);

      setClipFrames((prev) => {
        prev.forEach((f) => URL.revokeObjectURL(f.url));
        return frames;
      });
    } finally {
      setIsRecordingClip(false);
    }
  };

  const clipLabel = useMemo(() => {
    if (!clipFrames.length) return "No clip";
    return `Clip: ${clipFrames.length} frames`;
  }, [clipFrames.length]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Standalone Shell</h1>
      <p>Assistant overlay bottom-right. Frames + clip are POSTed to backend.</p>

      {/* Vision bar pinned near the assistant overlay (MVP placement) */}
      <div
        style={{
          position: "fixed",
          right: 22,
          bottom: 220,
          zIndex: 999999,
          width: 520,
          maxWidth: "calc(100vw - 44px)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            padding: 10,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(14px)",
            color: "white",
          }}
        >
          {/* Preview */}
          <div
            style={{
              width: 74,
              height: 50,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              position: "relative",
              flex: "0 0 auto",
            }}
            title={vision.previewUrl ? "Preview (private)" : "No preview"}
          >
            {vision.previewUrl ? (
              <img
                src={vision.previewUrl}
                alt="preview"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : null}

            <div
              style={{
                position: "absolute",
                top: 6,
                left: 6,
                width: 8,
                height: 8,
                borderRadius: 999,
                background: vision.isOn
                  ? "#33d17a"
                  : vision.isPaused
                    ? "#f5c211"
                    : "#777",
                boxShadow: "0 0 0 2px rgba(0,0,0,0.35)",
              }}
            />
          </div>

          {/* Controls */}
          <button
            onClick={handleSource}
            style={btnStyle("rgba(255,255,255,0.08)")}
            title="Pick a screen/window/tab to share with the assistant (private)"
          >
            Source
          </button>

          <button
            onClick={vision.reSync}
            disabled={!vision.isOn && !vision.isPaused}
            style={btnStyle("#1f7a3a")}
            title="Make a fresh snapshot"
          >
            Re-sync
          </button>

          <button
            onClick={vision.isPaused ? vision.resume : vision.pause}
            disabled={!vision.isOn && !vision.isPaused}
            style={btnStyle("rgba(255,255,255,0.08)")}
          >
            {vision.isPaused ? "Resume" : "Pause"}
          </button>

          <button
            onClick={vision.stop}
            disabled={!vision.isOn && !vision.isPaused && !vision.isRequesting}
            style={btnStyle("rgba(255, 0, 0, 0.25)")}
          >
            Stop
          </button>

          {/* Clip */}
          <button
            onClick={handleClip5s}
            disabled={isRecordingClip}
            style={btnStyle("rgba(80,160,255,0.20)")}
            title="Record 5 seconds as 5 keyframes (1 fps)"
          >
            {isRecordingClip ? "Clip…" : "Clip 5s"}
          </button>

          {/* Meta */}
          <div style={{ marginLeft: 6, minWidth: 220 }}>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              <b>Seeing:</b>{" "}
              {vision.sourceInfo?.label
                ? vision.sourceInfo.label
                : vision.isRequesting
                  ? "Selecting…"
                  : "—"}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              <b>Last capture:</b> {vision.lastCaptureText}
            </div>

            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
              🔒 Private (not shared)
            </div>

            {vision.error ? (
              <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 4 }}>
                Error: {vision.error}
              </div>
            ) : null}

            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
              <b>{clipLabel}</b>
              {clipFrames.length ? (
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: 6,
                    overflowX: "auto",
                    paddingBottom: 2,
                  }}
                >
                  {clipFrames.map((f, idx) => (
                    <img
                      key={idx}
                      src={f.url}
                      alt={`clip-${idx}`}
                      style={{
                        width: 54,
                        height: 36,
                        borderRadius: 8,
                        objectFit: "cover",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                      title={`Frame ${idx + 1}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <AssistantRoot
        mode="standalone"
        onSend={async ({ inputText, explainMode, attachments }) => {
          // Pre-send snapshot (best default)
          if (vision.isOn || vision.isPaused) {
            await vision.reSync();
          }

          const lastFrame = vision.getLastFrame();

          const fd = new FormData();
          fd.append("text", inputText ?? "");
          fd.append("explainMode", String(explainMode ?? ""));
          fd.append("clipCount", String(clipFrames.length));

          // last frame
          if (lastFrame?.blob) {
            fd.append("lastFrame", lastFrame.blob, `last-frame-${Date.now()}.jpg`);
          }

          // clip frames
          clipFrames.forEach((f, idx) => {
            fd.append("clipFrames", f.blob, `clip-${idx + 1}-${f.capturedAt}.jpg`);
          });

          // UI attachments (best-effort)
          for (let i = 0; i < attachments.length; i++) {
            const a: any = attachments[i];
            if (a?.file instanceof File) {
              fd.append("attachments", a.file, a.file.name);
            } else if (a instanceof File) {
              fd.append("attachments", a, a.name);
            } else if (a?.blob instanceof Blob) {
              fd.append("attachments", a.blob, a.name ?? `attachment-${i + 1}`);
            }
          }

          const resp = await fetch("http://localhost:3001/api/assistant/send", {
            method: "POST",
            body: fd,
          });

          const json = await resp.json();

          return {
            assistantText:
              (json.assistantText ?? "❌ no assistantText returned") +
              "\n\n---\n\nDebug:\n" +
              JSON.stringify(json.received, null, 2),
          };
        }}
        onResync={async () => {
          if (!vision.isOn && !vision.isPaused) {
            await handleSource();
          } else {
            await vision.reSync();
          }
          return {
            assistantText:
              "✅ Re-sync: captured a fresh screen snapshot (preview updated).",
          };
        }}
      />
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: bg,
    color: "white",
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1,
  };
}
