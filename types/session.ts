// project/types/session.ts

export type SessionBlock = {
  label: string;
  type: 'intro' | 'intentions' | 'focus' | 'break' | 'outro';
  duration: number;
};

export type SessionTemplate = {
  id: string;
  name: string;
  totalDuration: number;
  blocks: SessionBlock[];
  isDefault: boolean;
};

export type Session = {
  id: string;
  title: string;
  host: string;
  duration_minutes: number;
  format: string;
  template_id: string | null;
  schedule: SessionBlock[];
  daily_room_url: string | null;
  status: 'planned' | 'active' | 'ended';
  start_time: string | null;
  created_at: string;
};
