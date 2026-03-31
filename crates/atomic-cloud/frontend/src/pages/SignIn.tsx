import { useState } from "react";
import { sendMagicLink } from "../api";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-bg-primary/80 backdrop-blur-md border-b border-border-light">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="font-display text-xl tracking-tight">
            atomic
          </a>
        </div>
      </nav>

      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-sm w-full mx-auto px-6">
          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-subtle flex items-center justify-center">
                <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <h1 className="font-display text-2xl tracking-tight mb-3">
                Check your email
              </h1>
              <p className="text-text-secondary text-sm leading-relaxed">
                We sent a sign-in link to <span className="font-medium text-text-primary">{email}</span>.
                It expires in 15 minutes.
              </p>
            </div>
          ) : (
            <>
              <h1 className="font-display text-3xl tracking-tight text-center mb-8">
                Sign in
              </h1>
              <form onSubmit={handleSubmit}>
                <div className="bg-bg-white rounded-xl border border-border-light p-6 space-y-4 shadow-sm">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg-primary text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-500">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={!email || loading}
                    className="w-full inline-flex items-center justify-center gap-2 px-7 py-3 text-base font-medium text-white bg-accent hover:bg-accent-dark rounded-xl transition-all hover:shadow-lg hover:shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                  >
                    {loading ? "Sending..." : "Send sign-in link"}
                  </button>
                </div>
              </form>

              <p className="text-center text-sm text-text-muted mt-6">
                Don't have an account?{" "}
                <a href="/" className="text-accent hover:text-accent-dark transition-colors font-medium">
                  Get started
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
