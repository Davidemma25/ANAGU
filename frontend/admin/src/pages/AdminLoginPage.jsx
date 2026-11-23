import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';
import { extractErrorMessage } from '../services/adminApi.js';
import { isAdminRole } from '../adminConfig';

export default function AdminLoginPage() {
  const { user, getAdminStatus, adminSetup, adminLogin } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;
  const redirectTarget =
    from && from.pathname?.startsWith('/admin')
      ? `${from.pathname}${from.search || ''}`
      : '/admin';

  const [checkingStatus, setCheckingStatus] = useState(true);
  const [adminConfigured, setAdminConfigured] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const status = await getAdminStatus();
        if (active) {
          setAdminConfigured(Boolean(status?.adminConfigured));
        }
      } catch {
        if (active) {
          setAdminConfigured(true);
        }
      } finally {
        if (active) {
          setCheckingStatus(false);
        }
      }
    }
    loadStatus();
    return () => {
      active = false;
    };
  }, [getAdminStatus]);

  if (user && isAdminRole(user.roleCode)) {
    return <Navigate to="/admin" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!adminConfigured) {
      if (password.length < 8) {
        setError('Administrator password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    const cleanEmail = email.trim();
    setSubmitting(true);
    try {
      if (!adminConfigured) {
        const result = await adminSetup({
          email: cleanEmail,
          password,
          ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
        });
        if (result.confirmationRequired) {
          setAdminConfigured(true);
          setMessage(result.message);
          return;
        }
      } else {
        await adminLogin(cleanEmail, password);
      }
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(
        extractErrorMessage(
          err,
          !adminConfigured
            ? 'Administrator activation failed. Verify the designated email address.'
            : 'Administrator sign in failed. Check your credentials.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col justify-between">
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <section className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-5 shadow-xs">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#1F2421] text-[#FDE878] font-mono text-[11px] uppercase tracking-wider">
              {adminConfigured ? (
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {adminConfigured ? 'Single-Administrator Portal' : 'One-Time Admin Activation'}
              </span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold text-[#1F2421]">
              {adminConfigured ? 'Sign in to Admin Console' : 'Activate Designated Administrator'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              {adminConfigured
                ? 'Restricted to the single designated administrator email configured for ANAGU.'
                : 'Enter the designated administrator email address and choose a strong password to activate the Admin Console.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          )}
          {message && (
            <div
              role="status"
              className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800"
            >
              {message}
            </div>
          )}

          {checkingStatus ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Checking administrator portal status...
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!adminConfigured && (
                <div>
                  <label htmlFor="admin-setup-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Administrator Name (Optional)
                  </label>
                  <input
                    id="admin-setup-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter administrator display name"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421] focus:border-transparent"
                  />
                </div>
              )}

              <div>
                <label htmlFor="admin-login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Designated Administrator Email
                </label>
                <input
                  id="admin-login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter designated administrator email"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421] focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="admin-login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                  {adminConfigured ? 'Administrator Password' : 'Create Password (minimum 8 characters)'}
                </label>
                <div className="relative">
                  <input
                    id="admin-login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={adminConfigured ? 1 : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={adminConfigured ? 'Enter administrator password' : 'Create strong password'}
                    className="w-full px-3.5 py-2.5 pr-10 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421] focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide administrator password' : 'Show administrator password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-500 hover:text-[#1F2421]"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {!adminConfigured && (
                <div>
                  <label
                    htmlFor="admin-confirm-password"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    Confirm Administrator Password
                  </label>
                  <input
                    id="admin-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1F2421] focus:border-transparent"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 text-sm font-semibold text-[#FDE878] bg-[#1F2421] hover:bg-black disabled:opacity-60 rounded-md transition-colors"
              >
                {submitting
                  ? adminConfigured
                    ? 'Verifying Credentials...'
                    : 'Activating Administrator...'
                  : adminConfigured
                  ? 'Sign In to Admin Console'
                  : 'Activate & Enter Admin Console'}
              </button>
            </form>
          )}

          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-600">
              Public landowner or buyer?{' '}
              <a href="/" className="font-semibold text-[#1F2421] underline underline-offset-2">
                Return to Public Land Portal
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
        ANAGU Single-Administrator Console — Separate Admin Frontend &amp; Backend.
      </footer>
    </div>
  );
}
