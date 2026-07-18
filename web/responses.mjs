function responseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output || []).flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text || '')
    .join('');
}

function functionCalls(payload) {
  return (payload?.output || [])
    .filter((item) => item?.type === 'function_call' && item.name && item.call_id)
    .map((item) => ({
      callId: String(item.call_id),
      name: String(item.name),
      arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
    }));
}

async function readResponse(response, onDelta) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/event-stream')) {
    const payload = await response.json();
    const text = responseText(payload);
    if (text) onDelta(text);
    return { text, calls: functionCalls(payload), usage: payload.usage || null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let completed = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const data = block.split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      if (event.type === 'response.output_text.delta' && event.delta) {
        text += event.delta;
        onDelta(event.delta);
      } else if (event.type === 'response.completed') {
        completed = event.response || null;
      } else if (event.type === 'response.failed' || event.type === 'error') {
        throw new Error(event.error?.message || event.response?.error?.message || 'Sub2API 流式响应失败');
      }
    }
    if (done) break;
  }
  if (!text && completed) {
    text = responseText(completed);
    if (text) onDelta(text);
  }
  return { text, calls: functionCalls(completed), usage: completed?.usage || null };
}

export async function runResponses(options) {
  const transcript = [...options.input];
  let finalText = '';
  let usage = null;
  for (let round = 0; round < 4; round += 1) {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: options.model,
        reasoning: { effort: options.effort },
        input: transcript,
        tools: options.tools,
        tool_choice: 'auto',
        stream: true,
      }),
      signal: options.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sub2API 请求失败 (${response.status}): ${body.slice(0, 300)}`);
    }
    const result = await readResponse(response, (delta) => {
      finalText += delta;
      options.onDelta(delta);
    });
    usage = result.usage || usage;
    if (result.calls.length === 0) {
      if (!finalText.trim()) throw new Error('Sub2API 未返回文本');
      return { text: finalText, usage };
    }

    for (const call of result.calls) {
      transcript.push({
        type: 'function_call',
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      });
      const output = await options.executeTool(call);
      transcript.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: JSON.stringify(output.modelOutput),
      });
    }
  }
  throw new Error('服务器工具调用次数超过限制');
}
