import { useEffect, useRef, useState } from 'react';

/** Keep sticky navigation offsets in sync with wrapping, theme and viewport changes. */
export function useWorkflowGuideLayout(visible: boolean) {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const guideRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Separate thresholds prevent repeated resizing near the top of the page.
      setCompact(current => current ? window.scrollY > 16 : window.scrollY > 128);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    const guide = guideRef.current;
    if (!shell || !header) return;
    const measure = () => {
      const headerHeight = getComputedStyle(header).position === 'sticky'
        ? header.getBoundingClientRect().height : 0;
      shell.style.setProperty('--workflow-top', `${headerHeight}px`);
      shell.style.setProperty('--workflow-scroll-offset', `${headerHeight + (guide?.getBoundingClientRect().height ?? 0) + 16}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (guide) observer.observe(guide);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible]);

  return { shellRef, headerRef, guideRef, compact };
}
