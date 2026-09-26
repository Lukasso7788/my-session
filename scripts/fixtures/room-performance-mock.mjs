// Browser-only test double. Never imported by the production application.
export const sessionId = '11111111-1111-4111-8111-111111111111';
export const userId = '22222222-2222-4222-8222-222222222222';
export const hostId = '33333333-3333-4333-8333-333333333333';
const avatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="%2381DB86"/></svg>';
const rows = Array.from({ length: 120 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  session_id: sessionId, user_id: hostId, body: `History message ${index}`,
  scope: 'general', dm_peer_user_id: null,
  created_at: new Date(Date.UTC(2026, 8, 20, 0, index)).toISOString(),
}));
const channels = new Set();
export const control = {
  requests: [], createdChannels: 0, removedChannels: 0, failNextSend: false,
  delayNextRead: 0,
  get channels() { return [...channels].map((channel) => ({ name: channel.name, filters: channel.handlers.map((item) => item.filter) })); },
  emit(table, eventType, row) {
    for (const channel of channels) for (const handler of channel.handlers) {
      if (handler.type === 'postgres_changes' && handler.filter.table === table &&
        (handler.filter.event === '*' || handler.filter.event === eventType)) {
        handler.callback({ eventType, new: eventType === 'DELETE' ? {} : row, old: eventType === 'DELETE' ? row : {} });
      }
    }
  },
  burst(count) {
    for (let index = 0; index < count; index++) {
      const row = { ...rows[0], id: crypto.randomUUID(), body: `Burst ${index}`, created_at: new Date(Date.now() + index).toISOString() };
      rows.push(row); this.emit('session_chat_messages', 'INSERT', row);
    }
  },
  reconnect() { for (const channel of channels) channel.status?.('SUBSCRIBED'); },
};
class Query {
  constructor(table) { this.table = table; this.operation = 'select'; this.filters = []; this.orders = []; this.count = Infinity; }
  select(fields) { this.fields = fields; return this; }
  eq(field, value) { this.filters.push([field, value]); return this; }
  in(field, values) { this.filters.push([field, values]); return this; }
  is(field, value) { return this.eq(field, value); }
  order(field, options) { this.orders.push([field, options]); return this; }
  limit(count) { this.count = count; return this; }
  or(expression) { (this.ors ||= []).push(expression); return this; }
  insert(row) { this.operation = 'insert'; this.payload = row; return this; }
  update(row) { this.operation = 'update'; this.payload = row; return this; }
  delete() { this.operation = 'delete'; return this; }
  upsert(row) { return this.insert(row); }
  single() { this.one = true; return this; }
  maybeSingle() { return this.single(); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute() {
    control.requests.push({ table: this.table, operation: this.operation, filters: this.filters, limit: this.count, ors: this.ors });
    if (this.operation === 'insert' && this.table === 'session_chat_messages') {
      if (control.failNextSend) { control.failNextSend = false; return { data: null, error: { message: 'Intentional test failure' } }; }
      rows.push(this.payload); control.emit(this.table, 'INSERT', this.payload);
      return { data: this.one ? this.payload : [this.payload], error: null };
    }
    let data = [];
    if (this.table === 'session_chat_messages') {
      data = [...rows];
      for (const [field, value] of this.filters) data = data.filter((row) => Array.isArray(value) ? value.includes(row[field]) : row[field] === value);
      for (const expression of this.ors || []) {
        if (expression.includes('scope.eq.general')) data = data.filter((row) => !row.scope || row.scope === 'general');
        const cursor = expression.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)$/);
        if (cursor) data = data.filter((row) => row.created_at < cursor[1] || (row.created_at === cursor[1] && row.id < cursor[2]));
      }
      data.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      data = data.slice(0, this.count);
    } else if (this.table === 'profiles') {
      const ids = this.filters.find(([field]) => field === 'id')?.[1] || [userId, hostId];
      data = (Array.isArray(ids) ? ids : [ids]).map((id) => ({ id, full_name: id === userId ? 'Tester' : 'Host', avatar_url: avatar }));
    } else if (this.table === 'sessions') {
      data = [{ id: sessionId, host_id: hostId, task_timers_enabled: false }];
    }
    const delay = this.table === 'session_chat_messages' && this.operation === 'select' ? control.delayNextRead : 0;
    if (delay) { control.delayNextRead = 0; await new Promise((done) => setTimeout(done, delay)); }
    return { data: this.one ? data[0] || null : data, error: null };
  }
}
export const supabase = {
  from: (table) => new Query(table),
  auth: { getUser: async () => ({ data: { user: { id: userId } } }), getSession: async () => ({ data: { session: null } }) },
  rpc: async () => ({ data: [], error: null }),
  channel(name) {
    const channel = { name, handlers: [],
      on(type, filter, callback) { this.handlers.push({ type, filter, callback }); return this; },
      subscribe(status) { this.status = status; channels.add(this); control.createdChannels++; queueMicrotask(() => status?.('SUBSCRIBED')); return this; },
      send: async () => 'ok',
    };
    return channel;
  },
  removeChannel: async (channel) => { if (channels.delete(channel)) control.removedChannels++; },
};
window.__roomPerf = control;
