export default function IconClipboard({ size = 20 }) {
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
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4.5h6v2.2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
