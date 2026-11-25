import { redirect } from "next/navigation";
import { getDefaultRouteForRole, requireSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await requireSession();
  if (session.schemaMissing) {
    redirect("/dashboard");
  }
  const role = session.profile?.role ?? "owner";
  redirect(getDefaultRouteForRole(role));
}
