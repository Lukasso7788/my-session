import fs from 'node:fs';

const path = 'src/pages/RoomPageLiveKit.tsx';
let text = fs.readFileSync(path, 'utf8');

const importAnchor = '  Track,\n  RemoteParticipant,';
if (!text.includes(importAnchor)) {
  throw new Error('LiveKit import anchor not found');
}
text = text.replace(importAnchor, '  Track,\n  AudioPresets,\n  RemoteParticipant,');

const publishAnchor = `      const publication = (await activeRoom.localParticipant.publishTrack(publishableAudioTrack, {
        source: Track.Source.ScreenShareAudio,
        name: SHARED_TAB_MUSIC_TRACK_NAME,
      } as any)) as LocalTrackPublication;`;
if (!text.includes(publishAnchor)) {
  throw new Error('shared tab music publish anchor not found');
}
text = text.replace(
  publishAnchor,
  `      const publication = (await activeRoom.localParticipant.publishTrack(
        publishableAudioTrack,
        {
          source: Track.Source.ScreenShareAudio,
          name: SHARED_TAB_MUSIC_TRACK_NAME,
          audioPreset: AudioPresets.musicHighQualityStereo,
          forceStereo: true,
          dtx: false,
          red: false,
        } as any,
      )) as LocalTrackPublication;`,
);

fs.writeFileSync(path, text);
// temporary trigger for the one-shot patch workflow
