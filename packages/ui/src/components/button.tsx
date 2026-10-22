import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

// COMPONENT-SPECS §2. One primary per view; destructive is never red-filled.
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action shadow-primary hover:bg-action-hover',
        secondary: 'border border-control-border bg-transparent text-text hover:border-text',
        text: 'h-auto px-0 text-link underline-offset-4 hover:underline',
        destructive: 'border border-bad bg-transparent text-bad hover:bg-bad-tint',
        icon: 'text-text-2 hover:bg-ground-2 hover:text-text',
      },
      size: {
        sm: 'h-8 px-3 text-sm [&_svg]:size-4',
        md: 'h-10 px-4 text-[15px]',
        lg: 'h-12 px-5 text-base',
        icon: 'size-10 p-0',
        'icon-sm': 'size-8 p-0 [&_svg]:size-4',
      },
    },
    compoundVariants: [{ variant: 'text', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner, keeps the label, disables the button and sets aria-busy (§2 states). */
  loading?: boolean;
  /** Render the child element (for example a router Link) with button styles. */
  asChild?: boolean;
  icon?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  asChild = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  if (asChild) {
    return <Slot.Root className={cn(buttonVariants({ variant, size }), className)}>{children}</Slot.Root>;
  }
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
