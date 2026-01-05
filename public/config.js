var config = {
    hosts: {
        domain: "meet2.mysession.club",
        muc: "conference.meet2.mysession.club",
    },

    // ✅ Добавил оба варианта, чтобы точно не сломалось
    bosheURL: "//meet2.mysession.club/http-bind", // (оставляем, если где-то у тебя это ожидается)
    boshURL: "//meet2.mysession.club/http-bind",  // (на случай, если ожидается нормальное имя)
    websocket: "wss://meet2.mysession.club/xmpp-websocket",

    // optional: backup domain (если где-то хочешь юзать)
    backupDomain: "meet.mysession.club",

    defaultLanguage: "en",
    enableWelcomePage: true,
    disableThirdPartyRequests: true,

    p2p: {
        enabled: true,
    },
};