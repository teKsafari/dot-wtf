import './load-env';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { adminUsers } from '@/lib/schema';
import { eq } from 'drizzle-orm';

async function createAdminUser() {
  const email = '';
  const password = ''; // Change this to a secure password
  const name = '';

  try {
    // Check if admin already exists
    const [existingAdmin] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (existingAdmin) {
      console.log('Admin user already exists:', email);
      return;
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create the admin user
    const [newAdmin] = await db
      .insert(adminUsers)
      .values({
        email,
        passwordHash,
        name,
        role: 'super_admin',
        isActive: true,
      })
      .returning();

    console.log('Admin user created successfully:');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('IMPORTANT: Change the password after first login!');
    console.log('Admin ID:', newAdmin.id);

  } catch (error) {
    console.error('Error creating admin user:', error);
  }
}

// Uncomment the line below to create the admin user
createAdminUser();

export default createAdminUser;
