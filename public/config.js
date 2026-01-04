var config = {
    hosts: {
        domain: "meet.mysession.club",
        muc: "conference.meet.mysession.club",
    },

    // ✅ Добавил оба варианта, чтобы точно не сломалось
    bosheURL: "//meet.mysession.club/http-bind", // (оставляем, если где-то у тебя это ожидается)
    boshURL: "//meet.mysession.club/http-bind",  // (на случай, если ожидается нормальное имя)
    websocket: "wss://meet.mysession.club/xmpp-websocket",

    // optional: backup domain (если где-то хочешь юзать)
    backupDomain: "meet2.mysession.club",

    defaultLanguage: "en",
    enableWelcomePage: true,
    disableThirdPartyRequests: true,

    p2p: {
        enabled: true,
    },
};