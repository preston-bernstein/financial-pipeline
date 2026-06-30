export async function sendNtfyAlert(
  message: string,
  opts: { priority?: 'default' | 'high' | 'urgent'; title?: string } = {},
): Promise<void> {
  const url = process.env.NTFY_URL;
  const topic = process.env.NTFY_TOPIC;
  if (!url || !topic) return;

  await fetch(`${url}/${topic}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      ...(opts.priority ? { 'X-Priority': opts.priority } : {}),
      ...(opts.title ? { 'X-Title': opts.title } : {}),
    },
    body: message,
  }).catch(() => { /* best-effort */ });
}
