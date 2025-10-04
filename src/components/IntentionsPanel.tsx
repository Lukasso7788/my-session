import { useState } from 'react';
import { Plus, Check, Circle } from 'lucide-react';

interface Intention {
  id: string;
  text: string;
  completed: boolean;
}

interface TeamIntention {
  user: string;
  intention: string;
  status: 'In Progress' | 'Completed';
}

export function IntentionsPanel() {
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [newIntention, setNewIntention] = useState('');

  const teamIntentions: TeamIntention[] = [
    { user: 'Sarah', intention: 'Complete project proposal', status: 'In Progress' },
    { user: 'Mike', intention: 'Review code changes', status: 'Completed' },
    { user: 'Alex', intention: 'Write documentation', status: 'In Progress' },
  ];

  const handleAddIntention = () => {
    if (!newIntention.trim()) return;

    setIntentions([
      ...intentions,
      {
        id: Date.now().toString(),
        text: newIntention,
        completed: false,
      },
    ]);
    setNewIntention('');
  };

  const toggleIntention = (id: string) => {
    setIntentions(
      intentions.map((intention) =>
        intention.id === id
          ? { ...intention, completed: !intention.completed }
          : intention
      )
    );
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Intentions</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">My Intentions</h3>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newIntention}
                onChange={(e) => setNewIntention(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddIntention()}
                placeholder="Add an intention..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAddIntention}
                className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {intentions.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No intentions yet</p>
              ) : (
                intentions.map((intention) => (
                  <div
                    key={intention.id}
                    className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleIntention(intention.id)}
                  >
                    {intention.completed ? (
                      <Check size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Circle size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    )}
                    <span
                      className={`text-sm ${
                        intention.completed
                          ? 'text-gray-500 line-through'
                          : 'text-gray-900'
                      }`}
                    >
                      {intention.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Team Intentions</h3>
            <div className="space-y-3">
              {teamIntentions.map((item, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium text-gray-900">{item.user}</span>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        item.status === 'Completed'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{item.intention}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
