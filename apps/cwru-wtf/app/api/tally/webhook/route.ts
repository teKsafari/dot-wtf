// New applications are authenticated profile submissions. Keep the old endpoint
// explicit so stale Tally deliveries cannot create a second application queue.
export async function POST() {
  return Response.json({
    error: 'Applications have moved to member profiles.',
    applicationUrl: '/profile',
  }, { status: 410 });
}
