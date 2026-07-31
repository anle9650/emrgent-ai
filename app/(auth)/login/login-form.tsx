"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import { AuthAlert } from "@/components/chat/auth-alert";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { readCallbackUrl } from "@/lib/auth-callback";
import { type LoginActionState, login } from "../actions";

function LoginAlert({ status }: { status: LoginActionState["status"] }) {
  if (status === "failed") {
    return (
      <AuthAlert
        action={{ href: "/register", label: "Create an account" }}
        label="No match"
      >
        That email and password don&apos;t match an account.
      </AuthAlert>
    );
  }

  if (status === "invalid_data") {
    return (
      <AuthAlert label="Check your details">
        Enter a valid email address and a password of at least 6 characters.
      </AuthAlert>
    );
  }

  return null;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" }
  );

  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (state.status === "success") {
      setIsSuccessful(true);
      updateSession();
      router.refresh();
      router.push(readCallbackUrl());
    }
  }, [state.status]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to your account to continue
      </p>
      <AuthForm
        action={handleSubmit}
        alert={<LoginAlert status={state.status} />}
        defaultEmail={email}
        invalidField={
          state.status === "failed" || state.status === "invalid_data"
            ? "email"
            : undefined
        }
      >
        <SubmitButton isSuccessful={isSuccessful}>Sign in</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"No account? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/register"
          >
            Sign up
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
