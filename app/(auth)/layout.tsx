export const dynamic = 'force-dynamic'

export default function AuthRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth pages handle their own layout (AuthLayout component)
  // This is just a wrapper for the route group
  return <>{children}</>;
}
