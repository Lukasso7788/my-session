import type { ReactNode } from "react";

// Signed-out visitors see who is in or coming to a session only as a blur:
// the counts and people stay in place (so the card keeps its shape) but
// cannot be read or clicked until they sign in.

export const GUEST_BLUR_HINT = "Sign in to see who's here";

export default function GuestBlur({
  active,
  children,
  block = false,
  className = "",
}: {
  active: boolean;
  children: ReactNode;
  /** Use a block wrapper for lists; inline by default for numbers. */
  block?: boolean;
  className?: string;
}) {
  if (!active) return <>{children}</>;
  const Wrapper = block ? "div" : "span";
  return (
    <Wrapper className={`relative ${block ? "block" : "inline-block"} ${className}`} title={GUEST_BLUR_HINT}>
      <Wrapper aria-hidden="true" className={`${block ? "block" : "inline-block"} pointer-events-none select-none blur-[5px]`}>
        {children}
      </Wrapper>
      <span className="sr-only">{GUEST_BLUR_HINT}</span>
    </Wrapper>
  );
}
