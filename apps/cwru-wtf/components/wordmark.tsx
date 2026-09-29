import BrandExpansionMark from "@/components/brand-expansion-mark"

// The burst mark is the "dot" in dot WTF.
export default function Wordmark() {
  return (
    <span aria-label="dot WTF" className="whitespace-nowrap" role="img">
      <BrandExpansionMark className="mr-[0.04em] inline-block size-[0.56em] shrink-0" />
      <span aria-hidden="true">wtf</span>
    </span>
  )
}
