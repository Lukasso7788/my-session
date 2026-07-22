self.addEventListener("push", (event) => {
    let payload = {};

    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = {
            title: "MySession",
            body: event.data ? event.data.text() : "You have a new notification.",
        };
    }

    const title = payload.title || "MySession";
    const options = {
        body: payload.body || "You have a new notification.",
        icon: payload.icon || "/icons/followers_profile.svg",
        badge: payload.badge || "/icons/followers_profile.svg",
        tag: payload.tag || undefined,
        renotify: payload.renotify === true,
        data: payload.data || {},
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const url = event.notification?.data?.url || "/sessions";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ("focus" in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});
