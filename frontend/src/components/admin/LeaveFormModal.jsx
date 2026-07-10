import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { Field, Select, TextInput } from "./Field";
import { LEAVE_TYPE_META, countBusinessDays } from "../../lib/utils";
import { adminCreateLeave, adminUpdateLeave } from "../../lib/api";

const TYPES = Object.keys(LEAVE_TYPE_META);
const STATUSES = ["approved", "pending", "rejected"];

const BLANK = { leave_type: "earned", start_date: "", end_date: "", note: "", status: "approved" };

export default function LeaveFormModal({ open, onClose, onSaved, userId, leave, holidays }) {
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(leave
      ? {
          leave_type: leave.leave_type,
          start_date: leave.start_date,
          end_date: leave.end_date,
          note: leave.note ?? "",
          status: leave.status,
        }
      : BLANK);
  }, [open, leave?.id]);

  const isEdit = !!leave;
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Start date alone is enough to imply a single-day leave.
  const endDate = form.end_date || form.start_date;
  const workingDays =
    form.start_date && endDate >= form.start_date
      ? countBusinessDays(form.start_date, endDate, holidays)
      : 0;

  async function handleSave() {
    if (!form.start_date) { setError("Pick a start date."); return; }
    if (endDate < form.start_date) { setError("End date cannot be before the start date."); return; }

    setSaving(true);
    setError("");
    try {
      const payload = { ...form, end_date: endDate, note: form.note.trim() || null };
      if (isEdit) await adminUpdateLeave(leave.id, payload);
      else await adminCreateLeave(userId, payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.detail ?? "Couldn't save this leave.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit leave" : "Add leave"} size="lg">
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <Select value={form.leave_type} onChange={set("leave_type")}>
              {TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_META[t].label}</option>)}
            </Select>
          </Field>
          <Field label="Status" hint="Approved leave is deducted from their balance.">
            <Select value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date"><TextInput type="date" value={form.start_date} onChange={set("start_date")} /></Field>
          <Field label="End date" hint="Leave blank for a single day.">
            <TextInput type="date" value={form.end_date} onChange={set("end_date")} min={form.start_date || undefined} />
          </Field>
        </div>

        {workingDays > 0 && (
          <p className="text-[13.5px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            {workingDays} working {workingDays === 1 ? "day" : "days"} · weekends and company holidays excluded
          </p>
        )}

        <Field label="Note"><TextInput value={form.note} onChange={set("note")} placeholder="Optional" /></Field>

        <p className="text-[12.5px] text-slate-400">
          Admin leave skips notice periods, overlap checks and limits, and sends no Slack messages.
        </p>

        {error && <p role="alert" className="text-[13.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Add leave"}
        </Button>
      </div>
    </Modal>
  );
}
