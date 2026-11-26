/** Save a prejoin task in the same persistent list used by TasksPanel. */
export async function savePrejoinTask(client, { userId, taskId, text }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (!userId || !taskId) throw new Error('Sign in before saving a task.');
  const { data: rows, error: readError } = await client.from('panel_intentions')
    .select('id,sort_order').eq('user_id', userId).order('sort_order', { ascending: true, nullsFirst: false });
  if (readError) throw readError;
  const others = (rows || []).filter(row => row.id !== taskId);
  const sortOrder = Math.min(0, ...others.map(row => Number(row.sort_order) || 0)) - 1;
  const { data, error } = await client.from('panel_intentions').upsert({
    id: taskId, user_id: userId, text: trimmed, completed: false, visibility: 'public', sort_order: sortOrder,
  }, { onConflict: 'id' }).select('*').single();
  if (error || !data) throw error || new Error('Task was not saved.');
  return { task: data, order: [taskId, ...others.map(row => row.id)] };
}
