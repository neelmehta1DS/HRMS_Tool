import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, UserMinus } from "lucide-react";
import Avatar from "../ui/Avatar";
import { getValidManagers } from "../../lib/hierarchy";
import { ROLE_LABELS } from "./roleMeta";

const PANEL_W = 320;
const PANEL_MAX_H = 360;

// null id is the "no manager" row; it sorts first.
const NO_MANAGER = { id: null, name: "— No manager —" };

export default function ManagerPicker({ user, users, anchorRect, onSelect, onClose, anchorEl }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = "manager-picker-listbox";
  const optionId = (option) => `manager-option-${option.id ?? "none"}`;

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const valid = getValidManagers(users, user.id).filter((u) =>
      !needle || [u.name, u.role, u.email].filter(Boolean).some((f) => f.toLowerCase().includes(needle))
    );
    const showNone = !needle || "no manager".includes(needle);
    return showNone ? [NO_MANAGER, ...valid] : valid;
  }, [users, user.id, query]);

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keep the keyboard-highlighted option in view as it moves.
  useEffect(() => {
    const active = options[activeIndex];
    if (!active) return;
    const el = document.getElementById(optionId(active));
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, options]);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (anchorEl && anchorEl.contains(e.target)) return; // the toggle handles itself
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    // A scroll behind the popover detaches it from its anchor, so dismiss —
    // but ignore scrolls of the panel's own option list.
    function onScroll(e) {
      // The panel's own option list scrolls; only a scroll behind it detaches
      // the popover from its anchor.
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      onClose();
    }
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, anchorEl]);

  const currentManagerId = user.manager_id ?? null;

  function choose(option) {
    if (option.id === currentManagerId) return; // no-op reassignment
    onSelect(option.id);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, options.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  }

  // Flip above the anchor when there is not enough room below.
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow < PANEL_MAX_H ? Math.max(8, anchorRect.top - PANEL_MAX_H - 8) : anchorRect.bottom + 8;
  const left = Math.max(8, Math.min(anchorRect.right - PANEL_W, window.innerWidth - PANEL_W - 8));

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Change manager for ${user.name}`}
      onKeyDown={onKeyDown}
      style={{ top, left, width: PANEL_W, maxHeight: PANEL_MAX_H }}
      className="fixed z-50 bg-white border border-slate-200 rounded-2xl shadow-xl flex flex-col overflow-hidden"
    >
      <div className="p-3 border-b border-slate-100">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={options[activeIndex] ? optionId(options[activeIndex]) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a manager"
          className="w-full text-[14.5px] bg-slate-50 border border-transparent rounded-lg px-3 py-2
                     text-slate-800 placeholder:text-slate-400
                     focus:outline-none focus:bg-white focus:border-blue-500"
        />
      </div>

      <div id={listboxId} role="listbox" aria-label="Managers" className="overflow-y-auto p-1.5">
        {options.length === 0 && (
          <p className="text-[13.5px] text-slate-400 text-center py-6">No matching people.</p>
        )}

        {options.map((option, i) => {
          const isCurrent = option.id === currentManagerId;
          const isActive = i === activeIndex;
          return (
            <div
              key={option.id ?? "none"}
              id={optionId(option)}
              role="option"
              aria-selected={isActive}
              {...(isCurrent ? { "aria-current": "true" } : {})}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(option)}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${
                isCurrent ? "cursor-default opacity-60" : "cursor-pointer"
              } ${isActive && !isCurrent ? "bg-blue-50" : ""}`}
            >
              {option.id === null ? (
                <span className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  <UserMinus size={16} className="text-slate-400" />
                </span>
              ) : (
                <Avatar name={option.name} size="md" />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium text-slate-800 truncate leading-tight">{option.name}</p>
                {option.id !== null && (
                  <p className="text-[12.5px] text-slate-400 truncate leading-tight mt-0.5">
                    {option.role || ROLE_LABELS[option.role_level]}
                  </p>
                )}
              </div>

              {isCurrent && <Check size={15} className="text-slate-400 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
