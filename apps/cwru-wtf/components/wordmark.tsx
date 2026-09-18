import BrandExpansionMark from "@/components/brand-expansion-mark"

export default function Wordmark() {
  return (
    <span aria-label="cwru.wtf" className="whitespace-nowrap" role="img">
      <span aria-hidden="true">cwru</span>
      <BrandExpansionMark className="mx-[0.03em] inline-block size-[0.42em] shrink-0 align-[0.06em]" />
      <span aria-hidden="true">wtf</span>
    </span>
  )
}
