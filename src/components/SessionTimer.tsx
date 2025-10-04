import { useState, useEffect } from 'react';
import { FocusBlock } from '../lib/supabase';

interface SessionTimerProps {
  focusBlocks: FocusBlock[];
  durationMinutes: number;
  startTime: Date;
}

export function SessionTimer({ focusBlocks, durationMinutes, startTime }: SessionTimerProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [currentBlock, setCurrentBlock] = useState<FocusBlock | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime.getTime()) / 1000);
      const totalSeconds = durationMinutes * 60;
      const remaining = Math.max(0, totalSeconds - elapsed);

      setTimeLeft(remaining);

      const elapsedMinutes = Math.floor(elapsed / 60);
      const activeBlockIndex = focusBlocks.findIndex((block, idx) => {
        const blockStart = block.start_offset_minutes;
        const blockEnd = blockStart + block.duration_minutes;
        return elapsedMinutes >= blockStart && elapsedMinutes < blockEnd;
      });

      if (activeBlockIndex !== -1) {
        setCurrentBlock(focusBlocks[activeBlockIndex]);
        setCurrentBlockIndex(activeBlockIndex);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [focusBlocks, durationMinutes, startTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const progress = ((durationMinutes * 60 - timeLeft) / (durationMinutes * 60)) * 100;

  return (
    <div className="bg-white shadow-md w-full">
      <div className="px-6 py-4 w-full">
        <div className="flex items-center justify-between gap-6 mb-2 w-full">
          <div className="flex items-center gap-8 flex-shrink-0">
            <div>
              <div className="text-sm text-gray-600 mb-1">Time Remaining</div>
              <div className="text-2xl font-bold text-gray-900">{formatTime(timeLeft)}</div>
            </div>
            {currentBlock && (
              <div>
                <div className="text-sm text-gray-600 mb-1">Current Block</div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      currentBlock.type === 'focus'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {currentBlock.type === 'focus' ? 'Focus' : 'Break'}
                  </span>
                  <span className="text-sm text-gray-600">
                    {currentBlock.duration_minutes} min
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-1 justify-end overflow-x-auto">
            {focusBlocks.map((block, idx) => (
              <div
                key={idx}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex-shrink-0 ${
                  idx === currentBlockIndex
                    ? block.type === 'focus'
                      ? 'bg-green-600 text-white'
                      : 'bg-blue-600 text-white'
                    : idx < currentBlockIndex
                    ? 'bg-gray-300 text-gray-600'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {block.type === 'focus' ? '🎯' : '☕'} {block.duration_minutes}m
              </div>
            ))}
          </div>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
