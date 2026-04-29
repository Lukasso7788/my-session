import { useEffect, useState } from "react";
import {
    browserNotificationsSupported,
    getBrowserNotificationPermission,
    requestBrowserNotificationsPermission,
    saveBrowserNotificationsPreference,
    showLocalNotification,
} from "../lib/notifications";

export default function NotificationSettingsButton() {
    const [permission, setPermission] = useState<string>("default");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setPermission(getBrowserNotificationPermission());
    }, []);

    const handleEnable = async () => {
        setBusy(true);

        try {
            const result = await requestBrowserNotificationsPermission();
            setPermission(result);

            if (result === "granted") {
                await saveBrowserNotificationsPreference(true);

                showLocalNotification("Notifications enabled", {
                    body: "We’ll notify you about host sessions while MySession is open.",
                });
            }
        } finally {
            setBusy(false);
        }
    };

    if (!browserNotificationsSupported()) {
        return (
            <div className="text-sm text-gray-500">
                Browser notifications are not supported here.
            </div>
        );
    }

    if (permission === "granted") {
        return (
            <button
                type="button"
                className="rounded-full border border-[#65D46C] bg-[#65D46C]/10 px-5 py-2.5 text-[14px] text-[#2F2F2F]"
            >
                Notifications enabled
            </button>
        );
    }

    if (permission === "denied") {
        return (
            <div className="text-sm text-gray-500">
                Notifications are blocked. Enable them in browser site settings.
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className="
        inline-flex items-center justify-center rounded-full
        border border-[#2F2F2F] px-5 py-2.5
        text-[14px] text-[#2F2F2F]
        hover:bg-[#2F2F2F] hover:text-white transition
        disabled:opacity-60 disabled:cursor-not-allowed
      "
        >
            {busy ? "Enabling..." : "Enable notifications"}
        </button>
    );
}