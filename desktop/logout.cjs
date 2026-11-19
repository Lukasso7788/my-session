// Clear only this desktop profile; browser sessions are unaffected.
async function logoutDesktop(window, siteSession, closeAuth) {
  closeAuth();
  // Unload the site first so its auth timers cannot repopulate storage.
  await window.loadURL("about:blank");
  await siteSession.clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] });
  await siteSession.clearAuthCache();
  await window.loadURL("https://mysession.club/login");
}
module.exports = { logoutDesktop };
