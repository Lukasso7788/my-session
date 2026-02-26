import React, { useEffect, useMemo, useState } from "react";

type RoomTheme = "dark" | "light";

type Props = {
    theme: RoomTheme;
    onPick: (emoji: string) => void;
    onClose?: () => void;
    className?: string;
};

// Ленивый загрузчик Picker + data: скачиваются только когда поповер реально открыт
export function EmojiPickerPopover({ theme, onPick, onClose, className }: Props) {
    const [PickerComp, setPickerComp] = useState<any>(null);
    const [emojiData, setEmojiData] = useState<any>(null);
    const [err, setErr] = useState<string>("");

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                setErr("");

                const [{ default: Picker }, dataMod] = await Promise.all([
                    import("@emoji-mart/react"),
                    import("@emoji-mart/data"),
                ]);

                if (!alive) return;

                setPickerComp(() => Picker);
                setEmojiData(dataMod?.default || dataMod);
            } catch (e: any) {
                if (!alive) return;
                setErr(String(e?.message || e || "Failed to load emoji picker"));
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const pickerTheme = theme === "light" ? "light" : "dark";

    const onEmojiSelect = (e: any) => {
        const native = e?.native || e?.emoji || "";
        if (native) onPick(String(native));
        onClose?.();
    };

    const Picker = PickerComp;

    return (
        <div
            className={
                "rounded-2xl overflow-hidden " +
                (className || "")
            }
        >
            {err ? (
                <div className={theme === "light" ? "p-3 text-sm text-red-700" : "p-3 text-sm text-red-300"}>
                    {err}
                </div>
            ) : !Picker || !emojiData ? (
                <div className={theme === "light" ? "p-4 text-sm text-black/60" : "p-4 text-sm text-white/60"}>
                    Loading emoji picker…
                </div>
            ) : (
                <Picker
                    data={emojiData}
                    onEmojiSelect={onEmojiSelect}
                    theme={pickerTheme}
                    set="native"           // самый быстрый/нативный сет
                    previewPosition="none" // компактнее
                    searchPosition="sticky"
                    navPosition="bottom"
                    skinTonePosition="preview"
                />
            )}
        </div>
    );
}