import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-sm border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Papier: Stempel = Zustand (Versalien, Umriss in Zustandsfarbe, `tone`)
        stamp:
          "h-[18px] rounded-[2px] border-current bg-transparent px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground [a&]:hover:bg-muted",
        // Papier: Etikett = Zuordnung (Tag, Projekt, Kategorie, Art) mit Farbpunkt
        label:
          "h-5 rounded-[2px] border-border bg-muted px-1.5 py-0 text-[11px] font-medium text-foreground/80 [a&]:hover:bg-accent",
      },
      // Zustandsfarbe eines Stempels (nur mit variant="stamp" wirksam)
      tone: {
        neutral: "",
        good: "",
        warn: "",
        bad: "",
        ink: "",
        brand: "",
      },
    },
    compoundVariants: [
      { variant: "stamp", tone: "good", className: "text-positive" },
      { variant: "stamp", tone: "warn", className: "text-warning" },
      { variant: "stamp", tone: "bad", className: "text-negative" },
      { variant: "stamp", tone: "ink", className: "text-foreground" },
      { variant: "stamp", tone: "brand", className: "text-stamp" },
    ],
    defaultVariants: {
      variant: "default",
      tone: "neutral",
    },
  }
)

function Badge({
  className,
  variant,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, tone }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
