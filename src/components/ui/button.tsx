import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[7px]",
    "text-[0.86rem] font-medium select-none",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out",
    "disabled:pointer-events-none disabled:opacity-45",
    "active:translate-y-px",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-ink hover:bg-accent-hover shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset]",
        secondary:
          "bg-raised text-ink border border-line hover:border-line-strong hover:bg-overlay",
        ghost: "text-ink-muted hover:text-ink hover:bg-raised",
        outline: "border border-line text-ink hover:bg-raised hover:border-line-strong",
        danger: "bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20",
        link: "text-accent underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-7 px-2.5 text-[0.78rem]",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-[0.92rem]",
        icon: "h-8 w-8 p-0",
        "icon-sm": "h-6 w-6 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
