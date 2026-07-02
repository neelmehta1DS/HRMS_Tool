import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, CalendarDays, Users } from "lucide-react";
import { getMe } from "../lib/api";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

const features = [
  { icon: LayoutDashboard, label: "Team dashboard", desc: "See who's in, WFH, or away at a glance." },
  { icon: CalendarDays, label: "Leave management", desc: "Request and approve leave in seconds." },
  { icon: Users, label: "Catchup tracking", desc: "Never miss a 1-on-1 with your team." },
];

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    getMe().then(() => navigate("/", { replace: true })).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-12 overflow-hidden bg-slate-900">
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="absolute top-[-80px] right-[-80px] w-80 h-80 rounded-full bg-blue-600/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-60px] left-[-60px] w-72 h-72 rounded-full bg-indigo-600/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-[12px]">DS</span>
          </div>
          <span className="text-white font-semibold text-[15px] tracking-tight">DigiSync</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-[38px] font-bold text-white leading-tight mb-3">
            People operations,<br />simplified.
          </h1>
          <p className="text-slate-400 text-[14px] mb-10 leading-relaxed">
            One place to manage your team's presence,<br />leave, and 1-on-1s.
          </p>
          <div className="space-y-5">
            {features.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-slate-400" strokeWidth={2} />
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold text-white">{label}</p>
                  <p className="text-[12px] text-slate-500 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 text-[11px] text-slate-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Restricted to @1digitalstack.ai
          </span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[340px]">
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-[11px]">DS</span>
            </div>
            <span className="text-slate-900 font-semibold text-[15px]">DigiSync</span>
          </div>

          <h2 className="text-[26px] font-bold text-slate-900 mb-1">Welcome back</h2>
          <p className="text-[13.5px] text-slate-400 mb-8">Sign in to access your workspace.</p>

          <a
            href="http://localhost:8000/auth/login"
            className="flex items-center justify-center gap-3 w-full px-5 py-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[13.5px] font-semibold hover:border-slate-300 hover:shadow-sm transition-all shadow-sm"
          >
            <GoogleIcon />
            Continue with Google
          </a>

          <p className="text-center text-[11px] text-slate-400 mt-8">
            Access restricted to{" "}
            <span className="text-slate-500 font-medium">@1digitalstack.ai</span>
          </p>
        </div>
      </div>
    </div>
  );
}
