import { sessions } from './data.js';
let sessions = []; // временное хранилище (та же переменная, что и в sessions.js)

export default function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'GET') {
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.status(200).json(session);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
