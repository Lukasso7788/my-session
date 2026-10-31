# MySession room music: implementation handoff

MySession is a React, TypeScript and Vite application; rooms use LiveKit for participant media and soundtrack state. Supabase stores application data and Vercel hosts the frontend and APIs. This change is confined to the room music frontend; no database migration or service configuration is required.

`src/pages/RoomPageLiveKit.tsx` synchronizes the chosen track and playback position through LiveKit data packets. Room listening volume now belongs to the local device, is stored in localStorage as `ms_room_music_volume_v1`, defaults to 100 for a new device, and is applied locally to the soundtrack engine and received shared-tab audio. Legacy volume packets are ignored by updated listeners; packets sent to older clients carry a fixed compatibility value of 100. Hosts still control shared track selection and playback, not listener volume. Existing saved user volume is preserved. Personal soundtrack volume remains independently controlled. Mute remains a local preference.

`src/pages/livekit/RoomSoundscapePanel.tsx` presents the mute toggle in the volume row and selects a dark artwork variant. Seven `public/images/room-music/*-dark.svg` files provide the matching dark artwork; the original light variants remain. `scripts/room-music-personal-volume.test.mjs` checks local volume changes, remote track changes, and guest controls.

Verification limitations: automated tests model the guest/host logic; a live multi-participant LiveKit room and every supported browser must still be checked, particularly an older client sharing tab audio. The dark artwork retains the original illustrated geometry and uses a new darker palette.
