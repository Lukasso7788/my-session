const { Menu, clipboard, shell } = require("electron");

function attachContextMenu(window) {
  const web = window.webContents;
  web.on("context-menu", (_event, params) => {
    if (window.isDestroyed() || web.isDestroyed()) return;
    const history = web.navigationHistory;
    const template = [
      { label: "Back", enabled: history.canGoBack(), click: () => { if (history.canGoBack()) history.goBack(); } },
      { label: "Forward", enabled: history.canGoForward(), click: () => { if (history.canGoForward()) history.goForward(); } },
      { label: "Refresh", accelerator: "Ctrl+R", click: () => web.reload() },
      { label: "Refresh without cache", accelerator: "Ctrl+Shift+R", click: () => web.reloadIgnoringCache() },
    ];

    if (params.isEditable) {
      const flags = params.editFlags;
      template.push(
        { type: "separator" },
        { role: "undo", enabled: flags.canUndo },
        { role: "redo", enabled: flags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: flags.canCut },
        { role: "copy", enabled: flags.canCopy },
        { role: "paste", enabled: flags.canPaste },
        { role: "selectAll", enabled: flags.canSelectAll },
      );
    } else if (params.selectionText) {
      template.push({ type: "separator" }, { role: "copy" }, { role: "selectAll" });
    }

    let link;
    try {
      const url = new URL(params.linkURL);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) link = url.href;
    } catch {}
    if (link) {
      template.push(
        { type: "separator" },
        { label: "Copy link address", click: () => clipboard.writeText(link) },
        { label: "Open link in browser", click: () => { void shell.openExternal(link).catch(() => {}); } },
      );
    }
    template.push(
      { type: "separator" },
      { label: "Zoom", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
      { role: "togglefullscreen" },
    );
    Menu.buildFromTemplate(template).popup({ window });
  });
}

module.exports = { attachContextMenu };
