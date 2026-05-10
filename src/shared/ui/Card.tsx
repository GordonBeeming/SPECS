import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-5 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
