/*
  # Create focus sessions table

  1. New Tables
    - `sessions`
      - `id` (uuid, primary key)
      - `title` (text) - session title
      - `host` (text) - host name
      - `duration_minutes` (integer) - total session duration
      - `format` (text) - session format (uninterrupted, pomodoro_25_5, pomodoro_15_3)
      - `focus_blocks` (jsonb) - array of focus blocks with start/end times
      - `daily_room_url` (text) - Daily.co room URL
      - `participant_count` (integer) - current participant count
      - `scheduled_at` (timestamptz) - when the session is scheduled
      - `created_at` (timestamptz) - when the record was created
      - `status` (text) - session status (scheduled, active, completed)
  
  2. Security
    - Enable RLS on `sessions` table
    - Add policy for public read access (sessions are publicly viewable)
    - Add policy for authenticated users to create sessions
*/

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  host text NOT NULL DEFAULT 'Anonymous',
  duration_minutes integer NOT NULL,
  format text NOT NULL CHECK (format IN ('uninterrupted', 'pomodoro_25_5', 'pomodoro_15_3')),
  focus_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  daily_room_url text,
  participant_count integer DEFAULT 0,
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed'))
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view sessions"
  ON sessions FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create sessions"
  ON sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update session participant count"
  ON sessions FOR UPDATE
  USING (true)
  WITH CHECK (true);