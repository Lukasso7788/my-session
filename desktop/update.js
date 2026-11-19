const button=document.getElementById("update");
window.desktopUpdate.onState(state=>{
  button.disabled=state.status==="downloading";
  button.textContent=state.status==="ready" ? "Restart to update · "+state.version
    : state.status==="downloading" ? "Downloading update · "+state.percent+"%"
    : state.status==="error" ? "Download failed · Click to retry"
    : "Click to update · "+state.version;
});
button.onclick=()=>window.desktopUpdate.install();
