import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-bold text-base tracking-tight text-neutral-900 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
            Congress Platform
          </span>
          <Link
            to="/organizer"
            className="text-xs bg-neutral-900 hover:bg-neutral-800 text-white font-medium px-3 py-1.5 rounded-lg transition"
          >
            Organizer Console →
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 flex flex-col items-center justify-center text-center py-16">
        <div className="max-w-xl space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
            <span>✨</span> Next-Generation Independent Congress Platform
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-neutral-900">
            Fast, Resilient Event Operations
          </h1>

          <p className="text-base text-neutral-600 leading-relaxed">
            Multi-tenant congress management, free ticket tier quotas, and offline-resilient gate attendance tracking.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/organizer"
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm py-3 px-6 rounded-xl transition shadow-sm"
            >
              Open Organizer Console
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 text-center text-xs text-neutral-500">
        Congress Management Platform • FastAPI & React
      </footer>
    </div>
  );
}
