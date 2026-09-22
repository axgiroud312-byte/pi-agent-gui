import { cn } from "@/components/lib/utils.js";

// Keep the native component contract and sizing; only the product mark changes.
export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 20h44M23 20v21c0 7-3 10-7 10M43 20v25c0 4 2 6 6 6"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return <span className={cn("shrink-0 font-semibold text-current", className)}>Pi Agent IDE</span>;
}
