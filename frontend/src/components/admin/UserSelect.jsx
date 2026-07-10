import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import Avatar from "../ui/Avatar";

/** A searchable people picker. `value` is a user id, or null for none chosen. */
export default function UserSelect({ users, value, onChange, placeholder = "Select a user", allowNone = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = users.find((u) => u.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      [u.name, u.role, u.email].filter(Boolean).some((f) => f.toLowerCase().includes(needle))
    );
  }, [users, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(id) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5
                   hover:bg-slate-50 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {selected ? (
          <>
            <Avatar name={selected.name} size="sm" />
            <span className="flex-1 text-left min-w-0">
              <span className="block text-[14.5px] font-semibold text-slate-900 truncate">{selected.name}</span>
              <span className="block text-[12px] text-slate-400 truncate">{selected.role}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-left text-[14.5px] text-slate-400">{placeholder}</span>
        )}
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-2 w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 relative">
            <Search size={15} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              className="w-full text-[14px] bg-slate-50 rounded-lg pl-9 pr-3 py-2 text-slate-800
                         placeholder:text-slate-400 focus:outline-none focus:bg-white
                         focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div role="listbox" className="max-h-72 overflow-y-auto p-1.5">
            {allowNone && (
              <div
                role="option"
                aria-selected={value === null}
                onClick={() => choose(null)}
                className="px-2.5 py-2 rounded-lg text-[14px] text-slate-500 cursor-pointer hover:bg-slate-50"
              >
                — None —
              </div>
            )}

            {matches.length === 0 && (
              <p className="text-[13.5px] text-slate-400 text-center py-6">No one matches “{query}”.</p>
            )}

            {matches.map((u) => (
              <div
                key={u.id}
                role="option"
                aria-selected={u.id === value}
                onClick={() => choose(u.id)}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer
                            ${u.id === value ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <Avatar name={u.name} size="sm" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-slate-800 truncate leading-tight">{u.name}</p>
                  <p className="text-[12px] text-slate-400 truncate leading-tight mt-0.5">{u.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
