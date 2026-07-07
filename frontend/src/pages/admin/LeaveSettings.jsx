import { useState, useEffect } from "react";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { getLeaveLimits, getLeaveRules, updateLeaveLimits, updateLeaveRules, getHolidays, addHoliday, updateHoliday, deleteHoliday } from "../../lib/api";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";

function formatHolidayDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SectionTitle({ children }) {
  return (
    <h2 className="text-[15px] font-semibold text-slate-900 mb-4">{children}</h2>
  );
}

export default function LeaveSettings() {
  const [limits, setLimits] = useState({ sick: 0, casual: 0 });
  const [draftLimits, setDraftLimits] = useState({ sick: 0, casual: 0 });
  const [editingLimits, setEditingLimits] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);

  const defaultNotice = [
    { min: 1, max: 1, notice: 3 },
    { min: 2, max: 2, notice: 7 },
    { min: 3, max: 3, notice: 14 },
    { min: 4, max: null, notice: 30 },
  ];
  const [notice, setNotice] = useState(defaultNotice);
  const [draftNotice, setDraftNotice] = useState(defaultNotice);
  const [editingRules, setEditingRules] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  const [holidays, setHolidays] = useState([]);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "" });
  const [addError, setAddError] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);

  const [editingDate, setEditingDate] = useState(null);
  const [editDraft, setEditDraft] = useState({ date: "", name: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDeleteDate, setConfirmDeleteDate] = useState(null);
  const [deletingHoliday, setDeletingHoliday] = useState(false);

  useEffect(() => {
    Promise.all([getLeaveLimits(), getLeaveRules(), getHolidays()]).then(([lim, rules, hols]) => {
      setLimits(lim);
      setDraftLimits({ ...lim });
      const n = rules.casual_advance_notice ?? defaultNotice;
      setNotice(n);
      setDraftNotice(n.map(r => ({ ...r })));
      setHolidays(hols);
    });
  }, []);

  async function handleSaveLimits() {
    setSavingLimits(true);
    try {
      const updated = await updateLeaveLimits(draftLimits);
      setLimits(updated);
      setDraftLimits({ ...updated });
      setEditingLimits(false);
    } finally {
      setSavingLimits(false);
    }
  }

  function handleCancelLimits() {
    setDraftLimits({ ...limits });
    setEditingLimits(false);
  }

  async function handleSaveRules() {
    setSavingRules(true);
    try {
      const updated = await updateLeaveRules({ casual_advance_notice: draftNotice });
      const n = updated.casual_advance_notice ?? draftNotice;
      setNotice(n);
      setDraftNotice(n.map(r => ({ ...r })));
      setEditingRules(false);
    } finally {
      setSavingRules(false);
    }
  }

  function handleCancelRules() {
    setDraftNotice(notice.map(r => ({ ...r })));
    setEditingRules(false);
  }

  function updateDraftRow(i, field, value) {
    setDraftNotice(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  function removeDraftRow(i) {
    setDraftNotice(prev => prev.filter((_, idx) => idx !== i));
  }

  function addDraftRow() {
    setDraftNotice(prev => {
      const last = prev[prev.length - 1];
      const newMin = last ? (last.max != null ? last.max + 1 : last.min + 1) : 1;
      return [...prev, { min: newMin, max: null, notice: 0 }];
    });
  }

  function noticeRuleLabel(rule) {
    if (rule.max == null) return `${rule.min}+ days`;
    if (rule.min === rule.max) return `${rule.min} day${rule.min === 1 ? "" : "s"}`;
    return `${rule.min}–${rule.max} days`;
  }

  async function handleAddHoliday() {
    if (!newHoliday.date || !newHoliday.name.trim()) {
      setAddError("Both date and name are required.");
      return;
    }
    setSavingAdd(true);
    setAddError("");
    try {
      const updated = await addHoliday({ date: newHoliday.date, name: newHoliday.name.trim() });
      setHolidays(updated);
      setNewHoliday({ date: "", name: "" });
      setAddingHoliday(false);
    } catch (e) {
      setAddError(e?.response?.data?.detail ?? "Failed to add holiday.");
    } finally {
      setSavingAdd(false);
    }
  }

  async function handleSaveEdit() {
    if (!editDraft.name.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await updateHoliday(editingDate, {
        name: editDraft.name.trim(),
        date: editDraft.date !== editingDate ? editDraft.date : undefined,
      });
      setHolidays(updated);
      setEditingDate(null);
    } catch (e) {
      // silently keep editing
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteHoliday() {
    setDeletingHoliday(true);
    try {
      await deleteHoliday(confirmDeleteDate);
      setHolidays((prev) => prev.filter((h) => h.date !== confirmDeleteDate));
      setConfirmDeleteDate(null);
    } finally {
      setDeletingHoliday(false);
    }
  }

  function startEdit(h) {
    setEditingDate(h.date);
    setEditDraft({ date: h.date, name: h.name });
  }

  const today = new Date().toISOString().split("T")[0];
  const upcoming = holidays.filter((h) => h.date >= today);
  const past = holidays.filter((h) => h.date < today);

  return (
    <div className="p-8">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,42rem)_1fr] gap-8 items-start">

        {/* Left column — policy cards */}
        <div className="space-y-8">
          {/* Leave Limits */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <SectionTitle>Leave Limits</SectionTitle>
              {!editingLimits ? (
                <Button variant="secondary" size="sm" onClick={() => setEditingLimits(true)}>
                  <Pencil size={13} />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCancelLimits} disabled={savingLimits}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSaveLimits} disabled={savingLimits}>
                    {savingLimits ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {Object.entries(limits).map(([key]) => (
                <div key={key} className="bg-slate-50 rounded-xl p-4">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    {key.charAt(0).toUpperCase() + key.slice(1)} Leave
                  </p>
                  {editingLimits ? (
                    <input
                      type="number"
                      min={0}
                      value={draftLimits[key] ?? ""}
                      onChange={(e) =>
                        setDraftLimits((prev) => ({ ...prev, [key]: parseInt(e.target.value) || 0 }))
                      }
                      className="w-full text-[22px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-[32px] font-bold text-slate-900 leading-none">
                      {limits[key]}
                      <span className="text-[14px] font-normal text-slate-400 ml-1.5">days / year</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Casual Leave Notice Rules */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <SectionTitle>Casual Leave Notice Requirements</SectionTitle>
              {!editingRules ? (
                <Button variant="secondary" size="sm" onClick={() => setEditingRules(true)}>
                  <Pencil size={13} />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCancelRules} disabled={savingRules}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSaveRules} disabled={savingRules}>
                    {savingRules ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {(editingRules ? draftNotice : notice).map((rule, i) =>
                editingRules ? (
                  <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-2.5">
                    <span className="text-[12px] text-slate-500 shrink-0">From</span>
                    <input
                      type="number"
                      min={1}
                      value={rule.min}
                      onChange={(e) => updateDraftRow(i, "min", parseInt(e.target.value) || 1)}
                      className="w-14 text-[13px] font-semibold text-slate-900 text-center bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[12px] text-slate-500 shrink-0">to</span>
                    <input
                      type="number"
                      min={rule.min}
                      value={rule.max ?? ""}
                      placeholder="∞"
                      onChange={(e) => updateDraftRow(i, "max", e.target.value === "" ? null : parseInt(e.target.value) || null)}
                      className="w-14 text-[13px] font-semibold text-slate-900 text-center bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[12px] text-slate-500 shrink-0">days</span>
                    <span className="text-[12px] text-slate-300 mx-1">→</span>
                    <input
                      type="number"
                      min={0}
                      value={rule.notice}
                      onChange={(e) => updateDraftRow(i, "notice", parseInt(e.target.value) || 0)}
                      className="w-14 text-[13px] font-semibold text-slate-900 text-center bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[12px] text-slate-400 flex-1 shrink-0">days notice</span>
                    <button onClick={() => removeDraftRow(i)} className="text-slate-300 hover:text-red-500 transition-colors ml-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                    <span className="text-[13.5px] font-medium text-slate-700">{noticeRuleLabel(rule)} leave</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-slate-900">{rule.notice}</span>
                      <span className="text-[12px] text-slate-400 w-20">days notice</span>
                    </div>
                  </div>
                )
              )}
              {editingRules && (
                <button
                  onClick={addDraftRow}
                  className="w-full flex items-center justify-center gap-1.5 text-[12px] text-slate-400 hover:text-blue-600 border border-dashed border-slate-200 hover:border-blue-400 rounded-xl py-2.5 transition-colors"
                >
                  <Plus size={13} />
                  Add bracket
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right column — Holiday Calendar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <SectionTitle>Holiday Calendar</SectionTitle>
            {!addingHoliday && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setAddingHoliday(true); setAddError(""); }}
              >
                <Plus size={13} />
                Add Holiday
              </Button>
            )}
          </div>

          {/* Add form */}
          {addingHoliday && (
            <div className="mb-5 bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-[12px] font-semibold text-slate-600 mb-3">New Holiday</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={newHoliday.date}
                    onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
                    className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={newHoliday.name}
                    onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Diwali"
                    className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              {addError && <p className="text-[12px] text-red-600 mb-2">{addError}</p>}
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={handleAddHoliday} disabled={savingAdd}>
                  {savingAdd ? "Adding…" : "Add"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setAddingHoliday(false); setNewHoliday({ date: "", name: "" }); setAddError(""); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Upcoming + Past side by side */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Upcoming
              </p>
              {upcoming.length === 0 ? (
                <p className="text-[13px] text-slate-400">No upcoming holidays.</p>
              ) : (
                <div className="space-y-1">
                  {upcoming.map((h) => (
                    <HolidayRow
                      key={h.date}
                      holiday={h}
                      isEditing={editingDate === h.date}
                      editDraft={editDraft}
                      setEditDraft={setEditDraft}
                      savingEdit={savingEdit}
                      onEdit={() => startEdit(h)}
                      onSaveEdit={handleSaveEdit}
                      onCancelEdit={() => setEditingDate(null)}
                      onDelete={() => setConfirmDeleteDate(h.date)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className={past.length === 0 ? "opacity-50" : ""}>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Past
              </p>
              {past.length === 0 ? (
                <p className="text-[13px] text-slate-400">No past holidays.</p>
              ) : (
                <div className="space-y-1 opacity-50">
                  {past.map((h) => (
                    <HolidayRow
                      key={h.date}
                      holiday={h}
                      isEditing={editingDate === h.date}
                      editDraft={editDraft}
                      setEditDraft={setEditDraft}
                      savingEdit={savingEdit}
                      onEdit={() => startEdit(h)}
                      onSaveEdit={handleSaveEdit}
                      onCancelEdit={() => setEditingDate(null)}
                      onDelete={() => setConfirmDeleteDate(h.date)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      <ConfirmDialog
        open={confirmDeleteDate !== null}
        onClose={() => setConfirmDeleteDate(null)}
        onConfirm={handleDeleteHoliday}
        title="Delete holiday?"
        message={
          confirmDeleteDate
            ? `Remove "${holidays.find((h) => h.date === confirmDeleteDate)?.name}" from the calendar?`
            : undefined
        }
        loading={deletingHoliday}
      />
    </div>
  );
}

function HolidayRow({ holiday, isEditing, editDraft, setEditDraft, savingEdit, onEdit, onSaveEdit, onCancelEdit, onDelete }) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 rounded-lg">
        <input
          type="date"
          value={editDraft.date}
          onChange={(e) => setEditDraft((p) => ({ ...p, date: e.target.value }))}
          className="text-[12.5px] border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          value={editDraft.name}
          onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
          className="flex-1 text-[12.5px] border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <button
          onClick={onSaveEdit}
          disabled={savingEdit}
          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
        >
          <Check size={14} />
        </button>
        <button
          onClick={onCancelEdit}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
      <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
      <span className="text-[13px] font-medium text-slate-800 flex-1">{holiday.name}</span>
      <span className="text-[12px] text-slate-400">{formatHolidayDate(holiday.date)}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
