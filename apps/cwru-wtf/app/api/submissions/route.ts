import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAction } from '@/lib/action-logger';

const submissionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').endsWith('@case.edu', 'Must be a @case.edu email'),
  categories: z.array(z.string()).min(1, 'Please select at least one category'),
  otherCategory: z.string().optional(),
  wtfIdea: z.string().min(1, 'Please tell us your WTF idea').max(600, 'Maximum 100 words (approximately 600 characters)'),
  currentProject: z.string().min(1, 'Please tell us about your current project').max(600, 'Maximum 100 words (approximately 600 characters)'),
  youtubeLink: z.string().url('Please enter a valid URL'),
  whatsapp: z.string().min(1, 'WhatsApp number is required').refine((val) => {
    const digits = val.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  }, 'Invalid WhatsApp number'),
}).refine((data) => {
  // If "Other" is selected, otherCategory should be provided
  if (data.categories.includes('Other') && (!data.otherCategory || data.otherCategory.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: 'Please specify the other category',
  path: ['otherCategory'],
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate the request body
    const validatedData = submissionSchema.parse(body);
    
    // Check if email already exists
    const existingSubmission = await db
      .select()
      .from(submissions)
      .where(eq(submissions.email, validatedData.email))
      .limit(1);
    
    if (existingSubmission.length > 0) {
      return NextResponse.json(
        { error: 'Email already submitted' },
        { status: 400 }
      );
    }
    
    // Insert the new submission
    const [newSubmission] = await db
      .insert(submissions)
      .values({
        name: validatedData.name,
        email: validatedData.email,
        categories: JSON.stringify(validatedData.categories),
        otherCategory: validatedData.otherCategory || null,
        wtfIdea: validatedData.wtfIdea,
        currentProject: validatedData.currentProject,
        youtubeLink: validatedData.youtubeLink,
        whatsapp: validatedData.whatsapp,
        interests: null, // Keep for backward compatibility
      })
      .returning();
    
    // Log the submission
    await logAction(newSubmission.id, 'submitted', `New submission from ${validatedData.email}`);
    
    return NextResponse.json(
      { 
        message: 'Application submitted successfully!',
        id: newSubmission.id 
      },
      { status: 201 }
    );
    
  } catch (error) {
    console.error('Submission error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Validation failed',
          details: error.errors 
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
