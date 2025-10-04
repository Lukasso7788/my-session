import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dailyApiKey = process.env.DAILY_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Generate a unique room name
function generateRoomName() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `focus-session-${timestamp}-${random}`;
}

// Create a Daily.co room
async function createDailyRoom(roomName) {
  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${dailyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: roomName,
      privacy: 'public',
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours from now
      properties: {
        enable_screenshare: true,
        enable_chat: true,
        enable_recording: false,
        enable_transcription: false,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Daily API error: ${response.status} ${error}`);
  }

  return await response.json();
}

// Handle GET requests - fetch session(s)
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(segment => segment);
    const sessionId = pathSegments[pathSegments.length - 1];

    // If sessionId is provided, fetch single session
    if (sessionId && sessionId !== 'sessions') {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (error) {
        console.error('Supabase error:', error);
        return new Response(JSON.stringify({ error: 'Database error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!data) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Otherwise, fetch all sessions
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('scheduled_at', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data || []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('GET /api/sessions error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Handle POST requests - create new session
export async function POST(request) {
  try {
    const body = await request.json();
    const { title, host, duration_minutes, format, focus_blocks, scheduled_at } = body;

    // Validate required fields
    if (!title || !host || !duration_minutes || !format || !focus_blocks || !scheduled_at) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate unique room name and create Daily room
    const roomName = generateRoomName();
    const dailyRoom = await createDailyRoom(roomName);

    // Create session in Supabase with the Daily room URL
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        title,
        host,
        duration_minutes,
        format,
        focus_blocks,
        scheduled_at,
        daily_room_url: dailyRoom.url,
        status: 'scheduled',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('POST /api/sessions error:', error);
    
    // Handle specific Daily API errors
    if (error.message.includes('Daily API error: 401')) {
      return new Response(JSON.stringify({ error: 'Daily API authentication failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (error.message.includes('Daily API error: 429')) {
      return new Response(JSON.stringify({ error: 'Daily API rate limit exceeded' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
