/**
 * Shown instantly while a page loads (tab switch or refresh), so the app never looks stuck.
 * The top navigation stays; only the page area shows this placeholder.
 */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-9 w-56 rounded-xl bg-black/[0.06]" />
      <div className="mb-8 h-4 w-80 max-w-full rounded-lg bg-black/[0.05]" />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass h-20 rounded-2xl" />
        ))}
      </div>
      <div className="glass overflow-hidden rounded-2xl">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-black/[0.04] px-4 py-3.5 last:border-0">
            <div className="h-4 w-40 rounded bg-black/[0.06]" />
            <div className="h-4 w-24 rounded bg-black/[0.05]" />
            <div className="hidden h-4 w-32 rounded bg-black/[0.05] sm:block" />
            <div className="ml-auto h-4 w-16 rounded bg-black/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  );
}
