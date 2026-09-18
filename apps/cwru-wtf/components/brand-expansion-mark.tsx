import type { SVGProps } from "react"

export default function BrandExpansionMark({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path
        d="M7.35 8.45 6.55 1.45M7.35 8.45l4.6-5.8M7.35 8.45l7-1.4M7.35 8.45l4.9 4.5M7.35 8.45l.37 6.05M7.35 8.45l-4.8 3.75M7.35 8.45l-5.9-.77"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <circle cx="7.35" cy="8.45" fill="currentColor" r="1.48" />
      <circle cx="14" cy="2.05" fill="currentColor" r="0.72" />
    </svg>
  )
}
