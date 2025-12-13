import type { MetadataRoute } from 'next';

const BASE_URL = 'https://askstocmed.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    '',
    '/login',
    '/signup',
    '/chat',
  ];

  const lastModified = new Date();

  return routes.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency: 'daily',
    priority: path === '' ? 1 : 0.7,
  }));
}
