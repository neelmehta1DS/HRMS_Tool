import Modal from "./Modal";

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  loading = false,
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" panelClassName="!max-w-[576px]">
      <div className="px-9 py-7">
        <h2 className="text-[22px] font-bold text-slate-900 tracking-tight mb-2">{title}</h2>
        {message && (
          <p className="text-[16px] text-slate-500 leading-relaxed mb-7">{message}</p>
        )}
        <div className="flex justify-end gap-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-6 py-3 rounded-xl border-[1.5px] border-slate-200 bg-white text-[16px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-6 py-3 rounded-xl bg-red-600 text-white text-[16px] font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
