import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function Page() {
  // LoginForm reads `?email=` — carried over from a sign-up that hit "email in
  // use" — so the Suspense boundary is required to client-render that subtree.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
