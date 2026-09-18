import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import DeskCat from "@/components/desk-cat"
import PeekCat from "@/components/peek-cat"
import TopCat from "@/components/top-cat"
import WtfMeanings from "@/components/wtf-meanings"
import Wordmark from "@/components/wordmark"
import TallyApplicationForm from "@/components/tally-application-form"
import SiteNav from "@/components/site-nav"
import clubCat from "@/public/cat-i-am.png"



export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1160px] px-6">
      <SiteNav />

      {/* Hero */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center py-20 text-center">
        <h1 className="animate-fade-in-up font-brand text-display text-foreground">
          <Wordmark />
        </h1>

        <WtfMeanings />

        <p className="mt-6 max-w-[52ch] text-pretty font-primary text-body text-muted-foreground md:text-lg">
          A student-led collective of{" "}
          <span className="vibe text-foreground">builders</span>,{" "}
           <span className="vibe text-foreground">researchers</span>,{" "}
          <span className="vibe text-foreground">tinkerers</span>,{" "}
          <span className="vibe text-foreground">artists</span>,{" "}
           <span className="vibe text-foreground">engineers</span>,{" "}
          <span className="vibe text-foreground">hackers</span>, et al...
          encouraging interdisciplinary collaborations among members of the CWRU
          community.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="xl">
            <Link href="#join">
              Join .wtf
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="xl" variant="outline">
            <Link href="#about">What is this?</Link>
          </Button>
        </div>

        {/* left/right-[calc(50%-50vw)] pins each drawing to the viewport edge no
            matter how wide the centered container is, so the cats read as sitting
            at the edges of the page rather than the content column. */}
        <TopCat className="pointer-events-none absolute left-1/2 top-[calc(clamp(120px,min(26vh,40vw),270px)*-0.15)] h-[clamp(120px,min(26vh,40vw),270px)] w-auto -translate-x-1/2 text-foreground/80" />
        <DeskCat className="pointer-events-none absolute bottom-[17%] left-[calc(50%-50vw)] w-[clamp(112px,15vw,220px)] text-foreground/80 md:bottom-auto md:top-[calc(50%-4rem)]" />
        <PeekCat className="pointer-events-none absolute bottom-[9%] right-[calc(50%-50vw)] w-[clamp(84px,11vw,152px)] text-foreground/80 sm:bottom-auto sm:top-[calc(50%-8rem)]" />
      </section>

      {/* About */}
      <section
        id="about"
        className="screen-line-before screen-line-after py-20 md:py-28"
      >
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)] md:gap-14">
          <div>
            <h2 className="max-w-content font-brand text-page-title text-foreground">
              This is not a club!
            </h2>
            <p className="mt-5 max-w-content text-pretty font-primary text-body text-muted-foreground md:text-lg">
              This isn&apos;t a place where we talk about doing things. It&apos;s
              where we actually do them &mdash; hardware hacks, AI experiments,
              art installations, films, open-source tools, weird websites.
              Anything that makes you say &ldquo;wtf, I wanna try that.&rdquo;
            </p>
          </div>

          {/* Tint the original drawing with the same color as the other cats. */}
          <div
            role="img"
            aria-label={'A cat in sunglasses throwing finger guns, replying "I am."'}
            className="mx-auto w-full max-w-[320px] bg-current text-foreground/80 md:max-w-[400px]"
            style={{
              aspectRatio: `${clubCat.width} / ${clubCat.height}`,
              maskImage: `url("${clubCat.src}")`,
              maskSize: "contain",
              maskRepeat: "no-repeat",
              maskPosition: "center",
            }}
          />
        </div>
      </section>

      {/* Join */}
      <section id="join" aria-label="Join CWRU.WTF" className="screen-line-after py-20 md:py-28">
        <TallyApplicationForm />
      </section>

      {/* Footer */}
      <footer className="flex flex-col items-center gap-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-10 sm:flex-row sm:justify-between sm:py-10">
        <span className="font-brand text-lg font-semibold text-foreground">
          <Wordmark />
        </span>
        <span className="font-mono text-caption text-muted-foreground">
          &copy; {new Date().getFullYear()} &mdash; We Tinker Fearlessly
        </span>
      </footer>
    </div>
  )
}
