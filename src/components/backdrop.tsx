/**
 * Soft, blurred forest-green and gold light behind every page.
 * It is what the frosted-glass panels blur, giving the calm "Apple" depth.
 * Purely decorative: fixed, behind everything, ignored by screen readers and clicks.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-40 size-[38rem] rounded-full bg-[#1f4d36] opacity-[0.10] blur-[120px]" />
      <div className="absolute -right-32 top-24 size-[32rem] rounded-full bg-[#c9a227] opacity-[0.14] blur-[120px]" />
      <div className="absolute -bottom-48 left-1/3 size-[36rem] rounded-full bg-[#2f6f4f] opacity-[0.08] blur-[140px]" />
    </div>
  );
}
