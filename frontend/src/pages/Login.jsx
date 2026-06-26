import { Building2, CalendarDays, Users2, LayoutDashboard } from "lucide-react";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

const FEATURES = [
  { icon: LayoutDashboard, label: "Team dashboard", desc: "See who's in, WFH, or away at a glance." },
  { icon: CalendarDays,    label: "Leave management", desc: "Request and approve leave in seconds."  },
  { icon: Users2,          label: "Catch-up tracking", desc: "Never miss a 1-on-1 with your team."   },
];

export default function Login() {
  return (
    <div
      className="min-h-screen flex"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {/* ── Left panel ── */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-12 overflow-hidden"
        style={{ background: "linear-gradient(145deg, #1d4ed8 0%, #2563eb 55%, #1e40af 100%)" }}>

        {/* Subtle dot grid */}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "28px 28px" }} />

        {/* Glow blobs */}
        <div className="absolute top-[-60px] right-[-60px] w-72 h-72 rounded-full bg-blue-400/30 blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-40px] left-[-40px] w-64 h-64 rounded-full bg-indigo-300/20 blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center border border-white/20">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">DigiSync</span>
        </div>

        {/* Headline + features */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-3">
            People operations,<br />simplified.
          </h1>
          <p className="text-blue-200 text-sm mb-10 leading-relaxed">
            One place to manage your team's presence,<br />leave, and check-ins.
          </p>

          <div className="space-y-5">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-blue-100" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-blue-300 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom badge */}
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-300 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Restricted to @1digitalstack.ai accounts
          </span>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-200">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-base tracking-tight">DigiSync</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-1">Welcome back</h2>
          <p className="text-sm text-slate-400 mb-8">Sign in to access your workspace.</p>

          <a
            href="http://localhost:8000/auth/login"
            className="flex items-center justify-center gap-3 w-full px-5 py-3.5 rounded-2xl bg-white border-2 border-slate-200 text-slate-700 text-sm font-semibold hover:border-blue-400 hover:shadow-md hover:shadow-blue-100 transition-all duration-200 shadow-sm"
          >
            <GoogleIcon />
            Continue with Google
          </a>

          <p className="text-center text-[11px] text-slate-300 mt-8 leading-relaxed">
            Access is restricted to{" "}
            <span className="text-slate-400 font-semibold">@1digitalstack.ai</span> accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
