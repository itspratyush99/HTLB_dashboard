import { redirect } from "next/navigation";

/** The home page is the Dashboard. (Logged-out visitors are sent to /login by the middleware.) */
export default function Home() {
  redirect("/dashboard");
}
