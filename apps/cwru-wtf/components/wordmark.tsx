import BrandSpark from "@/components/brand-spark"

export default function Wordmark() {
  return (
    <span aria-label="cwru.wtf" className="whitespace-nowrap" role="img">
      <span aria-hidden="true">cwru</span>
      <BrandSpark className="mx-[0.015em] inline-block size-[0.24em] shrink-0 align-[-0.015em]" />
      <span aria-hidden="true">wtf</span>
    </span>
  )
}
