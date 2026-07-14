import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import UserSelect from "./UserSelect";
import { Field, TextInput } from "./Field";
import { adminCreateUser, adminUpdateUser } from "../../lib/api";

const BLANK = {
  email: "", name: "", role: "", phone_number: "", manager_id: null,
  slack_user_id: "", birthday: "", joining_date: "", is_admin: false,
};

function toForm(user) {
  if (!user) return BLANK;
  return {
    email: user.email ?? "",
    name: user.name ?? "",
    role: user.role ?? "",
    phone_number: user.phone_number ?? "",
    manager_id: user.manager_id ?? null,
    slack_user_id: user.slack_user_id ?? "",
    birthday: user.birthday ?? "",
    joining_date: user.joining_date ?? "",
    is_admin: !!user.is_admin,
  };
}

/** Blank optional strings must go back as null, or the API stores "". */
function toPayload(form) {
  return {
    ...form,
    phone_number: form.phone_number || null,
    slack_user_id: form.slack_user_id || null,
    birthday: form.birthday || null,
    joining_date: form.joining_date || null,
  };
}

export default function UserFormModal({ open, onClose, onSaved, user, users }) {
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setForm(toForm(user)); setError(""); } }, [open, user?.id]);

  const isEdit = !!user;
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSave() {
    if (!form.name.trim() || !form.email.trim() || !form.role.trim()) {
      setError("Name, email and role are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = toPayload(form);
      if (isEdit) await adminUpdateUser(user.id, payload);
      else await adminCreateUser(payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.detail ?? "Couldn't save this user.");
    } finally {
      setSaving(false);
    }
  }

  // Nobody may manage themselves. Descendant cycles are caught by the API.
  const managerOptions = users.filter((u) => u.id !== user?.id);

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit ${user.name}` : "New user"} size="lg">
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><TextInput value={form.name} onChange={set("name")} placeholder="Priya Sharma" /></Field>
          <Field label="Role"><TextInput value={form.role} onChange={set("role")} placeholder="Senior Engineer" /></Field>
        </div>

        <Field
          label="Email"
          hint={isEdit ? undefined : "They sign in with Google using this address."}
        >
          <TextInput type="email" value={form.email} onChange={set("email")} placeholder="priya@1digitalstack.ai" />
        </Field>

        <Field label="Phone" hint="Optional. Contact number shown on their profile.">
          <TextInput type="tel" value={form.phone_number} onChange={set("phone_number")} placeholder="+91 98765 43210" />
        </Field>

        <Field label="Manager">
          <UserSelect
            users={managerOptions}
            value={form.manager_id}
            onChange={(id) => setForm((f) => ({ ...f, manager_id: id }))}
            placeholder="— No manager —"
            allowNone
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Birthday"><TextInput type="date" value={form.birthday} onChange={set("birthday")} /></Field>
          <Field label="Joining date"><TextInput type="date" value={form.joining_date} onChange={set("joining_date")} /></Field>
        </div>

        <Field label="Slack member ID" hint="Optional. Used to DM them about leave approvals.">
          <TextInput value={form.slack_user_id} onChange={set("slack_user_id")} placeholder="U01ABC23DEF" />
        </Field>

        <label className="flex items-center gap-3 pt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_admin}
            onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-[14px] text-slate-700">Administrator</span>
          <span className="text-[12.5px] text-slate-400">Can see and change everything here</span>
        </label>

        {error && <p role="alert" className="text-[13.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create user"}
        </Button>
      </div>
    </Modal>
  );
}
