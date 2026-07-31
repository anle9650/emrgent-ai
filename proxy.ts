import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if (!token) {
    // Keep the query string — /login carries ?email= over from a sign-up that
    // hit "email in use". The guest route re-checks that the target is relative.
    const url = new URL(request.url);
    const redirectUrl = encodeURIComponent(`${url.pathname}${url.search}`);

    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
