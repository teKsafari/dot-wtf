import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { submissions, actionLogs } from '../lib/schema';
import { config } from 'dotenv';

// Load environment variables
config();

const OLD_DB_URL = process.env.DATABASE_URL!;
const NEW_DB_URL = process.env.NEW_DB!;

if (!OLD_DB_URL || !NEW_DB_URL) {
  console.error('❌ Missing DATABASE_URL or NEW_DB environment variables');
  process.exit(1);
}

// Helper to convert Date to ISO string for SQL
const toISOString = (date: Date | null): string | null => {
  return date ? date.toISOString() : null;
};

async function migrate() {
  console.log('🚀 Starting migration from old DB to new DB...\n');

  // Connect to both databases
  const oldClient = postgres(OLD_DB_URL, { max: 1 });
  const newClient = postgres(NEW_DB_URL, { max: 1 });

  const oldDb = drizzle(oldClient);

  try {
    // Step 1: Create tables in the new database
    console.log('📦 Creating tables in new database...');
    
    await newClient`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        categories TEXT NOT NULL,
        other_category TEXT,
        wtf_idea TEXT NOT NULL,
        current_project TEXT NOT NULL,
        youtube_link TEXT NOT NULL,
        interests TEXT,
        is_approved BOOLEAN,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  ✅ submissions table created');

    await newClient`
      CREATE TABLE IF NOT EXISTS action_logs (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER REFERENCES submissions(id),
        action TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  ✅ action_logs table created\n');

    // Step 2: Fetch all data from old database
    console.log('📥 Fetching data from old database...');
    
    const oldSubmissions = await oldDb.select().from(submissions);
    console.log(`  Found ${oldSubmissions.length} submissions`);

    const oldActionLogs = await oldDb.select().from(actionLogs);
    console.log(`  Found ${oldActionLogs.length} action logs\n`);

    // Step 3: Insert data into new database
    console.log('📤 Inserting data into new database...');

    // Migrate submissions (preserving IDs)
    if (oldSubmissions.length > 0) {
      // Clear existing data first (if any)
      await newClient`TRUNCATE TABLE action_logs CASCADE`;
      await newClient`TRUNCATE TABLE submissions CASCADE`;
      
      for (const sub of oldSubmissions) {
        const createdAt = toISOString(sub.createdAt);
        const updatedAt = toISOString(sub.updatedAt);
        
        await newClient`
          INSERT INTO submissions (id, name, email, categories, other_category, wtf_idea, current_project, youtube_link, interests, is_approved, created_at, updated_at)
          VALUES (
            ${sub.id}, 
            ${sub.name}, 
            ${sub.email}, 
            ${sub.categories}, 
            ${sub.otherCategory}, 
            ${sub.wtfIdea}, 
            ${sub.currentProject}, 
            ${sub.youtubeLink}, 
            ${sub.interests}, 
            ${sub.isApproved}, 
            ${createdAt}::timestamp, 
            ${updatedAt}::timestamp
          )
        `;
      }
      // Reset the sequence to continue from the max ID
      await newClient`SELECT setval('submissions_id_seq', (SELECT MAX(id) FROM submissions))`;
      console.log(`  ✅ Migrated ${oldSubmissions.length} submissions`);
    } else {
      console.log('  ⏭️  No submissions to migrate');
    }

    // Migrate action logs (preserving IDs)
    if (oldActionLogs.length > 0) {
      for (const log of oldActionLogs) {
        const createdAt = toISOString(log.createdAt);
        
        await newClient`
          INSERT INTO action_logs (id, submission_id, action, details, created_at)
          VALUES (
            ${log.id}, 
            ${log.submissionId}, 
            ${log.action}, 
            ${log.details}, 
            ${createdAt}::timestamp
          )
        `;
      }
      await newClient`SELECT setval('action_logs_id_seq', (SELECT MAX(id) FROM action_logs))`;
      console.log(`  ✅ Migrated ${oldActionLogs.length} action logs`);
    } else {
      console.log('  ⏭️  No action logs to migrate');
    }

    // Step 4: Verify migration
    console.log('\n🔍 Verifying migration...');
    
    const newSubmissionsCount = await newClient`SELECT COUNT(*) as count FROM submissions`;
    const newActionLogsCount = await newClient`SELECT COUNT(*) as count FROM action_logs`;

    console.log(`  submissions: ${oldSubmissions.length} → ${newSubmissionsCount[0].count}`);
    console.log(`  action_logs: ${oldActionLogs.length} → ${newActionLogsCount[0].count}`);

    const allMatch = 
      oldSubmissions.length === Number(newSubmissionsCount[0].count) &&
      oldActionLogs.length === Number(newActionLogsCount[0].count);

    if (allMatch) {
      console.log('\n✅ Migration completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('   1. Update your .env file: replace DATABASE_URL with NEW_DB value');
      console.log('   2. Test your application with the new database');
      console.log('   3. Once verified, you can remove the old DATABASE_URL');
    } else {
      console.log('\n⚠️  Migration completed but counts do not match. Please verify manually.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await oldClient.end();
    await newClient.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
