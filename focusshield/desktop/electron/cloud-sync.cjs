class CloudSync {
  constructor({
    deviceId,
    getPolicy,
    applyRemotePolicy,
    getSavedLists,
    applyRemoteSavedLists,
    onSessionChanged,
  }) {
    this.deviceId = deviceId;
    this.getPolicy = getPolicy;
    this.applyRemotePolicy = applyRemotePolicy;
    this.getSavedLists = getSavedLists || (() => []);
    this.applyRemoteSavedLists = applyRemoteSavedLists || (() => ({ ok: true }));
    this.onSessionChanged = onSessionChanged;
    this.session = null;
    this.timer = null;
    this.running = false;
    this.savedListsRunning = false;
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
      // Saves and deletes are pushed immediately. This pass only reconciles
      // changes made on another device, so it should not continuously poll
      // Supabase while the user is focusing.
      this.timer = setInterval(() => void this.syncAll(), 30_000);
      void this.syncAll();
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
          policy: {
            ...policy,
            savedLists: undefined,
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`policy_save_failed_${response.status}`);
  }

  async loadRemoteSavedLists() {
    await this.ensureAccessToken();
    const userId = encodeURIComponent(this.session.user.id);
    const response = await fetch(
      `${this.session.supabaseUrl}/rest/v1/focus_shield_saved_lists?select=id,name,configuration,created_at,updated_at,deleted_at&user_id=eq.${userId}`,
      { headers: this.headers(), cache: "no-store" },
    );
    if (!response.ok) throw new Error(`saved_lists_load_failed_${response.status}`);
    return await response.json();
  }

  async upsertSavedList(list) {
    await this.ensureAccessToken();
    const response = await fetch(
      `${this.session.supabaseUrl}/rest/v1/focus_shield_saved_lists?on_conflict=user_id,id`,
      {
        method: "POST",
        headers: this.headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({
          user_id: this.session.user.id,
          id: list.id,
          name: list.name,
          configuration: {
            web: list.web || {},
            desktop: list.desktop || {},
          },
          created_at: new Date(Number(list.createdAt) || Date.now()).toISOString(),
          updated_at: new Date(Number(list.updatedAt) || Date.now()).toISOString(),
          deleted_at: null,
        }),
      },
    );
    if (!response.ok) throw new Error(`saved_list_save_failed_${response.status}`);
    return { ok: true };
  }

  async deleteSavedList(id, updatedAt = Date.now()) {
    await this.ensureAccessToken();
    const timestamp = new Date(updatedAt).toISOString();
    const response = await fetch(
      `${this.session.supabaseUrl}/rest/v1/focus_shield_saved_lists?on_conflict=user_id,id`,
      {
        method: "POST",
        headers: this.headers("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({
          user_id: this.session.user.id,
          id: String(id || ""),
          name: "Deleted list",
          configuration: {},
          updated_at: timestamp,
          deleted_at: timestamp,
        }),
      },
    );
    if (!response.ok) throw new Error(`saved_list_delete_failed_${response.status}`);
    return { ok: true };
  }

  async syncSavedLists() {
    if (!this.session || this.savedListsRunning) return { ok: false, error: "not_ready" };
    this.savedListsRunning = true;
    try {
      const localLists = this.getSavedLists();
      const remoteRows = await this.loadRemoteSavedLists();
      const localById = new Map(localLists.map((list) => [String(list.id), list]));
      const mergedById = new Map(localById);

      for (const row of remoteRows || []) {
        const id = String(row.id || "");
        if (!id) continue;
        const local = localById.get(id);
        const remoteUpdatedAt = Date.parse(row.updated_at || row.created_at || "") || 0;
        const localUpdatedAt = Number(local?.updatedAt || 0);

        if (row.deleted_at) {
          if (local && localUpdatedAt > remoteUpdatedAt) {
            await this.upsertSavedList(local);
          } else {
            mergedById.delete(id);
          }
          continue;
        }

        if (local && localUpdatedAt > remoteUpdatedAt) {
          await this.upsertSavedList(local);
          continue;
        }

        mergedById.set(id, {
          id,
          name: String(row.name || "Block list"),
          createdAt: Date.parse(row.created_at || "") || Date.now(),
          updatedAt: remoteUpdatedAt || Date.now(),
          web: row.configuration?.web || {},
          desktop: row.configuration?.desktop || {},
        });
      }

      const remoteIds = new Set((remoteRows || []).map((row) => String(row.id || "")));
      for (const local of localLists) {
        if (!remoteIds.has(String(local.id))) await this.upsertSavedList(local);
      }

      const merged = [...mergedById.values()]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      this.applyRemoteSavedLists(merged);
      return { ok: true, count: merged.length };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    } finally {
      this.savedListsRunning = false;
    }
  }

  async syncAll(options = {}) {
    const policy = await this.syncNow(options);
    const savedLists = await this.syncSavedLists();
    return { ...policy, savedLists };
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
