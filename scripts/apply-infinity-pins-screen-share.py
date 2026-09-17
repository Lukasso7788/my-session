from pathlib import Path


def patch(path: str, replacements):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    for item in replacements:
        if len(item) == 2:
            old, new = item
            expected = 1
        else:
            old, new, expected = item
        count = text.count(old)
        if count != expected:
            raise RuntimeError(f"{path}: expected {expected} occurrence(s), found {count}: {old[:120]!r}")
        text = text.replace(old, new)
    p.write_text(text, encoding="utf-8")


# Shared room policy model / schedule compatibility.
patch("src/lib/roomPolicies.ts", [
    (
        "  publicChatDisabled: boolean;\n  microphoneLocked?: boolean;",
        "  publicChatDisabled: boolean;\n  screenShareRequired?: boolean;\n  microphoneLocked?: boolean;",
    ),
    (
        "  publicChatDisabled: false,\n  microphoneLocked: false,",
        "  publicChatDisabled: false,\n  screenShareRequired: false,\n  microphoneLocked: false,",
    ),
    (
        "    publicChatDisabled: raw.public_chat_disabled === true,\n    microphoneLocked: raw.microphone_locked === true,",
        "    publicChatDisabled: raw.public_chat_disabled === true,\n    screenShareRequired: raw.screen_share_required === true,\n    microphoneLocked: raw.microphone_locked === true,",
    ),
    (
        "        public_chat_disabled?: boolean | null;\n        microphone_locked?: boolean | null;",
        "        public_chat_disabled?: boolean | null;\n        screen_share_required?: boolean | null;\n        microphone_locked?: boolean | null;",
    ),
    (
        "    publicChatDisabled:\n      typeof session?.public_chat_disabled === \"boolean\"\n        ? session.public_chat_disabled\n        : legacy.publicChatDisabled,\n    microphoneLocked:",
        "    publicChatDisabled:\n      typeof session?.public_chat_disabled === \"boolean\"\n        ? session.public_chat_disabled\n        : legacy.publicChatDisabled,\n    screenShareRequired:\n      typeof session?.screen_share_required === \"boolean\"\n        ? session.screen_share_required\n        : legacy.screenShareRequired === true,\n    microphoneLocked:",
    ),
    (
        "    public_chat_disabled: policies.publicChatDisabled === true,\n    microphone_locked: policies.microphoneLocked === true,",
        "    public_chat_disabled: policies.publicChatDisabled === true,\n    screen_share_required: policies.screenShareRequired === true,\n    microphone_locked: policies.microphoneLocked === true,",
    ),
])


# Room settings UI: add a host-facing Screen share required toggle beside camera policy.
patch("src/pages/livekit/RoomSettingsModalLiveKit.tsx", [
    (
        "    cameraRequired = false,\n    publicChatDisabled = false,\n    onChangeCameraRequired,\n    onChangePublicChatDisabled,",
        "    cameraRequired = false,\n    screenShareRequired = false,\n    publicChatDisabled = false,\n    onChangeCameraRequired,\n    onChangeScreenShareRequired,\n    onChangePublicChatDisabled,",
    ),
    (
        "    cameraRequired?: boolean;\n    publicChatDisabled?: boolean;\n    onChangeCameraRequired?: (value: boolean) => void;\n    onChangePublicChatDisabled?: (value: boolean) => void;",
        "    cameraRequired?: boolean;\n    screenShareRequired?: boolean;\n    publicChatDisabled?: boolean;\n    onChangeCameraRequired?: (value: boolean) => void;\n    onChangeScreenShareRequired?: (value: boolean) => void;\n    onChangePublicChatDisabled?: (value: boolean) => void;",
    ),
    (
        "                                <ToggleRow\n                                    label=\"Disable public chat\"",
        "                                <ToggleRow\n                                    label=\"Screen share required\"\n                                    description=\"Participants get two reminders and are disconnected if screen sharing stays off. Hosts and moderators are exempt.\"\n                                    checked={screenShareRequired}\n                                    onChange={(value) => onChangeScreenShareRequired?.(value)}\n                                    isLight={isLight}\n                                />\n                                <ToggleRow\n                                    label=\"Disable public chat\"",
    ),
])


# Sessions list: load the new DB fields optionally, pin Infinity rooms first, and expose super-admin pin action.
patch("src/pages/SessionsPage.tsx", [
    (
        "  is_private?: boolean;\n  is_hidden?: boolean;",
        "  is_private?: boolean;\n  is_hidden?: boolean;\n  is_pinned?: boolean;",
    ),
    (
        "  camera_required?: boolean | null;\n  public_chat_disabled?: boolean | null;",
        "  camera_required?: boolean | null;\n  screen_share_required?: boolean | null;\n  public_chat_disabled?: boolean | null;",
    ),
    (
        ".select(\"id, camera_required, public_chat_disabled\")",
        ".select(\"id, camera_required, screen_share_required, public_chat_disabled, is_pinned\")",
    ),
    (
        "  const visibleSessions = useMemo(() => {\n    if (sessionTypeTab === \"infinite\") return typeFilteredSessions;",
        "  const visibleSessions = useMemo(() => {\n    if (sessionTypeTab === \"infinite\") {\n      return typeFilteredSessions\n        .map((session, index) => ({ session, index }))\n        .sort((a, b) => {\n          const pinDelta = Number(b.session.is_pinned === true) - Number(a.session.is_pinned === true);\n          return pinDelta || a.index - b.index;\n        })\n        .map(({ session }) => session);\n    }",
    ),
    (
        "      camera_required?: boolean;\n      public_chat_disabled?: boolean;",
        "      camera_required?: boolean;\n      screen_share_required?: boolean;\n      public_chat_disabled?: boolean;",
    ),
    (
        "  const inviteToSession = async (\n",
        "  const setSessionPinned = async (sessionId: string, pinned: boolean) => {\n    if (!user || !isSuperAdmin) {\n      throw new Error(\"Super-admin access is required.\");\n    }\n\n    const { error } = await supabase.rpc(\"set_infinite_room_catalog_pinned\", {\n      p_session_id: sessionId,\n      p_pinned: pinned,\n    });\n\n    if (error) throw error;\n\n    setSessions((previous) =>\n      previous.map((session) =>\n        String(session.id) === String(sessionId)\n          ? { ...session, is_pinned: pinned }\n          : session\n      )\n    );\n  };\n\n  const inviteToSession = async (\n",
    ),
    (
        "      onVisibilityChange={isSuperAdmin ? setSessionHidden : undefined}\n",
        "      onVisibilityChange={isSuperAdmin ? setSessionHidden : undefined}\n      onPinnedChange={isSuperAdmin ? setSessionPinned : undefined}\n",
    ),
])


# Session card: super-admin pin/unpin menu action and edit-modal support for screen-share policy.
patch("src/components/SessionCard.tsx", [
    (
        "Lock, Eye, EyeOff, Camera, MessageSquareOff } from \"lucide-react\";",
        "Lock, Eye, EyeOff, Pin, PinOff, Camera, MessageSquareOff } from \"lucide-react\";",
    ),
    (
        "            camera_required?: boolean;\n            public_chat_disabled?: boolean;",
        "            camera_required?: boolean;\n            screen_share_required?: boolean;\n            public_chat_disabled?: boolean;",
    ),
    (
        "    onVisibilityChange?: (sessionId: string, hidden: boolean) => void | Promise<void>;\n",
        "    onVisibilityChange?: (sessionId: string, hidden: boolean) => void | Promise<void>;\n    onPinnedChange?: (sessionId: string, pinned: boolean) => void | Promise<void>;\n",
    ),
    (
        "        camera_required?: boolean;\n        public_chat_disabled?: boolean;",
        "        camera_required?: boolean;\n        screen_share_required?: boolean;\n        public_chat_disabled?: boolean;",
    ),
    (
        "    onVisibilityChange,\n    currentUser,",
        "    onVisibilityChange,\n    onPinnedChange,\n    currentUser,",
    ),
    (
        "    const [isSavingVisibility, setIsSavingVisibility] = useState(false);",
        "    const [isSavingVisibility, setIsSavingVisibility] = useState(false);\n    const [isSavingPinned, setIsSavingPinned] = useState(false);",
    ),
    (
        "    const canToggleVisibility = canManageAnySession && !!onVisibilityChange;\n    const isHidden = session?.is_hidden === true;",
        "    const canToggleVisibility = canManageAnySession && !!onVisibilityChange;\n    const canTogglePinned = canManageAnySession && isInfinite && !!onPinnedChange;\n    const isHidden = session?.is_hidden === true;\n    const isPinned = session?.is_pinned === true;",
    ),
    (
        "    const [editCameraRequired, setEditCameraRequired] = useState(initialRoomPolicies.cameraRequired);\n    const [editPublicChatDisabled, setEditPublicChatDisabled] = useState(initialRoomPolicies.publicChatDisabled);",
        "    const [editCameraRequired, setEditCameraRequired] = useState(initialRoomPolicies.cameraRequired);\n    const [editScreenShareRequired, setEditScreenShareRequired] = useState(initialRoomPolicies.screenShareRequired === true);\n    const [editPublicChatDisabled, setEditPublicChatDisabled] = useState(initialRoomPolicies.publicChatDisabled);",
    ),
    (
        "        setEditCameraRequired(nextPolicies.cameraRequired);\n        setEditPublicChatDisabled(nextPolicies.publicChatDisabled);",
        "        setEditCameraRequired(nextPolicies.cameraRequired);\n        setEditScreenShareRequired(nextPolicies.screenShareRequired === true);\n        setEditPublicChatDisabled(nextPolicies.publicChatDisabled);",
    ),
    (
        ".select(\"camera_required, public_chat_disabled, schedule\")",
        ".select(\"camera_required, screen_share_required, public_chat_disabled, schedule\")",
    ),
    (
        "                setEditCameraRequired(policies.cameraRequired);\n                setEditPublicChatDisabled(policies.publicChatDisabled);",
        "                setEditCameraRequired(policies.cameraRequired);\n                setEditScreenShareRequired(policies.screenShareRequired === true);\n                setEditPublicChatDisabled(policies.publicChatDisabled);",
    ),
    (
        "        session?.camera_required,\n        session?.public_chat_disabled,",
        "        session?.camera_required,\n        session?.screen_share_required,\n        session?.public_chat_disabled,",
    ),
    (
        "                                    cameraRequired: editCameraRequired,\n                                    publicChatDisabled: editPublicChatDisabled,",
        "                                    cameraRequired: editCameraRequired,\n                                    screenShareRequired: editScreenShareRequired,\n                                    publicChatDisabled: editPublicChatDisabled,",
    ),
    (
        "                                updates.camera_required = editCameraRequired;\n                                updates.public_chat_disabled = editPublicChatDisabled;",
        "                                updates.camera_required = editCameraRequired;\n                                updates.screen_share_required = editScreenShareRequired;\n                                updates.public_chat_disabled = editPublicChatDisabled;",
    ),
    (
        "                        <button\n                            type=\"button\"\n                            onClick={() => setEditPublicChatDisabled((value) => !value)}",
        "                        <button\n                            type=\"button\"\n                            onClick={() => setEditScreenShareRequired((value) => !value)}\n                            className={`rounded-[16px] px-4 py-3 text-left transition ${editScreenShareRequired ? \"bg-[#2F2F2F] text-white\" : \"bg-[#F3F3F3] text-[#344054] hover:bg-[#EAEAEA]\"}`}\n                            aria-pressed={editScreenShareRequired}\n                        >\n                            <div className=\"text-[13px] font-semibold\">Screen share required</div>\n                            <div className={`mt-1 text-[11px] leading-4 ${editScreenShareRequired ? \"text-white/70\" : \"text-[#667085]\"}`}>\n                                Warn twice, then disconnect participants who do not share their screen.\n                            </div>\n                        </button>\n                        <button\n                            type=\"button\"\n                            onClick={() => setEditPublicChatDisabled((value) => !value)}",
    ),
    (
        "                                        {canToggleVisibility && (\n",
        "                                        {canTogglePinned && (\n                                            <MenuItem\n                                                icon={isPinned ? <PinOff /> : <Pin />}\n                                                label={\n                                                    isSavingPinned\n                                                        ? \"Saving…\"\n                                                        : isPinned\n                                                          ? \"Unpin from top\"\n                                                          : \"Pin to top\"\n                                                }\n                                                outlined\n                                                onClick={async () => {\n                                                    if (isSavingPinned) return;\n                                                    setIsSavingPinned(true);\n                                                    try {\n                                                        await onPinnedChange?.(session.id, !isPinned);\n                                                        setIsOptionsOpen(false);\n                                                    } catch (error) {\n                                                        console.error(\"[SessionCard] pin update failed:\", error);\n                                                        window.alert(\"Could not update pinned state. Please try again.\");\n                                                    } finally {\n                                                        setIsSavingPinned(false);\n                                                    }\n                                                }}\n                                            />\n                                        )}\n\n                                        {canToggleVisibility && (\n",
    ),
])


# Session creation: make Screen share required available wherever Cameras required is configured.
patch("src/components/CreateSessionModal.tsx", [
    (
        "  const [cameraRequired, setCameraRequired] = useState(false);\n  const [publicChatDisabled, setPublicChatDisabled] = useState(false);",
        "  const [cameraRequired, setCameraRequired] = useState(false);\n  const [screenShareRequired, setScreenShareRequired] = useState(false);\n  const [publicChatDisabled, setPublicChatDisabled] = useState(false);",
    ),
    (
        "    setCameraRequired(false);\n    setPublicChatDisabled(false);",
        "    setCameraRequired(false);\n    setScreenShareRequired(false);\n    setPublicChatDisabled(false);",
    ),
    (
        "        cameraRequired,\n        publicChatDisabled,",
        "        cameraRequired,\n        screenShareRequired,\n        publicChatDisabled,",
    ),
    (
        "          camera_required: cameraRequired,\n          public_chat_disabled: publicChatDisabled,",
        "          camera_required: cameraRequired,\n          screen_share_required: screenShareRequired,\n          public_chat_disabled: publicChatDisabled,",
    ),
    (
        "                    <button\n                      type=\"button\"\n                      onClick={() => setPublicChatDisabled((value) => !value)}",
        "                    <button\n                      type=\"button\"\n                      onClick={() => setScreenShareRequired((value) => !value)}\n                      className={`rounded-[14px] px-4 py-3 text-left transition ${screenShareRequired ? \"bg-[#2F2F2F] text-white\" : \"bg-[#F3F3F3] text-[#344054] hover:bg-[#EBEBEB]\"}`}\n                      aria-pressed={screenShareRequired}\n                    >\n                      <div className=\"font-inter text-[13px] font-semibold\">Screen share required</div>\n                      <div className={`mt-1 font-inter text-[11px] leading-4 ${screenShareRequired ? \"text-white/70\" : \"text-[#667085]\"}`}>\n                        Participants get two reminders, then are disconnected if screen sharing stays off.\n                      </div>\n                    </button>\n\n                    <button\n                      type=\"button\"\n                      onClick={() => setPublicChatDisabled((value) => !value)}",
    ),
])


# Live room: persist policy, expose setting, and enforce it with the same grace/reminder cadence as camera-required.
patch("src/pages/RoomPageLiveKit.tsx", [
    (
        "  camera_required?: boolean | null;\n  public_chat_disabled?: boolean | null;",
        "  camera_required?: boolean | null;\n  screen_share_required?: boolean | null;\n  public_chat_disabled?: boolean | null;",
    ),
    (
        "  presentation?: \"camera-reminder\";",
        "  presentation?: \"camera-reminder\" | \"screen-share-reminder\";",
    ),
    (
        "  const cameraPolicyTimerRef = useRef<number | null>(null);",
        "  const cameraPolicyTimerRef = useRef<number | null>(null);\n  const screenSharePolicyTimerRef = useRef<number | null>(null);",
    ),
    (
        "      session?.camera_required,\n      session?.public_chat_disabled,",
        "      session?.camera_required,\n      session?.screen_share_required,\n      session?.public_chat_disabled,",
    ),
    (
        "    const previousCameraRequired = session.camera_required;\n    const previousPublicChatDisabled = session.public_chat_disabled;",
        "    const previousCameraRequired = session.camera_required;\n    const previousScreenShareRequired = session.screen_share_required;\n    const previousPublicChatDisabled = session.public_chat_disabled;",
    ),
    (
        "            camera_required: next.cameraRequired,\n            public_chat_disabled: next.publicChatDisabled,",
        "            camera_required: next.cameraRequired,\n            screen_share_required: next.screenShareRequired === true,\n            public_chat_disabled: next.publicChatDisabled,",
        1,
    ),
    (
        "        camera_required: next.cameraRequired,\n        public_chat_disabled: next.publicChatDisabled,",
        "        camera_required: next.cameraRequired,\n        screen_share_required: next.screenShareRequired === true,\n        public_chat_disabled: next.publicChatDisabled,",
        1,
    ),
    (
        "              camera_required: previousCameraRequired,\n              public_chat_disabled: previousPublicChatDisabled,",
        "              camera_required: previousCameraRequired,\n              screen_share_required: previousScreenShareRequired,\n              public_chat_disabled: previousPublicChatDisabled,",
    ),
    (
        "    roomPolicies.cameraRequired,\n  ]);\n\n  voiceUiCommandHandlerRef.current = async (command: VoiceUiCommand) => {",
        "    roomPolicies.cameraRequired,\n  ]);\n\n  useEffect(() => {\n    if (screenSharePolicyTimerRef.current !== null) {\n      window.clearTimeout(screenSharePolicyTimerRef.current);\n      screenSharePolicyTimerRef.current = null;\n    }\n\n    if (\n      !connected ||\n      !roomPolicies.screenShareRequired ||\n      isHost ||\n      isSelfModerator ||\n      screenShareOn ||\n      kickRedirecting\n    ) {\n      return;\n    }\n\n    let cancelled = false;\n    const schedule = (callback: () => void, delayMs: number) => {\n      screenSharePolicyTimerRef.current = window.setTimeout(() => {\n        screenSharePolicyTimerRef.current = null;\n        if (!cancelled) callback();\n      }, delayMs);\n    };\n\n    const disconnectForScreenSharePolicy = () => {\n      void (async () => {\n        kickedBySignalRef.current = true;\n        setKickRedirecting(true);\n        await disconnectRoom({\n          skipNavigate: true,\n          preserveKickNotice: true,\n        });\n        setSystemNotice({\n          open: true,\n          kind: \"kick\",\n          title: \"Screen share required\",\n          body: \"The host enabled screen-share-only mode, so you were disconnected from the room.\",\n        });\n      })();\n    };\n\n    const showReminder = (reminder: 1 | 2) => {\n      showSystemNotice({\n        kind: \"info\",\n        presentation: \"screen-share-reminder\",\n        title: \"Please share your screen\",\n        body:\n          reminder === 1\n            ? \"This room requires screen sharing. Please start sharing within two minutes of joining to stay in the room.\"\n            : \"Your screen is still not being shared. This is the final reminder; start sharing within 30 seconds to stay in the room.\",\n        actionLabel: \"Share screen\",\n        action: () => {\n          if (!screenShareOn) void toggleScreenShare();\n        },\n      });\n    };\n\n    schedule(() => {\n      showReminder(1);\n      schedule(() => {\n        showReminder(2);\n        schedule(disconnectForScreenSharePolicy, 30_000);\n      }, 70_000);\n    }, 20_000);\n\n    return () => {\n      cancelled = true;\n      if (screenSharePolicyTimerRef.current !== null) {\n        window.clearTimeout(screenSharePolicyTimerRef.current);\n        screenSharePolicyTimerRef.current = null;\n      }\n    };\n  }, [\n    connected,\n    isHost,\n    isSelfModerator,\n    kickRedirecting,\n    roomPolicies.screenShareRequired,\n    screenShareOn,\n  ]);\n\n  voiceUiCommandHandlerRef.current = async (command: VoiceUiCommand) => {",
    ),
    (
        "          cameraRequired={roomPolicies.cameraRequired}\n          publicChatDisabled={roomPolicies.publicChatDisabled}\n          onChangeCameraRequired={(value) => {",
        "          cameraRequired={roomPolicies.cameraRequired}\n          screenShareRequired={roomPolicies.screenShareRequired === true}\n          publicChatDisabled={roomPolicies.publicChatDisabled}\n          onChangeCameraRequired={(value) => {",
    ),
    (
        "          onChangePublicChatDisabled={(value) => {\n",
        "          onChangeScreenShareRequired={(value) => {\n            void updateRoomPolicies({\n              ...roomPolicies,\n              screenShareRequired: value,\n            });\n          }}\n          onChangePublicChatDisabled={(value) => {\n",
    ),
    (
        "{systemNotice.presentation === \"camera-reminder\" ? \"Not now\" : \"OK\"}",
        "{systemNotice.presentation === \"camera-reminder\" || systemNotice.presentation === \"screen-share-reminder\" ? \"Not now\" : \"OK\"}",
    ),
])


migration = '''begin;

alter table public.sessions
  add column if not exists is_pinned boolean not null default false,
  add column if not exists screen_share_required boolean not null default false;

comment on column public.sessions.is_pinned is
  'Super-admin catalog ordering flag for Infinity rooms. No end-user badge is rendered.';

comment on column public.sessions.screen_share_required is
  'When enabled, non-host participants are warned twice and disconnected if screen sharing remains off.';

update public.sessions
set screen_share_required = true
where coalesce(schedule #>> '{room_policies,screen_share_required}', 'false') = 'true'
  and screen_share_required = false;

create index if not exists sessions_infinite_pinned_catalog_idx
  on public.sessions (is_pinned desc, start_time, id)
  where is_hidden = false;

create or replace function public.set_infinite_room_catalog_pinned(
  p_session_id uuid,
  p_pinned boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  update public.sessions s
  set is_pinned = coalesce(p_pinned, false)
  where s.id = p_session_id
    and (
      lower(coalesce(s.session_format_type, '')) = 'infinite'
      or lower(coalesce(s.format, '')) = 'infinite'
      or coalesce(s.schedule ->> 'kind', '') = 'infinite_room'
      or jsonb_typeof(s.schedule -> 'timer' -> 'phases') = 'array'
      or jsonb_typeof(s.schedule -> 'phases') = 'array'
    );

  if not found then
    raise exception 'infinite_session_not_found';
  end if;

  return coalesce(p_pinned, false);
end;
$$;

revoke all on function public.set_infinite_room_catalog_pinned(uuid, boolean)
  from public, anon;
grant execute on function public.set_infinite_room_catalog_pinned(uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';

commit;
'''
Path("supabase/migrations/20260917000000_infinite_room_pins_and_screen_share_policy.sql").write_text(migration, encoding="utf-8")

print("Applied Infinity pinning and screen-share-required patches.")
