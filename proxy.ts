import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions, SessionData } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // 1. Ochiq yo'nalishlar (Public paths)
  const isPublicPath = 
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/admin/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/fonts/') ||
    pathname === '/favicon.ico' ||
    pathname === '/header_logo.png';

  console.log('--- PROXY REQUEST ---', { pathname, isPublicPath });

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  // /index.html ni / ga rewrite qilish
  if (pathname === '/index.html') {
    const url = new URL('/', request.url);
    url.search = request.nextUrl.search;
    return NextResponse.rewrite(url);
  }

  // 2. Agar foydalanvuchi tizimga kirmagan bo'lsa va yo'nalish ochiq bo'lmasa -> Loginga
  if (!session.isLoggedIn && !isPublicPath) {
    const loginUrl = new URL('/admin/login', request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      loginUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(loginUrl);
  }

  // 3. Agar foylalanvuchi tizimga kirgan bo'lsa va login sahifasiga bormoqchi bo'lsa -> Panelga
  if (session.isLoggedIn && pathname === '/admin/login') {
    const adminUrl = new URL('/admin', request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      adminUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(adminUrl);
  }

  // 4. Aktivlikni yangilash (Idle timeout)
  if (session.isLoggedIn) {
    await session.save();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/:path*'],
};
