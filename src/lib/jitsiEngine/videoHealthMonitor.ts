// ============================================================================
// src/lib/jitsiEngine/videoHealthMonitor.ts
// Targeted "black video" recovery via <video> frame progression checks
// ============================================================================

export type VideoHealthDeps = {
    isDisposed: () => boolean;
    getConference: () => any | null;
    getParticipants: () => Record<string, any>;
    getSubscribedRemoteIds: () => { ids: string[]; desiredLastN: number };
};

export class VideoHealthMonitor {
    private deps: VideoHealthDeps;

    private videoElByPid = new Map<string, HTMLVideoElement>();
    private screenElByPid = new Map<string, HTMLVideoElement>();

    private videoHealthTimer: any = null;
    private healthSoonTimer: any = null;

    private readonly HEALTH_TICK_MS = 1500;
    private readonly STUCK_THRESHOLD_MS = 2500;

    private readonly REATTACH_COOLDOWN_MS = 4000;
    private readonly BUMP_COOLDOWN_MS = 8000;

    private videoHealthState = new Map<
        string,
        {
            lastFrameCount: number | null;
            lastCurrentTime: number;
            lastProgressAt: number;
            stuckSince: number | null;
            lastReattachAt: number;
            lastBumpAt: number;
            reattachAttemptsInWindow: number;
            lastAttemptWindowAt: number;
        }
    >();

    constructor(deps: VideoHealthDeps) {
        this.deps = deps;
    }

    public registerVideoElement(
        participantId: string,
        el: HTMLVideoElement | null | undefined,
        kind: "video" | "screen" = "video"
    ) {
        if (!participantId) return;
        const map = kind === "screen" ? this.screenElByPid : this.videoElByPid;

        if (!el) {
            map.delete(participantId);
            return;
        }

        map.set(participantId, el);
        this.tickSoon();
    }

    public unregisterParticipant(pid: string) {
        this.videoElByPid.delete(pid);
        this.screenElByPid.delete(pid);
        this.videoHealthState.delete(pid);
    }

    public start() {
        if (this.videoHealthTimer) return;
        this.videoHealthTimer = setInterval(() => {
            if (this.deps.isDisposed()) return;
            this.tick();
        }, this.HEALTH_TICK_MS);
    }

    public stop() {
        if (this.videoHealthTimer) clearInterval(this.videoHealthTimer);
        this.videoHealthTimer = null;

        if (this.healthSoonTimer) clearTimeout(this.healthSoonTimer);
        this.healthSoonTimer = null;

        this.videoHealthState.clear();
        this.videoElByPid.clear();
        this.screenElByPid.clear();
    }

    public tickSoon() {
        this.start();
        if (this.healthSoonTimer) return;
        this.healthSoonTimer = setTimeout(() => {
            this.healthSoonTimer = null;
            if (this.deps.isDisposed()) return;
            this.tick();
        }, 0);
    }

    private getFrameCount(el: HTMLVideoElement): number | null {
        try {
            const anyEl = el as any;
            if (typeof anyEl.webkitDecodedFrameCount === "number") return Number(anyEl.webkitDecodedFrameCount);

            if (typeof el.getVideoPlaybackQuality === "function") {
                const q = el.getVideoPlaybackQuality();
                const n = Number((q as any)?.totalVideoFrames);
                return Number.isFinite(n) ? n : null;
            }
        } catch { }
        return null;
    }

    private getOrInitHealth(pid: string) {
        const now = Date.now();
        const cur = this.videoHealthState.get(pid);
        if (cur) return cur;

        const init = {
            lastFrameCount: null as number | null,
            lastCurrentTime: 0,
            lastProgressAt: now,
            stuckSince: null as number | null,
            lastReattachAt: 0,
            lastBumpAt: 0,
            reattachAttemptsInWindow: 0,
            lastAttemptWindowAt: now,
        };

        this.videoHealthState.set(pid, init);
        return init;
    }

    private tick() {
        const conf = this.deps.getConference();
        if (!conf || this.deps.isDisposed()) return;

        const { ids: subscribedRemoteIds } = this.deps.getSubscribedRemoteIds();
        if (!subscribedRemoteIds.length) return;

        const now = Date.now();

        for (const pid of Array.from(this.videoHealthState.keys())) {
            if (!subscribedRemoteIds.includes(pid)) this.videoHealthState.delete(pid);
        }

        const participants = this.deps.getParticipants();

        for (const pid of subscribedRemoteIds) {
            const p = participants[pid];
            if (!p || p.isLocal) continue;

            const hasScreen = !!p.screenTrack && this.screenElByPid.has(pid);
            const kind: "video" | "screen" = hasScreen ? "screen" : "video";

            const el = kind === "screen" ? this.screenElByPid.get(pid) : this.videoElByPid.get(pid);
            const track = kind === "screen" ? p.screenTrack : p.videoTrack;

            if (!el || !track) continue;

            if (kind === "video" && p.videoMuted) {
                const st = this.getOrInitHealth(pid);
                st.stuckSince = null;
                st.lastProgressAt = now;
                st.lastFrameCount = this.getFrameCount(el);
                st.lastCurrentTime = el.currentTime || 0;
                continue;
            }

            const ready = el.readyState >= 2;
            const hasSize = (el.videoWidth || 0) > 0 && (el.videoHeight || 0) > 0;

            const st = this.getOrInitHealth(pid);

            const frames = this.getFrameCount(el);
            const curTime = Number(el.currentTime || 0);

            let progressed = false;
            if (frames != null && st.lastFrameCount != null) progressed = frames > st.lastFrameCount;
            else progressed = curTime > (st.lastCurrentTime || 0);

            if (ready && hasSize && progressed) {
                st.lastProgressAt = now;
                st.stuckSince = null;
                st.lastFrameCount = frames;
                st.lastCurrentTime = curTime;
                continue;
            }

            if (st.stuckSince == null) st.stuckSince = now;

            st.lastFrameCount = frames;
            st.lastCurrentTime = curTime;

            const stuckFor = now - st.stuckSince;
            if (stuckFor < this.STUCK_THRESHOLD_MS) continue;

            void this.recoverParticipantVideo(pid, kind, track, el, st);
        }
    }

    private async recoverParticipantVideo(
        pid: string,
        _kind: "video" | "screen",
        track: any,
        el: HTMLVideoElement,
        st: {
            lastFrameCount: number | null;
            lastCurrentTime: number;
            lastProgressAt: number;
            stuckSince: number | null;
            lastReattachAt: number;
            lastBumpAt: number;
            reattachAttemptsInWindow: number;
            lastAttemptWindowAt: number;
        }
    ) {
        const now = Date.now();
        if (now - st.lastReattachAt < this.REATTACH_COOLDOWN_MS) return;

        if (now - st.lastAttemptWindowAt > 12000) {
            st.lastAttemptWindowAt = now;
            st.reattachAttemptsInWindow = 0;
        }
        st.reattachAttemptsInWindow += 1;

        st.lastReattachAt = now;

        try {
            if (typeof track.detach === "function") {
                try { track.detach(el); } catch { }
            }
            if (typeof track.detach === "function") {
                try { track.detach(); } catch { }
            }

            await new Promise((r) => setTimeout(r, 40));

            if (typeof track.attach === "function") {
                try { track.attach(el); } catch { }
            }

            try {
                if (typeof (el as any).play === "function") {
                    await el.play().catch(() => { });
                }
            } catch { }

            st.stuckSince = Date.now();
            st.lastProgressAt = Date.now();

            if (st.reattachAttemptsInWindow >= 2) {
                this.bumpParticipantSubscription(pid, st);
            }
        } catch {
            this.bumpParticipantSubscription(pid, st);
        }
    }

    private bumpParticipantSubscription(pid: string, st: { lastBumpAt: number }) {
        const now = Date.now();
        const conf = this.deps.getConference();
        if (!conf || this.deps.isDisposed()) return;
        if (now - (st.lastBumpAt || 0) < this.BUMP_COOLDOWN_MS) return;

        st.lastBumpAt = now;

        try {
            const { ids: subscribedRemoteIds, desiredLastN } = this.deps.getSubscribedRemoteIds();
            if (!subscribedRemoteIds.includes(pid)) return;

            const original = subscribedRemoteIds.slice(0, desiredLastN);
            const without = original.filter((x) => x !== pid);

            try { conf.selectParticipants?.(without); } catch { }

            setTimeout(() => {
                if (this.deps.isDisposed() || !this.deps.getConference()) return;
                try { conf.selectParticipants?.(original); } catch { }
            }, 220);
        } catch { }
    }
}
