import './load-env';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// This script updates any submissions that have is_approved = false back to null (pending)
// Run this once after updating the schema to ensure data consistency

async function fixExistingSubmissions() {
  try {
    console.log('Checking for submissions with incorrect default status...');
    
    // Update any submissions that have is_approved = false back to null
    // This assumes that false was set as default, not deliberately rejected
    const result = await db
      .update(submissions)
      .set({ isApproved: null })
      .where(eq(submissions.isApproved, false))
      .returning();
    
    console.log(`Updated ${result.length} submissions from false to null (pending)`);
    
    if (result.length > 0) {
      console.log('Updated submissions:', result.map(s => ({ id: s.id, name: s.name, email: s.email })));
    }
    
  } catch (error) {
    console.error('Error updating submissions:', error);
  }
}

// Uncomment the line below and run this script if needed
// fixExistingSubmissions();
