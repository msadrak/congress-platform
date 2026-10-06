import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { formatApiError, getApiClient, type EventOut } from "../api/client";

export default function OrganizerEvents() {
  const { apiKey } = useOutletContext<{ apiKey: string }>();
  const [events, setEvents] = useState<EventOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    const client = getApiClient(apiKey);
    const { data, error: err } = await client.GET("/api/events");
    if (err) {
      setError(formatApiError(err));
    } else if (data) {
      setEvents(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEvents();
  }, [apiKey]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    // Suggest a slug if user hasn't explicitly edited slug yet
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")) {
      const generated = newName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      setSlug(generated);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !slug.trim() || !startsAt || !endsAt || !location.trim()) {
      setFormError("Please fill out all required fields.");
      return;
    }

    setSubmitting(true);
    const client = getApiClient(apiKey);
    const { data, error: err } = await client.POST("/api/events", {
      body: {
        name: name.trim(),
        slug: slug.trim(),
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        location: location.trim(),
        description: description.trim(),
      },
    });

    setSubmitting(false);
    if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      setEvents((prev) => [...prev, data]);
      setName("");
      setSlug("");
      setStartsAt("");
      setEndsAt("");
      setLocation("");
      setDescription("");
      setShowForm(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Events
          </h1>
          <p className="text-sm text-neutral-600">
            Create and configure congresses and ticket tiers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="self-start sm:self-auto bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm py-2 px-4 rounded-lg transition"
        >
          {showForm ? "Cancel" : "+ Create New Event"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white p-5 sm:p-6 rounded-xl border border-neutral-200 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            Create Event
          </h2>
          <form onSubmit={handleCreateEvent} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Event Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={handleNameChange}
                  placeholder="e.g. National Cardiology Congress 2027"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  URL Slug *
                </label>
                <input
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. cardiology-congress-2027"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                />
                <span className="text-xs text-neutral-500">
                  Public URL: /e/{slug || "slug"}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Starts At *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Ends At *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Location / Venue *
                </label>
                <input
                  type="text"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Tehran International Convention Center, Hall 1"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Overview of the conference, keynote speakers, and agenda..."
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 p-2.5 rounded-md">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-medium hover:bg-neutral-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm py-2 px-5 rounded-lg transition"
              >
                {submitting ? "Creating..." : "Save Event"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-sm text-neutral-500">
          Loading events...
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="bg-white p-8 rounded-xl border border-neutral-200 text-center space-y-2">
          <p className="text-base font-semibold text-neutral-900">
            No events found
          </p>
          <p className="text-sm text-neutral-500">
            You have not created any events yet. Click "+ Create New Event" to get started.
          </p>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div className="space-y-1">
                <Link
                  to={`/organizer/events/${ev.id}`}
                  className="text-lg font-bold text-neutral-900 hover:text-emerald-700 transition"
                >
                  {ev.name}
                </Link>
                <div className="text-xs text-neutral-500 flex flex-wrap gap-x-3 gap-y-1">
                  <span>📍 {ev.location}</span>
                  <span>
                    📅 {new Date(ev.starts_at).toLocaleDateString()} –{" "}
                    {new Date(ev.ends_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 line-clamp-2 pt-1">
                  {ev.description || "No description provided."}
                </p>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                <Link
                  to={`/organizer/events/${ev.id}`}
                  className="bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
                >
                  Manage Tiers →
                </Link>
                <Link
                  to={`/e/${ev.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-emerald-700 hover:text-emerald-800 font-medium underline underline-offset-2"
                >
                  View Public Page ↗
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
