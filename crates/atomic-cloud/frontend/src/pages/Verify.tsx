import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { verifyMagicLink, setToken } from "../api";

export default function Verify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("Invalid sign-in link.");
      return;
    }

    verifyMagicLink(token)
      .then((result) => {
        setToken(result.management_token);
        navigate("/dashboard");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Invalid or expired link");
      });
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="max-w-md mx-auto px-6 text-center">
        {error ? (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="font-display text-2xl tracking-tight mb-3">
              Link expired
            </h1>
            <p className="text-text-secondary mb-6">{error}</p>
            <a
              href="/signin"
              className="text-accent hover:text-accent-dark transition-colors text-sm font-medium"
            >
              Request a new link
            </a>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto mb-6 relative">
              <div className="absolute inset-0 rounded-full border-2 border-border-light" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
            </div>
            <h1 className="font-display text-2xl tracking-tight mb-3">
              Signing you in...
            </h1>
          </>
        )}
      </div>
    </div>
  );
}
