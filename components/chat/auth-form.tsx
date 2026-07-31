import Form from "next/form";

import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function AuthForm({
  action,
  children,
  defaultEmail = "",
  alert,
  invalidField,
}: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  defaultEmail?: string;
  /** Rendered directly above the submit control, adjacent to the action that failed. */
  alert?: React.ReactNode;
  /** Flags the field the failure points at, so the eye lands on what to change. */
  invalidField?: "email" | "password";
}) {
  return (
    <Form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="email">
          Email
        </Label>
        <Input
          aria-invalid={invalidField === "email"}
          autoComplete="email"
          autoFocus
          className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted aria-invalid:border-negative/50 aria-invalid:bg-negative/5"
          defaultValue={defaultEmail}
          id="email"
          name="email"
          placeholder="you@someo.ne"
          required
          type="email"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="password">
          Password
        </Label>
        <Input
          aria-invalid={invalidField === "password"}
          className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted aria-invalid:border-negative/50 aria-invalid:bg-negative/5"
          id="password"
          name="password"
          placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
          required
          type="password"
        />
      </div>

      {alert}

      {children}
    </Form>
  );
}
