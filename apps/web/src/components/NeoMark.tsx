import { useId, type SVGProps } from "react";

/** The shared Neo mark, kept identical to NeoPi and NeoProxy. */
export function NeoMark(props: SVGProps<SVGSVGElement>) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 64 64" {...props} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ed4abf" />
          <stop offset=".5" stopColor="#945ff9" />
          <stop offset="1" stopColor="#5ad8e6" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
    </svg>
  );
}
