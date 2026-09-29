import type { SVGProps } from "react"

// The orbit mark: dot*WTF is the big dot, and three dotts keep the same
// distance from it. The smallest, in the brand accent, is the newest dott.
export default function BrandExpansionMark({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 200 200"
    >
      <g fill="currentColor">
        <circle cx="87.1" cy="76.8" r="62.8" />
        <circle cx="131.8" cy="160.9" r="25.1" />
        <circle cx="160" cy="121.9" r="15.7" />
      </g>
      <circle className="fill-brand-accent" cx="165.5" cy="89.9" r="9.4" />
    </svg>
  )
}
