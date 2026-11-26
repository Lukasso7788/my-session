import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LocalVideoTrack } from "livekit-client";
import { PreJoinModal } from "../../src/pages/livekit/PreJoinModalLiveKit";
import { LiveKitBottomBar } from "../../src/pages/livekit/LiveKitBottomBarLegacy";
import "../../src/index.css";

function device(deviceId:string,label:string,kind:MediaDeviceKind):MediaDeviceInfo {
    return {deviceId,label,kind,groupId:"fixture",toJSON:()=>({deviceId,label,kind})};
}
const fixtures={audioInputs:[device("mic-usb","Microphone (Webcam)","audioinput"),device("mic-headset","Headset microphone","audioinput")],videoInputs:[device("obs","OBS Virtual Camera","videoinput"),device("camera","Integrated camera","videoinput")],audioOutputs:[device("default","System default","audiooutput"),device("headphones","Headphones","audiooutput")]};
function Preview(){
    const roomPreview=new URLSearchParams(location.search).get('mode')==='room';
    const theme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
    const [open,setOpen]=useState(true);
    const [timeZone,setTimeZone]=useState("Europe/Kyiv");
    const [task,setTask]=useState("Finish the outreach plan");
    const [value,setValue]=useState({displayName:"Yaroslav S",audioInputId:"mic-usb",videoInputId:"obs",audioOutputId:"default",audioEnabled:false,videoEnabled:true,echoCancellation:true,noiseSuppression:true,autoGainControl:true});
    const [devices,setDevices]=useState(roomPreview?{audioInputs:[] as MediaDeviceInfo[],videoInputs:[] as MediaDeviceInfo[],audioOutputs:[] as MediaDeviceInfo[]}:fixtures);
    const [refreshes,setRefreshes]=useState(0);
    const [mode,setMode]=useState<"off"|"blur"|"bg">("off");
    const [background,setBackground]=useState("");
    const [blur,setBlur]=useState(12);
    const [notice,setNotice]=useState("");
    const noop=()=>{};
    const refresh=()=>{setRefreshes(n=>n+1);setDevices(fixtures);};
    const preview=useMemo(()=>({attach(){const image=document.createElement('img');image.src='/blog/how-to-find-an-online-study-partner/library-study-partners.jpg';image.alt='Sample camera preview photo; no live camera access';return image;},detach(){}}) as unknown as LocalVideoTrack,[]);
    return <main id="prejoin-compact-fixture" style={{minHeight:'100dvh',background:theme==='dark'?'#161616':'#eee',color:theme==='dark'?'white':'#222'}}>
        <style>{`#prejoin-compact-fixture .aspect-video::after{content:'Sample image · camera not accessed';position:absolute;bottom:12px;right:12px;padding:5px 9px;border-radius:20px;background:#171717aa;color:#ffffffb3;font:10px Inter,sans-serif;pointer-events:none}#prejoin-compact-fixture .ms-prejoin-compact-name{max-width:42%}`}</style>
        <div style={{position:'fixed',top:8,left:16,zIndex:2147483647,fontSize:10,opacity:.6}}>LOCAL PREVIEW · {roomPreview?'Room device menus':'Pre-join layout'}</div>
        {!roomPreview && <PreJoinModal tilePreview={{timeZone,task,onTimeZoneChange:setTimeZone,onTaskChange:setTask}} open={open} theme={theme} value={value} devices={devices} onChange={setValue} onJoin={()=>{setOpen(false);setNotice('Join selected — this preview does not connect to a room.');}} onCancel={()=>setOpen(false)} onRefreshDevices={refresh} onTestSpeaker={()=>setNotice('Sound test selected (demo)')} previewVideoTrack={preview} videoFxMode={mode} blurStrength={blur} bgImageUrl={background} fxApplying={false} fxError="" fxStatusText="" fxBgPresets={[{id:'room',label:'Quiet room',url:'/backgrounds/bg1.jpg'},{id:'library',label:'Library',url:'/blog/how-to-find-an-online-study-partner/library-study-partners.jpg'}]} customBackgroundSlots={[{id:'one',label:'Custom 1',dataUrl:'/backgrounds/bg2.jpg'},{id:'two',label:'Custom 2',dataUrl:'/backgrounds/bg3.jpg'}]} onApplyVideoFx={(next,url)=>{setMode(next);if(url)setBackground(url);}} onUploadCustomBackground={noop} onClearCustomBackground={noop} onBlurStrengthChange={setBlur} onSetBgImageUrl={setBackground} onResetBg={()=>setMode('off')}/>}
        {!open && <button onClick={()=>setOpen(true)} style={{padding:30}}>Reopen preview · {notice}</button>}
        {roomPreview && <><div style={{padding:50,fontSize:14}}>Camera can stay off. Open the microphone or camera arrow to refresh the demo device list.<br/><output aria-label="Device refresh count">Device refreshes: {refreshes}</output><br/><output aria-label="Selected devices">{value.audioInputId} / {value.videoInputId}</output></div><LiveKitBottomBar theme={theme} isLight={theme==='light'} bottomBarBg="bg-[#191919]" ctlBtnBase="bg-[#2F2F2F] text-white" connected micOn={value.audioEnabled} camOn={value.videoEnabled} screenShareOn={false} onToggleMic={()=>setValue(v=>({...v,audioEnabled:!v.audioEnabled}))} onToggleCam={()=>setValue(v=>({...v,videoEnabled:!v.videoEnabled}))} onRefreshMediaDevices={refresh} audioInputs={devices.audioInputs} videoInputs={devices.videoInputs} selectedAudioInputId={value.audioInputId} selectedVideoInputId={value.videoInputId} onChangeAudioInput={id=>setValue(v=>({...v,audioInputId:id}))} onChangeVideoInput={id=>setValue(v=>({...v,videoInputId:id}))} onToggleScreenShare={noop} onLeave={noop} onOpenParticipants={noop} onOpenChat={noop} onOpenTasks={noop} onOpenSettings={noop} onSendReaction={noop}/></>}
    </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
