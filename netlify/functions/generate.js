// netlify/functions/generate.js
// Netlify Functions v2 — streams the Anthropic response directly to the browser.
// This solves the 10-second timeout on the free tier: data starts flowing immediately
// so the connection never sits idle long enough to time out.

export default async (req) => {

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check API key is present
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured on server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse the incoming request body
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Call Anthropic with stream: true added — this makes Anthropic send
  // Server-Sent Events (SSE) instead of one big response blob
  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  // If Anthropic itself returned an error, pass it back
  if (!anthropicResponse.ok) {
    const errorText = await anthropicResponse.text();
    return new Response(errorText, {
      status: anthropicResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pipe the Anthropic SSE stream straight back to the browser.
  // The function returns immediately with an open stream — no waiting,
  // no timeout, data flows through as Claude generates it.
  return new Response(anthropicResponse.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no', // tells Netlify's edge not to buffer this
    },
  });
};

// Tell Netlify to route /api/generate to this function
export const config = {
  path: '/api/generate',
};
