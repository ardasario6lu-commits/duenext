import { failure, HttpError, user } from '@/lib/server';
export async function POST(req: Request) {
  try {
    await user(req);
    throw new HttpError(
      'Reconnect Canvas using Connections. Browser token storage is no longer supported.',
      410,
    );
  } catch (e) {
    return failure(e);
  }
}
