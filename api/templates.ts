import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('session_templates')
      .select('id, name, total_duration, blocks')
      .order('name', { ascending: true });

    if (error) throw error;

    return res.status(200).json(data);
  } catch (err: any) {
    console.error('Error fetching templates:', err);
    return res.status(500).json({ error: 'Failed to fetch templates' });
  }
}
