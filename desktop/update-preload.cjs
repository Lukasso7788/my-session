const {contextBridge,ipcRenderer}=require("electron");
let channel;
contextBridge.exposeInMainWorld("desktopUpdate", {
  onState(callback) {
    ipcRenderer.on("mysession:update-state",(_event,state)=>callback(state));
    ipcRenderer.on("mysession:update-channel",(_event,value)=>{channel=value;});
  },
  install(){if(channel)ipcRenderer.send(channel);}
});
