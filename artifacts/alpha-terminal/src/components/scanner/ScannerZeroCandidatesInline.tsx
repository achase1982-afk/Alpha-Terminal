/** Inline copy when v2 scan returns zero candidates (no bordered empty card). */
export function ScannerZeroCandidatesInline() {
  return (
    <p className="mt-2 px-1 text-left text-xs leading-snug text-zinc-500">
      No candidates matched your filters. Try a different universe or adjust filters, then scan again.
    </p>
  );
}
