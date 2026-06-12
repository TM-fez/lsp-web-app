interface Props {
  className?: string;
}

/** Recreation of the Lifestyle Apartments triangular A-frame mark. Uses currentColor. */
export function LifestyleMark({ className }: Props) {
  return (
    <svg
      viewBox="0 0 48 44"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 3 L45 41 H3 Z" />
      <path d="M24 17.5 L34.5 37 H13.5 Z" />
    </svg>
  );
}
