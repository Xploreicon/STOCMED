const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/chat': 'Chat search',
  '/history': 'Search history',
  '/reservations': 'My holds',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/search-results': 'Nearby pharmacies',
};

export function pageTitle(pathname: string) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const parent = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find(route => pathname.startsWith(`${route}/`));
  return parent ? PAGE_TITLES[parent] : 'StocMed';
}

export function navigationItemIsActive(pathname: string, href: string, routes: string[]) {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`)
    && !routes.some(route => route !== href && route.startsWith(`${href}/`) && pathname.startsWith(route));
}
