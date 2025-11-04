import React from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function UserProfileModal({ user, onClose }: any) {
  const navigate = useNavigate();
  if (!user) return null;

  const avatar =
    user.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(
      user.full_name || "User"
    )}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white text-black rounded-2xl w-[380px] p-6 relative shadow-xl">
        <button
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center space-y-4">
          <img
            src={avatar}
            alt="avatar"
            className="w-20 h-20 rounded-full border border-gray-300 object-cover"
          />
          <h2 className="text-lg font-semibold">{user.full_name}</h2>
          {user.bio && (
            <p className="text-sm text-gray-600 text-center">{user.bio}</p>
          )}

          <button
            onClick={() => navigate(`/profile/${user.id}`)}
            className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition"
          >
            See full profile
          </button>
        </div>
      </div>
    </div>
  );
}
