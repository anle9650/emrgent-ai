"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import { AuthAlert } from "@/components/chat/auth-alert";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { readCallbackUrl } from "@/lib/auth-callback";
import { type RegisterActionState, register } from "../actions";

function invalidField(status: RegisterActionState["status"]) {
  if (status === "user_exists") {
    return "email" as const;
  }
  if (status === "invalid_data") {
    return "password" as const;
  }
}

function RegisterAlert({
  status,
  email,
}: {
  status: RegisterActionState["status"];
  email: string;
}) {
  if (status === "user_exists") {
    return (
      <AuthAlert
        action={{
          href: `/login?email=${encodeURIComponent(email)}`,
          label: "Sign in instead",
        }}
        label="Email in use"
      >
        An account already uses {email || "that email"}.
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

  if (status === "failed") {
    return (
      <AuthAlert label="Sign-up failed">
        The account couldn&apos;t be created. Try again in a moment.
      </AuthAlert>
    );
  }

  return null;
}

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
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
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="text-sm text-muted-foreground">Get started for free</p>
      <AuthForm
        action={handleSubmit}
        alert={<RegisterAlert email={email} status={state.status} />}
        defaultEmail={email}
        invalidField={invalidField(state.status)}
      >
        <SubmitButton isSuccessful={isSuccessful}>Sign up</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"Have an account? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
