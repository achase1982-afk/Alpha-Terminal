/**
 * Idle copy before the first scan — primary action stays in the chrome Scan control.
 */
export function ScannerIdleEmptyState() {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm leading-relaxed text-zinc-400">
        Scanner · Market candidates: <span className="text-zinc-500">No scan run yet.</span>
      </p>
    </div>
  );
}
