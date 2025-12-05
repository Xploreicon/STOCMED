import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileQuestion, Home, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function NotFound() {
  const { isAuthenticated, user } = useAuthStore();

  const getDashboardPath = () => {
    if (!isAuthenticated || !user) return '/';
    return user.role === 'patient' ? '/dashboard' : '/pharmacy/dashboard';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <FileQuestion className="h-16 w-16 text-blue-600" />
          </div>
          <CardTitle className="text-4xl font-bold text-gray-900">404</CardTitle>
          <CardDescription className="text-lg mt-2">
            Page Not Found
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            Sorry, we couldn't find the page you're looking for. It might have been moved or deleted.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button
              onClick={() => window.history.back()}
              variant="outline"
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Button>
            <Button asChild className="gap-2">
              <Link to={getDashboardPath()}>
                <Home className="h-4 w-4" />
                {isAuthenticated ? 'Go to Dashboard' : 'Go to Home'}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
