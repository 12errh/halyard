import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldBase = [
  "w-full rounded-[7px] bg-surface border border-line text-ink",
  "placeholder:text-ink-ghost",
  "transition-colors duration-150",
  "hover:border-line-strong",
  "focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-[var(--ring)]",
  "disabled:opacity-50",
].join(" ");

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(fieldBase, "h-8 px-2.5 text-[0.85rem]", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldBase, "px-2.5 py-2 text-[0.85rem] resize-none", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
