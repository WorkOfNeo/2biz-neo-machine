import { NextResponse } from "next/server";

const LOGIN_URL = "https://2-biz.spysystem.dk/?controller=Index&action=SignIn";

export async function POST() {
  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "Missing SPY_USER or SPY_PASS" }, { status: 500 });
  }

  try {
    const form = new URLSearchParams();
    form.set("username", username);
    form.set("password", password);

    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Referer": "https://2-biz.spysystem.dk/?controller=Index&action=GetLoginPage",
      },
      body: form.toString(),
      redirect: "manual",
    });

    const setCookie = res.headers.get("set-cookie");
    const location = res.headers.get("location");

    // Consider login successful if we received a session cookie or redirect away from login
    const success = Boolean(setCookie) || (location && !location.includes("GetLoginPage"));

    if (!success) {
      const text = await res.text();
      return NextResponse.json({ ok: false, status: res.status, error: "Login failed", snippet: text.slice(0, 400) }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}


