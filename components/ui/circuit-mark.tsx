/** Circuit logo mark: a rounded frame with a signal trace, from design/circuit_mockup.html. */
export function CircuitMark({ className = "size-[22px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 22" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6 11h4l2-4 2 8 1.5-4H17"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
