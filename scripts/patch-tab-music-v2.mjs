import fs from 'node:fs';

const path = 'src/pages/RoomPageLiveKit.tsx';
let text = fs.readFileSync(path, 'utf8');

const replaceOnce = (from, to, label) => {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  text = text.replace(from, to);
};

replaceOnce(
  '  Track,\n  AudioPresets,\n  RemoteParticipant,',
  '  Track,\n  RemoteParticipant,',
  'remove AudioPresets import',
);

replaceOnce(
  `type RoomSoundtrackPacket =\n  | { type: \"soundtrack_state\"; state: RoomSoundtrackState }\n  | { type: \"soundtrack_request\"; requestedAt: number };`,
  `type RoomSoundtrackPacket =\n  | { type: \"soundtrack_state\"; state: RoomSoundtrackState }\n  | { type: \"soundtrack_request\"; requestedAt: number }\n  | { type: \"shared_tab_music_volume\"; volume: number; updatedAt: number };`,
  'extend soundtrack packet type',
);

const processingPattern = /      let publishableAudioTrack: MediaStreamTrack = audioTrack;\n      const AudioContextCtor =[\s\S]*?      }\n\n      const publication = \(await activeRoom\.localParticipant\.publishTrack\(/;
const processingMatches = text.match(processingPattern);
if (!processingMatches || processingMatches.length !== 1) {
  throw new Error(`direct transport block: expected exactly 1 match, found ${processingMatches?.length || 0}`);
}
text = text.replace(
  processingPattern,
  `      // Preserve the browser tab capture all the way to the WebRTC sender.\n      // WebAudio is intentionally kept out of the transmission path: routing\n      // tab audio through MediaStreamAudioDestinationNode can alter channel\n      // layout/resampling before Opus sees the signal.\n      try {\n        audioTrack.contentHint = \"music\";\n      } catch {\n        // Older Chromium builds may expose contentHint as read-only/unsupported.\n      }\n\n      const AudioContextCtor =\n        window.AudioContext ||\n        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;\n\n      // Chromium can suppress the source tab's native local playback while it\n      // is captured. If so, build a LOCAL-ONLY monitor so the host still hears\n      // the room-music volume/mute state. This graph is never published.\n      if (canSuppressLocalTabPlayback && AudioContextCtor) {\n        const audioContext = new AudioContextCtor();\n        const sourceNode = audioContext.createMediaStreamSource(\n          new MediaStream([audioTrack]),\n        );\n        const monitorGain = audioContext.createGain();\n        const roomVolume = Math.max(0, Math.min(1, roomSoundscapeVolume / 100));\n        monitorGain.gain.value =\n          soundscapeMuted || soundscapeListeningMode === \"personal\"\n            ? 0\n            : roomVolume;\n        sourceNode.connect(monitorGain);\n        monitorGain.connect(audioContext.destination);\n\n        sharedTabMusicAudioContextRef.current = audioContext;\n        sharedTabMusicSourceNodeRef.current = sourceNode;\n        sharedTabMusicMonitorGainRef.current = monitorGain;\n        sharedTabMusicRoomGainRef.current = null;\n        sharedTabMusicDestinationRef.current = null;\n\n        try {\n          if (audioContext.state === \"suspended\") await audioContext.resume();\n        } catch {\n          // The user capture gesture normally unlocks audio.\n        }\n      }\n\n      const publication = (await activeRoom.localParticipant.publishTrack(`,
);

replaceOnce(
  `        publishableAudioTrack,\n        {\n          source: Track.Source.ScreenShareAudio,\n          name: SHARED_TAB_MUSIC_TRACK_NAME,\n          audioPreset: AudioPresets.musicHighQualityStereo,\n          forceStereo: true,\n          dtx: false,\n          red: false,\n        } as any,`,
  `        audioTrack,\n        {\n          source: Track.Source.ScreenShareAudio,\n          name: SHARED_TAB_MUSIC_TRACK_NAME,\n          // Keep enough Opus headroom for full-range stereo music instead of\n          // inheriting the room's lower voice-oriented/default audio budget.\n          audioPreset: { maxBitrate: 192_000, priority: \"high\" },\n          forceStereo: true,\n          dtx: false,\n          red: false,\n        } as any,`,
  'publish original tab audio at 192 kbps stereo',
);

replaceOnce(
  `      sharedTabMusicPublicationRef.current = publication;\n      setSharingTabMusic(true);`,
  `      sharedTabMusicPublicationRef.current = publication;\n      setSharingTabMusic(true);\n      void publishSoundtrackPacket({\n        type: \"shared_tab_music_volume\",\n        volume: roomSoundscapeVolume,\n        updatedAt: Date.now(),\n      }).catch(() => { });`,
  'publish initial shared tab volume',
);

replaceOnce(
  `(publication.track as RemoteAudioTrack).setVolume(locallyMuted ? 0 : 1);`,
  `(publication.track as RemoteAudioTrack).setVolume(\n            locallyMuted\n              ? 0\n              : Math.max(0, Math.min(1, roomSoundscapeVolume / 100)),\n          );`,
  'apply receiver-side room volume',
);

replaceOnce(
  `  }, [connected, roomState, soundscapeListeningMode, soundscapeMuted]);`,
  `  }, [\n    connected,\n    roomState,\n    roomSoundscapeVolume,\n    soundscapeListeningMode,\n    soundscapeMuted,\n  ]);`,
  'refresh remote tab volume on room volume changes',
);

replaceOnce(
  `    setRoomSoundscapeVolume(volume);\n    soundscapeEngineRef.current?.setVolume(volume / 100);\n\n    const current = soundscapeStateRef.current;`,
  `    setRoomSoundscapeVolume(volume);\n    soundscapeEngineRef.current?.setVolume(volume / 100);\n    // Shared tab music stays at full level before Opus. Broadcast only the\n    // control value; each listener applies it after receiving the track.\n    void publishSoundtrackPacket({\n      type: \"shared_tab_music_volume\",\n      volume,\n      updatedAt: Date.now(),\n    }).catch(() => { });\n\n    const current = soundscapeStateRef.current;`,
  'broadcast receiver-side volume control',
);

replaceOnce(
  `          applyRemoteState(packet.state);\n          return;\n        }\n        if (packet.type === \"soundtrack_request\" && canControlRoomSoundtrack) {\n          const current = soundscapeStateRef.current;`,
  `          applyRemoteState(packet.state);\n          return;\n        }\n        if (packet.type === \"shared_tab_music_volume\") {\n          if (!sender) return;\n          const senderUserId = extractBaseUserIdFromIdentity(\n            String(sender.identity || \"\"),\n          )\n            .trim()\n            .toLowerCase();\n          const senderCanControl =\n            (sender as any)?.permissions?.roomAdmin === true ||\n            participantControlSenderIdsRef.current.has(senderUserId);\n          if (!senderCanControl) return;\n          const nextVolume = Math.max(\n            0,\n            Math.min(\n              100,\n              Number.isFinite(Number(packet.volume)) ? Number(packet.volume) : 35,\n            ),\n          );\n          setRoomSoundscapeVolume(nextVolume);\n          soundscapeEngineRef.current?.setVolume(nextVolume / 100);\n          return;\n        }\n        if (packet.type === \"soundtrack_request\" && canControlRoomSoundtrack) {\n          void publishSoundtrackPacket({\n            type: \"shared_tab_music_volume\",\n            volume: roomSoundscapeVolume,\n            updatedAt: Date.now(),\n          }).catch(() => { });\n          const current = soundscapeStateRef.current;`,
  'receive and request shared tab volume state',
);

replaceOnce(
  `  }, [connected, roomState, canControlRoomSoundtrack, canUploadRoomSoundtrack]);`,
  `  }, [\n    connected,\n    roomState,\n    canControlRoomSoundtrack,\n    canUploadRoomSoundtrack,\n    roomSoundscapeVolume,\n  ]);`,
  'keep soundtrack listener volume state current',
);

// The sender-side room gain is no longer part of shared-tab transmission. Keep
// only the local monitor gain responsive to room volume and mute state.
const senderGainPattern = /  useEffect\(\(\) => \{\n    const roomVolume = Math\.max\(0, Math\.min\(1, roomSoundscapeVolume \/ 100\)\);\n    const roomGain = sharedTabMusicRoomGainRef\.current;[\s\S]*?  \}, \[roomSoundscapeVolume, soundscapeListeningMode, soundscapeMuted\]\);/;
const senderGainMatches = text.match(senderGainPattern);
if (!senderGainMatches || senderGainMatches.length !== 1) {
  throw new Error(`sender gain effect: expected exactly 1 match, found ${senderGainMatches?.length || 0}`);
}
text = text.replace(
  senderGainPattern,
  `  useEffect(() => {\n    const roomVolume = Math.max(0, Math.min(1, roomSoundscapeVolume / 100));\n    const monitorGain = sharedTabMusicMonitorGainRef.current;\n    if (monitorGain) {\n      try {\n        monitorGain.gain.value =\n          soundscapeMuted || soundscapeListeningMode === \"personal\"\n            ? 0\n            : roomVolume;\n      } catch { }\n    }\n  }, [roomSoundscapeVolume, soundscapeListeningMode, soundscapeMuted]);`,
);

fs.writeFileSync(path, text);
