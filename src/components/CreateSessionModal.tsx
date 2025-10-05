import { useState } from 'react';
import { X } from 'lucide-react';
import { generateFocusBlocks } from '../utils/sessionHelpers';

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
}

export function CreateSessionModal({ isOpen, onClose, onSessionCreated }: CreateSessionModalProps) {
  const [title, setTitle] = useState('');
  const [host, setHost] = useState('');
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);

  const sessionOptions = [
    { value: '60-uninterrupted', label: '1 Hour - Uninterrupted Focus', duration: 60, format: 'uninterrupted' as const },
    { value: '120-uninterrupted', label: '2 Hours - 2x 50min Focus Blocks', duration: 120, format: 'uninterrupted' as const },
    { value: '60-pomodoro-25-5', label: '1 Hour - Pomodoro 25/5', duration: 60, format: 'pomodoro_25_5' as const },
    { value: '120-pomodoro-25-5', label: '2 Hours - Pomodoro 25/5', duration: 120, format: 'pomodoro_25_5' as const },
    { value: '60-pomodoro-15-3', label: '1 Hour - Pomodoro 15/3', duration: 60, format: 'pomodoro_15_3' as const },
    { value: '120-pomodoro-15-3', label: '2 Hours - Pomodoro 15/3', duration: 120, format: 'pomodoro_15_3' as const },
  ];

  const handleCreate = async () => {
    if (!title || !host || !selectedOption) return;

    const option = sessionOptions.find(o => o.value === selectedOption);
    if (!option) return;

    setIsCreating(true);

    try {
      const focusBlocks = generateFocusBlocks(option.format, option.duration);
      const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          host,
          duration_minutes: option.duration,
          format: option.format,
          focus_blocks: focusBlocks,
          scheduled_at: scheduledAt,
        }),
      });

      if (!response.ok) throw new Error('Failed to create session');

      setTitle('');
      setHost('');
      setSelectedOption('');
      onSessionCreated();
      onClose();
    } catch (error) {
      console.error('Error creating session:', error);
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Create Focus Session</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Session Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Deep Work Session"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              placeholder="Host name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Session Format</label>
            <div className="space-y-2">
              {sessionOptions.map((option) => (
                <label key={option.value} className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="session-option"
                    value={option.value}
                    checked={selectedOption === option.value}
                    onChange={(e) => setSelectedOption(e.target.value)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={!title || !host || !selectedOption || isCreating}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
          >
            {isCreating ? 'Creating...' : 'Create Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
