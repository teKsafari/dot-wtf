import { uploadStore } from '@/lib/applications-server';

// Application photos. The key is 16 random bytes, so a link is the permission;
// the reviewer's dashboard and the applicant's own page both read them here.
export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const image = await uploadStore.read(key);
  if (!image) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
