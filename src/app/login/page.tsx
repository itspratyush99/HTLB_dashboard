import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in · Candidate Tracker" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
