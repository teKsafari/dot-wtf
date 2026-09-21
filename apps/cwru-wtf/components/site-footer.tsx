import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import PeekCat from "@/components/peek-cat"
import Wordmark from "@/components/wordmark"

const columns = [
  {
    label: "Explore",
    links: [
      { href: "/#about", label: "About" },
      { href: "/calendar", label: "Calendar" },
      { href: "/join", label: "Join" },
    ],
  },
  {
    label: "Elsewhere",
    links: [
      { href: "https://github.com/teksafari/dot-wtf", label: "GitHub", external: true },
      { href: "https://instagram.com/cwru.wtf", label: "Instagram", external: true },
    ],
  },
]

const labelClassName =
  "font-mono text-caption uppercase tracking-[0.2em] text-muted-foreground"

// Display-size links that recede on hover, rather than small links that light
// up: the footer is the one place the type gets to be loud.
const linkClassName =
  "group/link focus-ring inline-flex min-h-9 w-fit items-center gap-1 rounded-sm font-brand text-xl font-semibold leading-none tracking-[-0.02em] text-foreground transition-colors duration-150 hover:text-muted-foreground motion-reduce:transition-none md:text-2xl"

export default function SiteFooter() {
  return (
    // The footer is the last thing on the page, so clipping it vertically makes
    // the page's own bottom edge the thing the cat peeks over. Only the y axis
    // is clipped: below `sm` the cat is pinned past the container, to the
    // viewport edge, the way the hero's cats are.
    <footer className="group/footer relative overflow-y-clip">
      {/* The bottom padding keeps the last row clear of the fixed nav dock,
          which floats over the end of the page. */}
      <div className="grid gap-12 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-16 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16 md:pb-32 md:pt-20">
        <div>
          {/* The mark is the footer's anchor: display-sized, with its cap
              line starting level with the column labels. */}
          <Link
            href="/"
            className="focus-ring inline-block rounded-sm font-brand text-[2rem] font-semibold leading-none tracking-[-0.03em] text-foreground md:text-[2.5rem]"
          >
            <Wordmark />
          </Link>
          <p className="mt-3 font-brand text-base italic text-muted-foreground">
            Powered by{" "}
            <a
              href="https://teksafari.org"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded-sm text-foreground underline underline-offset-4 transition-colors duration-150 hover:text-muted-foreground motion-reduce:transition-none"
            >
              teKsafari
            </a>
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 md:flex md:gap-24">
          {columns.map((column) => (
            <div key={column.label}>
              <p id={`footer-${column.label}`} className={labelClassName}>
                {column.label}
              </p>
              <ul
                aria-labelledby={`footer-${column.label}`}
                className="m-0 mt-4 flex list-none flex-col gap-1 p-0"
              >
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClassName}
                      >
                        {link.label}
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5 motion-reduce:transition-none"
                        />
                      </a>
                    ) : (
                      <Link href={link.href} className={linkClassName}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      {/* Rises slowly when the pointer comes near and ducks fast when it
          leaves: the hover state owns the slow duration, the rest state the
          quick one. */}
      <PeekCat className="pointer-events-none absolute bottom-0 right-[calc(50%-50vw)] w-[clamp(88px,11vw,132px)] translate-y-[41%] text-foreground/80 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/footer:translate-y-[25%] group-hover/footer:duration-500 motion-reduce:transition-none sm:right-0" />
    </footer>
  )
}
