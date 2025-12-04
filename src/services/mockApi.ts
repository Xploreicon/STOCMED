import type { LoginRequest, RegisterRequest, AuthResponse } from '../types/auth';

// In-memory storage for registered users
const registeredUsers = new Map<string, {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  role: 'patient' | 'pharmacy';
  location: string;
  pharmacy_name?: string;
  license_number?: string;
  address?: string;
  city?: string;
  state?: string;
}>();

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock JWT token generator
const generateMockToken = (userId: string, role: string): string => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub: userId,
    role,
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours from now
  }));
  const signature = btoa('mock-signature');
  return `${header}.${payload}.${signature}`;
};

export const mockLogin = async (credentials: LoginRequest): Promise<AuthResponse> => {
  await delay(500);

  // Check if user exists in registered users
  const user = registeredUsers.get(credentials.email);

  if (user && user.password === credentials.password) {
    // Return registered user data
    const response: AuthResponse = {
      user: {
        id: btoa(credentials.email), // Use base64 encoded email as ID
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        location: user.location,
      },
      token: generateMockToken(btoa(credentials.email), user.role),
    };

    if (user.role === 'pharmacy') {
      response.pharmacy = {
        id: btoa(credentials.email),
        pharmacy_name: user.pharmacy_name || '',
        license_number: user.license_number || '',
        address: user.address || '',
        city: user.city || '',
        state: user.state || '',
        phone: user.phone,
      };
    }

    return response;
  }

  // Accept any email/password combination for demo purposes
  const role = credentials.email.includes('pharmacy') ? 'pharmacy' : 'patient';

  const response: AuthResponse = {
    user: {
      id: btoa(credentials.email), // Use base64 encoded email as ID
      email: credentials.email,
      full_name: 'Demo User',
      phone: '+2341234567890',
      role,
      location: 'Lagos',
    },
    token: generateMockToken(btoa(credentials.email), role),
  };

  if (role === 'pharmacy') {
    response.pharmacy = {
      id: btoa(credentials.email),
      pharmacy_name: 'Demo Pharmacy',
      license_number: 'PCN-123456',
      address: '123 Main Street',
      city: 'Lagos',
      state: 'Lagos',
      phone: '+2341234567890',
    };
  }

  return response;
};

export const mockRegister = async (data: RegisterRequest): Promise<AuthResponse> => {
  await delay(500);

  // Check if user already exists
  if (registeredUsers.has(data.email)) {
    throw new Error('User with this email already exists');
  }

  // Store user in memory
  registeredUsers.set(data.email, {
    email: data.email,
    password: data.password,
    full_name: data.full_name,
    phone: data.phone,
    role: data.role,
    location: data.location,
    pharmacy_name: data.pharmacy_name,
    license_number: data.license_number,
    address: data.address,
    city: data.city,
    state: data.state,
  });

  const userId = btoa(data.email);

  const response: AuthResponse = {
    user: {
      id: userId,
      email: data.email,
      full_name: data.full_name,
      phone: data.phone,
      role: data.role,
      location: data.location,
    },
    token: generateMockToken(userId, data.role),
  };

  if (data.role === 'pharmacy') {
    response.pharmacy = {
      id: userId,
      pharmacy_name: data.pharmacy_name || '',
      license_number: data.license_number || '',
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      phone: data.phone,
    };
  }

  return response;
};
