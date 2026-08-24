export default function IconCalendar({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M8 3v3" />
      <path d="M16 3v3" />
      <circle cx="8.5" cy="14" r="0.8" fill="currentColor" />
      <circle cx="12" cy="14" r="0.8" fill="currentColor" />
      <circle cx="15.5" cy="14" r="0.8" fill="currentColor" />
    </svg>
  );
}
