import BrandExpansionMark from "@/components/brand-expansion-mark"

export default function Wordmark() {
  return (
    <span aria-label="cwru.wtf" className="whitespace-nowrap" role="img">
      <span aria-hidden="true">cwru</span>
      <BrandExpansionMark className="mx-[0.04em] inline-block size-[0.56em] shrink-0" />
      <span aria-hidden="true">wtf</span>
    </span>
  )
}
