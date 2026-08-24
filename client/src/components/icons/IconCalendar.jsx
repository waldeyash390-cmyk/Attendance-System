export default function IconCalendar({ size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.25" y="4.75" width="17.5" height="16" rx="2.5" />
      <path d="M3.25 9.5h17.5" />
      <path d="M8 3v3" />
      <path d="M16 3v3" />
      <circle cx="8.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
