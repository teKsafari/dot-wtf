import Link from 'next/link';
import { ArrowLeft, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { env } from '@/env';

async function getTestData() {
  try {
    const response = await fetch(`${env.LOGTO_BASE_URL}/api/test`, {
      cache: 'no-store'
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch test data');
    }
    
    return await response.json();
  } catch (error) {
    return {
      status: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export default async function TestPage() {
  const testData = await getTestData();
  
  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center text-green-400 hover:text-green-300 mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Link>
          
          <h1 className="font-mono text-4xl font-bold mb-2">
            <span className="text-green-400">cwru</span>
            <span className="text-pink-500">.wtf</span> System Test
          </h1>
          <p className="text-gray-400">Database and API connectivity test</p>
        </div>

        <div className="grid gap-6">
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Database className="mr-2 h-5 w-5" />
                Database Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Connection Status:</span>
                  <span className={testData.status === 'OK' ? 'text-green-400' : 'text-red-400'}>
                    {testData.status}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Message:</span>
                  <span className="text-white">{testData.message}</span>
                </div>
                
                {testData.schemaTest && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Submissions Table:</span>
                      <span className="text-green-400">{testData.schemaTest.submissionsTable}</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Sample Data Count:</span>
                      <span className="text-white">{testData.schemaTest.sampleData}</span>
                    </div>
                  </>
                )}
                
                {testData.error && (
                  <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded">
                    <p className="text-red-300 text-sm">{testData.error}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button asChild className="border-green-500 bg-green-500 text-black hover:border-green-400 hover:bg-green-400">
                  <Link href="/">Test Submission Form</Link>
                </Button>
                <Button asChild variant="outline" className="bg-transparent border-pink-500 text-pink-500 hover:border-pink-400 hover:bg-pink-500/10">
                  <Link href="/login">Admin Login</Link>
                </Button>
                <Button asChild variant="outline" className="bg-transparent border-green-500 text-green-500 hover:border-green-400 hover:bg-green-500/10">
                  <Link href="/admin">Admin Dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle>Authentication System</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status:</span>
                  <span className="text-green-400">Active</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Admin Protection:</span>
                  <span className="text-green-400">Enabled</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Login Page:</span>
                  <span>/login</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Admin Dashboard:</span>
                  <span>/admin (protected)</span>
                </div>
                <div className="p-3 bg-blue-900/50 border border-blue-700 rounded mt-4">
                  <p className="text-blue-300 text-xs">
                    💡 Admin users are created via the create-admin script. 
                    Access to /admin requires authentication.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Environment:</span>
                  <span>{env.NODE_ENV}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Database:</span>
                  <span>PostgreSQL (Supabase)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ORM:</span>
                  <span>Drizzle</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Default Status:</span>
                  <span className="text-yellow-500">Pending (null)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Authentication:</span>
                  <span className="text-green-500">NextAuth.js</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Session Strategy:</span>
                  <span>JWT</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
