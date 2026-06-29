import * as React from "react"

import { cn } from "../../lib/utils"

// Inline text-link primitive. The org ui-design-system gate bans raw <a> in
// product source (use a shadcn wrapper); this primitive lives in the
// gate-exempt components/ui dir and is the sanctioned way to render an inline
// link inside body copy. External links (default) automatically open in a new
// tab with safe rel hardening.
function TextLink({
  className,
  external = true,
  target,
  rel,
  ...props
}: React.ComponentProps<"a"> & { external?: boolean }) {
  const resolvedTarget = target ?? (external ? "_blank" : undefined)
  // Harden any new-tab link against tabnabbing / referrer leakage, derived from
  // the effective target so an explicit target="_blank" is covered too.
  const resolvedRel = rel ?? (resolvedTarget === "_blank" ? "noopener noreferrer" : undefined)

  return (
    <a
      data-slot="text-link"
      className={cn(
        "underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm",
        className,
      )}
      target={resolvedTarget}
      rel={resolvedRel}
      {...props}
    />
  )
}

export { TextLink }
