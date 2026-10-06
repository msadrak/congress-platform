import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { ORGANIZER_KEY_STORAGE } from "../api/client";

export default function OrganizerLayout() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState<string | null>(() =>
    sessionStorage.getItem(ORGANIZER_KEY_STORAGE)
  );
  const [inputKey, setInputKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setError("Please enter your organizer API key.");
      return;
    }
    sessionStorage.setItem(ORGANIZER_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    setInputKey("");
    setError(null);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(ORGANIZER_KEY_STORAGE);
    setApiKey(null);
    navigate("/organizer");
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            to="/organizer"
            className="font-bold text-lg tracking-tight text-neutral-900 flex items-center gap-2"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
            Congress Platform
          </Link>
          {apiKey && (
            <div className="flex items-center gap-3">
              <Link
                to="/organizer"
                className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
              >
                Events
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 px-2.5 py-1.5 rounded-md font-medium transition"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6">
        {!apiKey ? (
          <div className="max-w-md mx-auto mt-12 bg-white p-6 sm:p-8 rounded-xl border border-neutral-200 shadow-sm">
            <h1 className="text-xl font-bold tracking-tight mb-2">
              Organizer Console
            </h1>
            <p className="text-sm text-neutral-600 mb-6">
              Enter your organizer API key to manage events and ticket tiers.
            </p>
            <form onSubmit={handleSaveKey} className="space-y-4">
              <div>
                <label
                  htmlFor="apiKeyInput"
                  className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1"
                >
                  API Key
                </label>
                <input
                  id="apiKeyInput"
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="Paste your API key here"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2.5 rounded-md">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 px-4 rounded-lg transition"
              >
                Access Organizer Dashboard
              </button>
            </form>
          </div>
        ) : (
          <Outlet context={{ apiKey }} />
        )}
      </main>
    </div>
  );
}
