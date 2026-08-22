class CloudSync {
  constructor({ deviceId, getPolicy, applyRemotePolicy, onSessionChanged }) {
    this.deviceId = deviceId;
    this.getPolicy = getPolicy;
    this.applyRemotePolicy = applyRemotePolicy;
    this.onSessionChanged = onSessionChanged;
    this.session = null;
    this.timer = null;
    this.running = false;
  }

  getAccount() {
    const user = this.session?.user;
    return user ? {
      connected: true,
      id: user.id,
      email: user.email || "",
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "MySession user",
      avatarUrl: user.user_metadata?.avatar_url || "",
    } : { connected: false };
  }

  configure(session) {
    this.session = session || null;
    this.stop();
    if (this.session) {
      this.timer = setInterval(() => void this.syncNow(), 5000);
      void this.syncNow();
    }
    this.onSessionChanged?.(this.session);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async ensureAccessToken() {
    if (!this.session) throw new Error("not_connected");
    const expiresAtMs = Number(this.session.expiresAt || 0) * 1000;
    if (this.session.accessToken && expiresAtMs > Date.now() + 60_000) return;

    const response = await fetch(`${this.session.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: this.session.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    });
    if (!response.ok) throw new Error(`refresh_failed_${response.status}`);
    const data = await response.json();
    this.session = {
      ...this.session,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.session.refreshToken,
      expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
      user: data.user || this.session.user,
    };
    this.onSessionChanged?.(this.session);
  }

  headers(prefer = "") {
    return {
      apikey: this.session.anonKey,
      Authorization: `Bearer ${this.session.accessToken}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  async loadRemotePolicy() {
    await this.ensureAccessToken();
    const userId = encodeURIComponent(this.session.user.id);
    const response = await fetch(
      `${this.session.supabaseUrl}/rest/v1/focus_shield_policies?select=policy,device_id,updated_at&user_id=eq.${userId}&limit=1`,
      { headers: this.headers(), cache: "no-store" },
    );
    if (!response.ok) throw new Error(`policy_load_failed_${response.status}`);
    const rows = await response.json();
    return rows?.[0] || null;
  }

  async pushPolicy(policy = this.getPolicy()) {
    await this.ensureAccessToken();
    const response = await fetch(
      `${this.session.supabaseUrl}/rest/v1/focus_shield_policies?on_conflict=user_id`,
      {
        method: "POST",
        headers: this.headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({
          user_id: this.session.user.id,
          device_id: this.deviceId,
          policy,
        }),
      },
    );
    if (!response.ok) throw new Error(`policy_save_failed_${response.status}`);
  }

  async syncNow({ preferLocal = false } = {}) {
    if (!this.session || this.running) return { ok: false, error: "not_ready" };
    this.running = true;
    try {
      const local = this.getPolicy();
      const remoteRow = await this.loadRemotePolicy();
      if (!remoteRow) {
        await this.pushPolicy(local);
        return { ok: true, direction: "uploaded" };
      }

      const remote = remoteRow.policy || {};
      const localUpdatedAt = Number(local?.updatedAt || 0);
      const remoteUpdatedAt = Number(remote?.updatedAt || 0);
      if (preferLocal || localUpdatedAt > remoteUpdatedAt) {
        await this.pushPolicy(local);
        return { ok: true, direction: "uploaded" };
      }
      if (remoteUpdatedAt > localUpdatedAt) {
        const result = this.applyRemotePolicy(remote);
        if (!result?.ok) {
          await this.pushPolicy(local);
          return { ok: true, direction: "protected-local-lock" };
        }
        return { ok: true, direction: "downloaded" };
      }
      return { ok: true, direction: "current" };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    } finally {
      this.running = false;
    }
  }
}

module.exports = { CloudSync };
