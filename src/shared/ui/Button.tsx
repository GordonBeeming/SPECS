import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<Variant, string> = {
    primary:
      "bg-[var(--color-primary)] text-white hover:opacity-90 active:opacity-80",
    ghost:
      "border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-border)]",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
