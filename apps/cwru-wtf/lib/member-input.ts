import 'server-only';

import { MemberError } from './members';

export async function readMemberInput(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new MemberError(400, 'Send member changes as JSON.');
  }
  const maximumBytes = 8_192;
  const reader = request.body?.getReader();
  if (!reader) throw new MemberError(400, 'The member request contains invalid JSON.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new MemberError(400, 'The member request is too large.');
      }
      chunks.push(value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch (error) {
    if (error instanceof MemberError) throw error;
    throw new MemberError(400, 'The member request contains invalid JSON.');
  } finally {
    reader.releaseLock();
  }
}
