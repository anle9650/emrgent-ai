import { isOpenEmrConfigured } from "../auth";
import { LoginForm } from "./login-form";

export default function Page() {
  return <LoginForm showOpenEmrSignIn={isOpenEmrConfigured} />;
}
