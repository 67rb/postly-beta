import { useEffect, useId, useRef, useState } from "react";

// A disclosure can contain ordinary buttons, inputs, and links. Keeping their
// native semantics also keeps checkbox filters usable with a keyboard.
export function Popover({ label, trigger, children, className = "", panelClassName = "", buttonClassName = "", align = "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  const button = useRef(null);
  const panel = useRef(null);
  const keyboardOpen = useRef("");
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  useEffect(() => {
    const anotherOpened = event => { if (event.detail !== id) setOpen(false); };
    document.addEventListener("postly-popover-open", anotherOpened);
    return () => document.removeEventListener("postly-popover-open", anotherOpened);
  }, [id]);

  useEffect(() => {
    if (!open) return;
    document.dispatchEvent(new CustomEvent("postly-popover-open", { detail: id }));
    if (keyboardOpen.current) {
      const controls = [...panel.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],select') || []];
      (keyboardOpen.current === "last" ? controls.at(-1) : controls[0])?.focus();
    }
    keyboardOpen.current = "";
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", resize);
    };
  }, [open, id]);

  return <div ref={root} className={`pw-disclosure ${className}`}>
    <button ref={button} type="button" className={buttonClassName} aria-label={label} aria-haspopup="true" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowUp" ? "last" : "first";
          if (open) {
            const controls = [...panel.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],select') || []];
            (direction === "last" ? controls.at(-1) : controls[0])?.focus();
          } else { keyboardOpen.current = direction; setOpen(true); }
        } else if (!open && (event.key === "Enter" || event.key === " ")) keyboardOpen.current = "first";
      }}>
      {trigger}
    </button>
    {open && <div ref={panel} id={id} className={`pw-popover pw-disclosure-panel align-${align} ${panelClassName}`} role="group" aria-label={`${label} options`}>
      {typeof children === "function" ? children(close) : children}
    </div>}
  </div>;
}
