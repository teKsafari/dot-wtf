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
      <g transform="translate(3.25 2.82) scale(.62)">
        <path
          d="M7.35 8.45 6.55 1.45M7.35 8.45l4.6-5.8M7.35 8.45l7-1.4M7.35 8.45l4.9 4.5M7.35 8.45l.37 6.05M7.35 8.45l-4.8 3.75M7.35 8.45l-5.9-.77"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.35"
        />
        <circle cx="7.35" cy="8.45" fill="currentColor" r="1.65" />
      </g>
      <g fill="currentColor">
        <circle cx="8" cy="1.65" r="0.52" />
        <circle cx="13.78" cy="5.36" r="0.52" />
        <circle cx="14.29" cy="8.9" r="0.52" />
        <circle cx="12.8" cy="12.16" r="0.52" />
        <circle cx="9.79" cy="14.09" r="0.52" />
        <circle cx="6.21" cy="14.09" r="0.52" />
        <circle cx="3.2" cy="12.16" r="0.52" />
        <circle cx="1.72" cy="8.9" r="0.52" />
        <circle cx="2.22" cy="5.36" r="0.52" />
        <circle cx="4.57" cy="2.66" r="0.52" />
        <circle cx="14" cy="2.05" r="0.7" />
      </g>
    </svg>
  )
}
