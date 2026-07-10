import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import UserSelect from "./UserSelect";
import { Field, TextInput } from "./Field";
import { adminCreateCatchup, adminUpdateCatchup } from "../../lib/api";

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" and nothing more.
const toLocalInput = (iso) => (iso ? iso.slice(0, 16) : "");

export default function CatchupFormModal({ open, onClose, onSaved, userId, catchup, users }) {
  const [form, setForm] = useState({ manager_id: null, alternate_manager_id: null, date_and_time: "", meeting_link: "", notes_doc_link: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(catchup
      ? {
          manager_id: catchup.manager_id,
          alternate_manager_id: catchup.alternate_manager_id ?? null,
          date_and_time: toLocalInput(catchup.date_and_time),
          meeting_link: catchup.meeting_link ?? "",
          notes_doc_link: catchup.notes_doc_link ?? "",
        }
      : { manager_id: null, alternate_manager_id: null, date_and_time: "", meeting_link: "", notes_doc_link: "" });
  }, [open, catchup?.id]);

  const isEdit = !!catchup;
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSave() {
    if (!form.manager_id) { setError("Pick a manager."); return; }
    if (!form.date_and_time) { setError("Pick a date and time."); return; }

    setSaving(true);
    setError("");
    try {
      if (isEdit) await adminUpdateCatchup(catchup.id, form);
      else await adminCreateCatchup(userId, form);
      onSaved();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.detail ?? "Couldn't save this catchup.");
    } finally {
      setSaving(false);
    }
  }

  const managerOptions = users.filter((u) => u.id !== userId);

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit catchup" : "Add catchup"} size="lg">
      <div className="px-6 py-5 space-y-4">
        <Field label="Manager">
          <UserSelect users={managerOptions} value={form.manager_id}
                      onChange={(id) => setForm((f) => ({ ...f, manager_id: id }))} placeholder="Select a manager" />
        </Field>

        <Field label="Alternate manager" hint="Optional. Stands in when the manager cannot attend.">
          <UserSelect users={managerOptions} value={form.alternate_manager_id}
                      onChange={(id) => setForm((f) => ({ ...f, alternate_manager_id: id }))}
                      placeholder="— None —" allowNone />
        </Field>

        <Field label="Date and time">
          <TextInput type="datetime-local" value={form.date_and_time} onChange={set("date_and_time")} />
        </Field>

        <Field label="Meeting link"><TextInput value={form.meeting_link} onChange={set("meeting_link")} placeholder="https://meet.google.com/…" /></Field>
        <Field label="Notes doc link"><TextInput value={form.notes_doc_link} onChange={set("notes_doc_link")} placeholder="https://docs.google.com/…" /></Field>

        <p className="text-[12.5px] text-slate-400">
          Admin catchups are recorded only. No Google Doc is created, no calendar invite is sent,
          and deleting one here leaves any existing calendar event in place.
        </p>

        {error && <p role="alert" className="text-[13.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Add catchup"}
        </Button>
      </div>
    </Modal>
  );
}
