// netlify/functions/generate.js
// Uses the classic exports.handler format (most compatible with Netlify free tier)
// but reads Anthropic's SSE stream internally — solving the timeout.
// Returns the assembled text as JSON once streaming is complete.

exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured on server' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid request body' })
    };
  }

  // Call Anthropic with stream: true — keeps the upstream connection alive
  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!anthropicResponse.ok) {
    const errorText = await anthropicResponse.text();
    return {
      statusCode: anthropicResponse.status,
      body: errorText
    };
  }

  // Read the SSE stream and accumulate all text deltas.
  // The function stays active throughout — no idle timeout.
  const reader = anthropicResponse.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let lineBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const eventData = line.slice(6).trim();
      if (eventData === '[DONE]') continue;

      try {
        const chunk = JSON.parse(eventData);
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta && chunk.delta.type === 'text_delta'
        ) {
          fullText += chunk.delta.text;
        }
      } catch (e) {
        // Partial chunk at boundary — normal, ignore
      }
    }
  }

  // Return the assembled text in the same shape as the old non-streaming response.
  // The index.html fetch code doesn't need to change — it still calls response.json()
  // and reads result.content[0].text exactly as before.
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: [{ type: 'text', text: fullText }]
    })
  };
};
