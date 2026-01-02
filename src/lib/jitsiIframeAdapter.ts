export type JitsiIframeEvents = {
  onJoined?: () => void;
  onLeft?: () => void;
  onAudioMuteChanged?: (muted: boolean) => void;
  onVideoMuteChanged?: (muted: boolean) => void;
  onParticipantsChanged?: (count: number) => void;
  onError?: (msg: string) => void;
};

export class JitsiIframeAdapter {
  private api: any | null = null;
  private mounted = false;

  constructor(
    private domain: string,
    private roomName: string,
    private displayName: string,
    private parentNode: HTMLElement,
    private events: JitsiIframeEvents = {}
  ) {}

  mount(opts?: {
    jwt?: string;
    subject?: string;
    // можно расширить потом
  }) {
    if (this.mounted) return;
    this.mounted = true;

    const w = window as any;
    const ExternalAPI = w.JitsiMeetExternalAPI;
    if (!ExternalAPI) throw new Error("JitsiMeetExternalAPI is not loaded");

    const options: any = {
      roomName: this.roomName,
      parentNode: this.parentNode,
      userInfo: { displayName: this.displayName },
      jwt: opts?.jwt,
      configOverwrite: {
        // важно: отключаем P2P
        p2p: { enabled: false },
        disableInviteFunctions: true,
        prejoinPageEnabled: false,
        // можно убрать лишнее внутри, ты всё равно рисуешь свой UI
        toolbarButtons: [],
        disableDeepLinking: true,
        startWithAudioMuted: false,
        startWithVideoMuted: false,
      },
      interfaceConfigOverwrite: {
        // чтобы вообще не мешал их UI
        TOOLBAR_BUTTONS: [],
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        DEFAULT_BACKGROUND: "#000000",
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
        MOBILE_APP_PROMO: false,
      },
    };

    this.api = new ExternalAPI(this.domain, options);

    // ---- events ----
    this.api.addListener("videoConferenceJoined", () => this.events.onJoined?.());
    this.api.addListener("videoConferenceLeft", () => this.events.onLeft?.());

    this.api.addListener("audioMuteStatusChanged", (e: any) =>
      this.events.onAudioMuteChanged?.(!!e?.muted)
    );
    this.api.addListener("videoMuteStatusChanged", (e: any) =>
      this.events.onVideoMuteChanged?.(!!e?.muted)
    );

    // участники: external api имеет несколько событий, используем самое простое
    const emitCount = async () => {
      try {
        const info = await this.api.getParticipantsInfo();
        this.events.onParticipantsChanged?.(Array.isArray(info) ? info.length : 1);
      } catch {
        // ignore
      }
    };

    this.api.addListener("participantJoined", emitCount);
    this.api.addListener("participantLeft", emitCount);

    // первичная синхронизация
    emitCount().catch(() => {});
  }

  dispose() {
    try {
      this.api?.dispose?.();
    } catch {}
    this.api = null;
    this.mounted = false;
  }

  // ---- controls ----
  toggleAudio() {
    this.api?.executeCommand?.("toggleAudio");
  }
  toggleVideo() {
    this.api?.executeCommand?.("toggleVideo");
  }
  toggleScreenShare() {
    this.api?.executeCommand?.("toggleShareScreen");
  }
  hangup() {
    this.api?.executeCommand?.("hangup");
  }

  // полезно: если хочешь принудительно выключить
  setAudioMuted(muted: boolean) {
    this.api?.executeCommand?.("toggleAudio"); // external api не всегда имеет set, проще синхронизировать через события
  }
}
