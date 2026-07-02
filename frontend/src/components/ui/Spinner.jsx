export default function Spinner({ className = "" }) {
  return (
    <div className={`w-5 h-5 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin shrink-0 ${className}`} />
  );
}
