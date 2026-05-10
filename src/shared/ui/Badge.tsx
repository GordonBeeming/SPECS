import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-border text-fg",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
