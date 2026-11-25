import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { UserRole } from "@/types/database";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/lupa-password",
  "/reset-password",
  "/offline",
  "/auth/callback",
];

const OWNER_ONLY_PREFIXES = [
  "/dashboard",
  "/laporan",
  "/pengaturan-bisnis",
  "/menu",
  "/pengeluaran",
  "/modal-usaha",
];

function defaultRouteFor(role: UserRole): string {
  if (role === "cashier") return "/pos";
  if (role === "kitchen") return "/stok";
  return "/dashboard";
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!user) {
    if (isPublic) return response;
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Autentikasi diperlukan" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // API routes handle their own fine-grained RBAC checks server-side
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/callback")) {
    return response;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    const code = (profileError as { code?: string }).code ?? "";
    if (code === "PGRST205" || code === "42P01") {
      // Allow /dashboard to render the friendly SQL setup guide
      if (pathname === "/dashboard") return response;
      const dashUrl = request.nextUrl.clone();
      dashUrl.pathname = "/dashboard";
      return NextResponse.redirect(dashUrl);
    }
  }

  const role = (profile?.role as UserRole | undefined) ?? "owner";

  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("error", "akun_nonaktif");
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/" || pathname === "/login" || pathname === "/register") {
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = defaultRouteFor(role);
    targetUrl.search = "";
    return NextResponse.redirect(targetUrl);
  }

  const isOwnerOnly = OWNER_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (isOwnerOnly && role !== "owner") {
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = defaultRouteFor(role);
    targetUrl.searchParams.set("denied", "1");
    return NextResponse.redirect(targetUrl);
  }

  if ((pathname === "/pos" || pathname.startsWith("/pos/")) && role === "kitchen") {
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = "/stok";
    return NextResponse.redirect(targetUrl);
  }

  if ((pathname === "/stok" || pathname.startsWith("/stok/")) && role === "cashier") {
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = "/pos";
    return NextResponse.redirect(targetUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.svg|manifest\\.json|sw\\.js|swe-worker-.*|icons/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
