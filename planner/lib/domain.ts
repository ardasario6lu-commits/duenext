export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError('Enter valid details.');
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new HttpError('Invalid item identifier.');
  return value;
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
  );
}
export function field(
  raw: Record<string, unknown>,
  name: string,
  max: number,
): string {
  const value = raw[name] ?? '';
  if (typeof value !== 'string' || value.length > max)
    throw new HttpError(`Check ${name}.`);
  return value.trim();
}
export function safeUrl(value: unknown): string {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2000)
    throw new HttpError('Invalid source link.');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new HttpError('Invalid source link.');
  }
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new HttpError('Reload this item before editing it.', 409);
  return Number(value);
}
export async function readBody(
  req: Request,
  max = 32768,
): Promise<Record<string, unknown>> {
  if (
    req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new HttpError('Send JSON details.', 415);
  if (Number(req.headers.get('content-length') || 0) > max)
    throw new HttpError('Request is too large.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError('Enter details.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) {
        await reader.cancel();
        throw new HttpError('Request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError('Enter valid JSON details.');
  }
}
export function schoolDayKey(date = new Date(), zone = 'America/Detroit') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
