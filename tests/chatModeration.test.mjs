import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261013120000_moderators_delete_chat_messages.sql", "utf8");
const chat = readFileSync("src/components/ChatPanel.tsx", "utf8");
const room = readFileSync("src/pages/RoomPageLiveKit.tsx", "utf8");

test("the server function checks the caller's role itself and only touches public messages", () => {
  assert.match(sql, /create or replace function public\.moderate_delete_chat_message\(p_message_id text\)/);
  assert.match(sql, /security definer\s+set search_path = public/);
  assert.match(sql, /if v_uid is null then\s+raise exception 'auth_required'/);
  assert.match(sql, /if v_scope = 'direct' then\s+raise exception 'direct_messages_not_moderated'/);
  // Super-admin, host, session moderator, active temporary host.
  assert.match(sql, /public\.is_app_admin\(\)/);
  assert.match(sql, /from public\.sessions s\s+where s\.id = v_session_key and s\.host_id::text = v_uid::text/);
  assert.match(sql, /from public\.session_role_assignments r[\s\S]*r\.role = 'moderator'/);
  assert.match(sql, /from public\.infinite_room_host_leases h[\s\S]*h\.expires_at > now\(\)/);
  assert.match(sql, /raise exception 'not_allowed'/);
  // Reactions go with the message; nothing else is deleted.
  assert.match(sql, /delete from public\.session_chat_message_reactions where message_id::text = v_message_id::text;\s*delete from public\.session_chat_messages where id = v_message_id;/);
  assert.match(sql, /revoke all on function public\.moderate_delete_chat_message\(text\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.moderate_delete_chat_message\(text\) to authenticated;/);
});

test("own messages keep the existing delete; others' go through the server function", () => {
  assert.match(chat, /const moderating = !!deleted && deleted\.user_id !== userId;/);
  assert.match(chat, /\? await supabase\.rpc\("moderate_delete_chat_message", \{ p_message_id: messageId \}\)/);
  assert.match(chat, /\.eq\("id", messageId\)\s*\.eq\("session_id", sessionId\)\s*\.eq\("user_id", userId\);/);
});

test("only moderators see Delete on others' public, saved messages; editing stays own-only", () => {
  assert.match(chat, /const canModerate = canModerateMessages && !mine && m\.scope !== "direct" && !m\.id\.startsWith\("optimistic-"\);/);
  assert.match(chat, /\{canEdit && \(\s*<button[\s\S]*?title="Edit"/);
  assert.match(chat, /\{\(canEdit \|\| canModerate\) && \(/);
  assert.match(chat, /prev\.canModerate === next\.canModerate/);
  assert.match(chat, /canModerateMessages = false,/);
  // Both room chats (side panel and PiP) pass the room's moderator flag.
  assert.equal((room.match(/canModerateMessages=\{isSelfModerator\}/g) || []).length, 2);
  assert.match(room, /if \(isHost \|\| isTemporaryRoomHost \|\| isSuperAdmin\) return true;\s*return moderatorUserIds\.includes/);
});
