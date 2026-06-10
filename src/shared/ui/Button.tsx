import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger" | "danger-solid";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<Variant, string> = {
    primary: "bg-primary text-white hover:opacity-90 active:opacity-80",
    ghost: "border border-border text-fg hover:bg-border",
    // Destructive affordances get real variants — a `text-danger`
    // tacked on via className loses the specificity coin-toss against
    // the ghost variant's own `text-fg` (stylesheet order decides).
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
    "danger-solid": "bg-danger text-white hover:opacity-90 active:opacity-80",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
