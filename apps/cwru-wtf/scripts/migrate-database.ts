import './load-env';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function migrateDatabaseSchema() {
  console.log('Starting database migration...');
  
  try {
    // Make interests column nullable
    await db.execute(sql`ALTER TABLE submissions ALTER COLUMN interests DROP NOT NULL`);
    console.log('✓ Made interests column nullable');

    // Add new columns with temporary defaults
    await db.execute(sql`ALTER TABLE submissions ADD COLUMN categories text NOT NULL DEFAULT '[]'`);
    console.log('✓ Added categories column');
    
    await db.execute(sql`ALTER TABLE submissions ADD COLUMN other_category text`);
    console.log('✓ Added other_category column');
    
    await db.execute(sql`ALTER TABLE submissions ADD COLUMN wtf_idea text NOT NULL DEFAULT ''`);
    console.log('✓ Added wtf_idea column');
    
    await db.execute(sql`ALTER TABLE submissions ADD COLUMN current_project text NOT NULL DEFAULT ''`);
    console.log('✓ Added current_project column');
    
    await db.execute(sql`ALTER TABLE submissions ADD COLUMN youtube_link text NOT NULL DEFAULT ''`);
    console.log('✓ Added youtube_link column');

    // Remove temporary defaults
    await db.execute(sql`ALTER TABLE submissions ALTER COLUMN categories DROP DEFAULT`);
    await db.execute(sql`ALTER TABLE submissions ALTER COLUMN wtf_idea DROP DEFAULT`);
    await db.execute(sql`ALTER TABLE submissions ALTER COLUMN current_project DROP DEFAULT`);
    await db.execute(sql`ALTER TABLE submissions ALTER COLUMN youtube_link DROP DEFAULT`);
    console.log('✓ Removed temporary defaults');

    console.log('🎉 Database migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the migration
migrateDatabaseSchema()
  .then(() => {
    console.log('Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
