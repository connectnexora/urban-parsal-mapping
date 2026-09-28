import { useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Long diagnostic text (model load errors, disclaimers, API notes) is
 * genuinely important but unusable when printed in full — a single
 * unavailable-model message can run to twenty lines and push everything else
 * off a phone screen.
 *
 * Shows two lines by default and measures whether the text actually
 * overflows, so the "View more" control only appears when it is needed.
 */
export default function CollapsibleText({
  text,
  lines = 2,
  className = '',
  moreLabel = 'View more',
  lessLabel = 'View less',
}) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
  const id = useId();

  // Measure while collapsed only: once expanded the element is no longer
  // clamped, so scrollHeight would equal clientHeight and hide the toggle.
  useLayoutEffect(() => {
    if (open) return;
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, lines, open]);

  if (!text) return null;

  return (
    <div className={`clamp-wrap ${className}`}>
      <p
        id={id}
        ref={ref}
        className={`mono clamp-text ${open ? '' : `clamp-${lines}`}`}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          className="link-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}
