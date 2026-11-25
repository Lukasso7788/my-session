# MySession compact reply composer — 2026-11-25

## Scope and authorization
User rejected the first published reply banner (82022b8), iterated locally, then explicitly approved the one-line design and requested commit/push to main. Approved row: reply arrow, actual author avatar, author name, subtle separator, ellipsized quoted text, cancel. Last correction: vertically center text and keep the no-quote composer compact like the supplied production screenshot. Do not restyle sent-message quotations, message bubbles, emoji reactions or the input itself.

## Repository
Worktree C:/projects/mysession-chat-reply-v2, branch codex/chat-reply-local-v2, initially based on origin/main 1c14c5293e9e1d3ae36adbd71aaab7cc3784074a. Original dirty music-personal-dark worktree, separate Desktop voice/Android work and dedicated download page are preserved. An initial local no-commit reverse of 82022b8 was used to restore the earlier UI during exploration; final patch now replaces the old component directly with the approved one. No separate rollback was published during exploration. Historical docs/chat-reply-preview-context.md remains for reference; this file supersedes its final design.

## Architecture and integration
MySession is React18/Vite/TypeScript with React Router, Supabase Auth/database/realtime and LiveKit media. src/pages/RoomPageLiveKit.tsx owns room state and renders src/components/ChatPanel.tsx. ChatPanel owns replyTo, active chat scope and DM compatibility, quotePreviewForReply extraction and actual send logic. These behavioral contracts remain unchanged. No database, API, auth, room, billing or message-send changes.

ChatPanel renders ChatReplyDraft.tsx inside the existing replyTo conditional, with actual replyTo.profile.avatar_url when present, the existing defaultAvatarUrl fallback otherwise, author full_name and existing quotePreviewForReply(body,220). Theme maps dark={!isLight}; cancel still setReplyTo(null). The obsolete ChatReplyPreview.tsx and chatReplyPreview.css are removed. No mock avatar URLs are used in production. Component is stateless; author remains in accessible group label, avatar alt/title and text tooltip. Long author caps at26% width; quoted text truncates to one line. Cancel retains keyboard focus outline and reduced-motion support.

Scoped chatReplyDraft.css provides a34px flex row,4px vertical padding,22px avatar and22px text line boxes aligned centrally. Light neutral-blue surface #e9edf5; dark #28303c. No separate icon badge, vertical accent bar or Reply to heading. Input footer padding is8px at top instead of10px; reply wrapper exists only while selected. The real composer receives no reserved quote height or extra empty row after cancellation. Input background/icons/shape remain existing production styles.

## Local fixture
/reply-preview-v2.html loads src/previews/replyPreviewV2.tsx and scoped preview CSS. It shows light/dark chat contexts with sample messages, existing Inter fonts and existing landing photo avatars. Reply chooses another message; cancel removes the row; textarea is editable. No production messages, database calls or sends. Fixture uses the same ChatReplyDraft component as production. Its input margin-top is0 normally and8px ONLY when the footer has a reply, fixing the preview-only doubled top gap. Example portraits are fixture assets only.

Run npm run dev -- --host127.0.0.1 --port4269 (use spaces: --host 127.0.0.1 --port 4269) and open http://127.0.0.1:4269/reply-preview-v2.html. node_modules locally junctions to C:/projects/mysession-desktop-hosted/node_modules; do not commit it. On a clean machine use npm ci.

## Verification and release
Vite production build passed after integration. Browser tested light/dark rendering, selecting another reply and cancellation. DOM measurement: row33.96px, quoted text center offset -0.01px (rounding); no-reply input starts9px below footer border. Preview retained in in-app browser. No live authenticated send/database mutation was tested or required for this presentation-only change. git diff --check before commit. Stage named source/CSS/fixture/context files, fetch/rebase current main, push without force and verify remote SHA. Push completion is not evidence of a verified Vercel production deployment.
