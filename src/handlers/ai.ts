// ========================================
// AI 模型 API 代理处理器
// 支持 ChatGPT (OpenAI), Claude (Anthropic), Gemini (Google)
// ========================================

import type { ProxyContext } from '../types';
import { errorResponse } from '../utils/helpers';

export async function aiHandler(context: ProxyContext): Promise<Response> {
  const { request, route, url, env } = context;

  if (!route) {
    return errorResponse('No route matched', 404);
  }

  try {
    // 构建目标 URL
    let targetUrl: URL;

    if (route.target) {
      const path = url.pathname.replace(route.pattern as string, '/');
      targetUrl = new URL(route.target);
      targetUrl.pathname = path;
      targetUrl.search = url.search;
    } else {
      return errorResponse('Target URL not configured', 500);
    }

    // 处理请求头
    const headers = new Headers(request.headers);

    // 移除 Cloudflare 头
    headers.delete('cf-ray');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');

    // 移除 Host 头，让 fetch 自动设置
    headers.delete('host');

    // 头重写（按 AI 提供商特定处理）
    if (route.rewrite?.headers) {
      route.rewrite.headers(headers);
    }

    // SSE 流式响应检测
    const accept = headers.get('Accept') || '';
    const isStreaming = accept.includes('text/event-stream') || url.searchParams.get('stream') === 'true';

    // 准备请求
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    // 非 GET 请求携带 body
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
      // @ts-ignore
      fetchOptions.duplex = 'half';
    }

    // 发起请求
    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // 处理响应头
    const responseHeaders = new Headers(upstreamResponse.headers);

    // 移除不需要的头
    const hopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'trailers',
      'transfer-encoding',
      'upgrade',
      'content-length',
    ];

    for (const header of hopHeaders) {
      responseHeaders.delete(header);
    }

    // 流式响应处理（SSE）
    if (isStreaming || responseHeaders.get('Content-Type')?.includes('text/event-stream')) {
      return handleSSEStream(upstreamResponse, responseHeaders);
    }

    // Cloudflare 自动处理大文件流式传输

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('AI proxy error:', error);
    return errorResponse(
      'AI API proxy request failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * SSE 流式响应处理
 * 用于 ChatGPT / Claude 等对话流式响应
 */
function handleSSEStream(upstreamResponse: Response, responseHeaders: Headers): Response {
  // 确保正确的 Content-Type
  responseHeaders.set('Content-Type', 'text/event-stream');
  responseHeaders.set('Cache-Control', 'no-cache');
  responseHeaders.set('Connection', 'keep-alive');
  responseHeaders.set('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲

  // 创建 TransformStream 处理 SSE 消息
  const transformStream = new TransformStream<string, string>({
    start(controller) {
      // 发送一个初始注释来建立连接
      controller.enqueue(': ping\n\n');
    },
    transform(chunk, controller) {
      // 直接透传 SSE 消息
      controller.enqueue(chunk);
    },
    flush(controller) {
      // 传输完成
      controller.terminate();
    },
  });

  // @ts-ignore - pipeThrough 类型问题
  const body = upstreamResponse.body?.pipeThrough(new TextDecoderStream())
    .pipeThrough(transformStream)
    .pipeThrough(new TextEncoderStream());

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

/**
 * OpenAI 特定处理
 */
export function handleOpenAIRequest(context: ProxyContext): ProxyContext {
  const { headers, url } = context;

  // 确保正确的 Content-Type
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // OpenAI 特定头
  headers.set('OpenAI-Organization', headers.get('OpenAI-Organization') || '');

  return context;
}

/**
 * Anthropic (Claude) 特定处理
 */
export function handleAnthropicRequest(context: ProxyContext): ProxyContext {
  const { headers } = context;

  // Anthropic 需要特定头
  headers.set('anthropic-version', headers.get('anthropic-version') || '2023-06-01');

  // Claude Beta 特性
  const beta = headers.get('anthropic-beta');
  if (!beta) {
    // 默认启用消息 API Beta
    headers.set('anthropic-beta', 'messages-2023-12-15');
  }

  return context;
}

/**
 * Gemini (Google) 特定处理
 */
export function handleGeminiRequest(context: ProxyContext): ProxyContext {
  const { headers, url } = context;

  // 确保 Google API 键正确传递
  const key = url.searchParams.get('key');
  if (key) {
    // 已经在 URL 中，不需要处理
  }

  // Gemini 需要特定头
  headers.set('x-goog-api-client', headers.get('x-goog-api-client') || 'genai-js/0.1.0');

  return context;
}

/**
 * AI API 请求限流
 */
export async function checkAIRateLimit(
  context: ProxyContext,
  limit: number = 100, // 每分钟 100 请求
  windowMs: number = 60000
): Promise<boolean> {
  const { clientIP, route } = context;

  // 简单内存限流
  const key = `ai:${route?.id}:${clientIP}`;
  const store = (globalThis as any).__aiRateLimit || new Map();
  (globalThis as any).__aiRateLimit = store;

  const now = Date.now();
  const record = store.get(key);

  if (!record || now - record.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return true;
  }

  record.count++;
  return record.count <= limit;
}
