import BrandExpansionMark from "@/components/brand-expansion-mark"

// The orbit mark is the "*" in dot*WTF.
export default function Wordmark() {
  return (
    <span aria-label="dot*WTF" className="whitespace-nowrap" role="img">
      <span aria-hidden="true">dot</span>
      <BrandExpansionMark className="mx-[0.04em] inline-block size-[0.56em] shrink-0" />
      <span aria-hidden="true">WTF</span>
    </span>
  )
}
