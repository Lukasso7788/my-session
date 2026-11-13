# Room status icons

Repository Lukasso7788/my-session. Local worktree C:/projects/msa-hg based on d535a62. General architecture, services, and development entry points are documented in [MySession project context](my-session-project-context.md).

The React room entry point is src/pages/RoomPageLiveKit.tsx. Its own-tile menu now renders RoomStatusMenu from src/pages/livekit. This component maps the existing status values to Lucide icons and labels. The room still calls setMyStatus, closes the tile menu and rebuilds tiles on selection. LiveKit participant metadata continues to carry status. The preview uses the same menu with local React state and no room connection.

Run npm run dev -- --host 127.0.0.1 --port 4238 and open /tests/browser/room-status-icons.html for light and dark themes. Browser check confirmed the dark menu selected On a call. Live room behavior still needs verification. This change is local. Preserve other in-progress work in this worktree.

Private uses Lucide EyeOff, matching the Hidden badge in SessionCard. Status icons are rendered in the selection menu.
