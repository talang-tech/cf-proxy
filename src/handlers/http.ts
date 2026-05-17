// ========================================
// HTTP 代理处理器
// ========================================

import type { ProxyContext } from '../types';
import { createStreamResponse } from '../utils/stream';
import { errorResponse } from '../utils/helpers';

export async function httpHandler(context: ProxyContext): Promise<Response> {
  const { request, route, url, env } = context;

  if (!route) {
    return errorResponse('No route matched', 404);
  }

  try {
    // 构建目标 URL
    let targetUrl: URL;

    if (route.target) {
      targetUrl = new URL(url.pathname.replace(route.pattern as string, '/'));
      targetUrl.host = new URL(route.target).host;
      targetUrl.protocol = new URL(route.target).protocol;
      targetUrl.search = url.search;
    } else {
      // 动态目标（如 /http/https://example.com）
      const path = url.pathname + url.search;
      const match = path.match(/^\/http\/(https?:\/\/.+)/);
      if (!match) {
        return errorResponse('Invalid proxy URL format', 400);
      }
      targetUrl = new URL(match[1]);
    }

    // 路径重写
    let finalPath = targetUrl.pathname;
    if (route.rewrite?.path) {
      finalPath = route.rewrite.path(targetUrl.pathname);
    }
    targetUrl.pathname = finalPath;

    // 准备请求头
    const headers = new Headers(request.headers);

    // 移除 Cloudflare 特有头
    headers.delete('cf-ray');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('x-forwarded-for');

    // 设置正确的 Host
    headers.set('Host', targetUrl.host);
    headers.set('X-Forwarded-For', context.clientIP);
    headers.set('X-Forwarded-Proto', targetUrl.protocol.replace(':', ''));

    // 头重写
    if (route.rewrite?.headers) {
      route.rewrite.headers(headers);
    }

    // 准备请求
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      redirect: 'manual', // 不自动跟随重定向，透传给客户端
    };

    // 非 GET 请求携带 body
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
      // @ts-ignore
      fetchOptions.duplex = 'half';
    }

    // 发起请求
    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // 检查是否需要流式传输
    const contentLength = parseInt(upstreamResponse.headers.get('Content-Length') || '0', 10);
    const streamingThreshold = parseInt(env.STREAMING_THRESHOLD || '10485760', 10);
    const isStreaming = contentLength > streamingThreshold;
    const isLargeFile = route.largeFile?.enabled && contentLength > (route.largeFile.threshold || 0);

    context.isStreaming = isStreaming || isLargeFile;

    // 大文件使用流式传输
    if (isLargeFile || isStreaming) {
      return createStreamResponse(upstreamResponse, context, {
        chunkSize: parseInt(env.CHUNK_SIZE ? parseInt(env.CHUNK_SIZE, 10) : 1024 * 1024,
        resumeSupport: route.largeFile?.resumeSupport ?? true,
      });
    }

    // 普通响应
    const responseHeaders = new Headers(upstreamResponse.headers);
    
    // 移除 Hop-by-hop headers
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
    ];

    for (const header of hopHeaders) {
      responseHeaders.delete(header);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return errorResponse(
      'Proxy request failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}
