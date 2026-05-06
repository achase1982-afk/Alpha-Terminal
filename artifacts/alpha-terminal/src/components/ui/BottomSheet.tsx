import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

const DrawerPortal = DrawerPrimitive.Portal;

const BottomSheetOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
));
BottomSheetOverlay.displayName = "BottomSheetOverlay";

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Mobile-friendly bottom sheet (Vaul): slide-up, backdrop dismiss, safe-area padding.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description = "",
  children,
  className,
}: BottomSheetProps) {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false} modal>
      <DrawerPortal>
        <BottomSheetOverlay />
        <DrawerPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-[10px] border border-zinc-700 bg-zinc-950 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-zinc-100 shadow-xl outline-none",
            className,
          )}
        >
          <DrawerPrimitive.Title className="sr-only">{title}</DrawerPrimitive.Title>
          <DrawerPrimitive.Description className="sr-only">{description || title}</DrawerPrimitive.Description>
          <div
            className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-zinc-600"
            aria-hidden
          />
          <div className="flex min-h-0 flex-1 flex-col px-4">{children}</div>
        </DrawerPrimitive.Content>
      </DrawerPortal>
    </DrawerPrimitive.Root>
  );
}
