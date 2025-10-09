// api/sessions/[id].js

// ⚠️ ничего не импортируем из data.js или Supabase!
import { sessions } from './index.js';

export default function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'GET') {
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      console.log('❌ Session not found in local memory:', id);
      return res.status(404).json({ error: 'Session not found' });
    }
    console.log('✅ Found session:', session);
    return res.status(200).json(session);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
