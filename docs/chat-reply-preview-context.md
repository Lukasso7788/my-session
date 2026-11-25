# MySession reply composer banner — 2026-11-25

User requested a modern redesign of the selected reply preview ABOVE the chat input, followed by commit/push to main. This is not the quote inside an already-sent message.

Working directory C:/projects/mysession-chat-reply, branch codex/chat-reply-banner, fresh worktree from origin/main 39a3b10500af813d067155bdc49884d0dd529d04. Original music-personal-dark worktree and separate Desktop local voice changes are preserved. No production database, authentication, API or configuration changes.

MySession is React 18/Vite/TypeScript with Supabase Auth/database/realtime and LiveKit room media. The room controller src/pages/RoomPageLiveKit.tsx mounts src/components/ChatPanel.tsx. ChatPanel owns replyTo state, chat scope/DM compatibility, quotePreviewForReply text extraction and actual message send. Those contracts remain unchanged. This task only replaces the replyTo composer banner markup with ChatReplyPreview.tsx and scoped chatReplyPreview.css. Other messages, reactions, composer input, voice recording, chat headers and sent-message quoting are not restyled.

Design: existing neutral light/dark chat surfaces, compact reply arrow badge, slim blue accent, separate author heading, readable two-line excerpt with long-word wrapping, circular accessible cancel control and focus-visible outline. Parent passes author, preformatted preview, theme and existing setReplyTo(null) callback. No data writes or new state/effects in the component.

Verify actual rendered component at narrow widths and in both themes; check long author/message clipping, cancel callback, keyboard focus. Use existing dependencies via local node_modules junction if needed, do not commit generated preview/build artifacts. Stage source/CSS/context by exact filename. User explicitly authorized commit and push to main; fetch/rebase against latest main before pushing and verify the remote commit. Publication/deployment is separate from a successful Git push.
