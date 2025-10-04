import { FocusBlock } from '../lib/supabase';

export function generateFocusBlocks(
  format: 'uninterrupted' | 'pomodoro_25_5' | 'pomodoro_15_3',
  durationMinutes: number
): FocusBlock[] {
  const blocks: FocusBlock[] = [];
  let currentOffset = 0;

  if (format === 'uninterrupted') {
    const numBlocks = durationMinutes === 60 ? 1 : 2;
    const blockDuration = durationMinutes === 60 ? 60 : 50;

    for (let i = 0; i < numBlocks; i++) {
      blocks.push({
        type: 'focus',
        duration_minutes: blockDuration,
        start_offset_minutes: currentOffset,
      });
      currentOffset += blockDuration;

      if (i < numBlocks - 1) {
        blocks.push({
          type: 'break',
          duration_minutes: 10,
          start_offset_minutes: currentOffset,
        });
        currentOffset += 10;
      }
    }
  } else if (format === 'pomodoro_25_5') {
    const cycleCount = Math.floor(durationMinutes / 30);

    for (let i = 0; i < cycleCount; i++) {
      blocks.push({
        type: 'focus',
        duration_minutes: 25,
        start_offset_minutes: currentOffset,
      });
      currentOffset += 25;

      blocks.push({
        type: 'break',
        duration_minutes: 5,
        start_offset_minutes: currentOffset,
      });
      currentOffset += 5;
    }
  } else if (format === 'pomodoro_15_3') {
    const cycleCount = Math.floor(durationMinutes / 18);

    for (let i = 0; i < cycleCount; i++) {
      blocks.push({
        type: 'focus',
        duration_minutes: 15,
        start_offset_minutes: currentOffset,
      });
      currentOffset += 15;

      blocks.push({
        type: 'break',
        duration_minutes: 3,
        start_offset_minutes: currentOffset,
      });
      currentOffset += 3;
    }
  }

  return blocks;
}

export function formatSessionFormat(format: string): string {
  switch (format) {
    case 'uninterrupted':
      return 'Uninterrupted';
    case 'pomodoro_25_5':
      return 'Pomodoro 25/5';
    case 'pomodoro_15_3':
      return 'Pomodoro 15/3';
    default:
      return format;
  }
}
