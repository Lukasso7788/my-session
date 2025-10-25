import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  try {
    const { title, templateId } = await req.json();

    // Получаем шаблон
    const { data: template, error: templateError } = await supabase
      .from('session_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Создаём сессию
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        title,
        template_id: template.id,
        schedule: template.blocks,
        room_url: null,
        status: 'planned'
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
