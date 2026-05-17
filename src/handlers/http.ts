// ========================================
// HTTP 代理处理器
// ========================================

import type { ProxyContext } from '../types';
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
      const base = new URL(route.target);
      targetUrl = new URL(url.pathname.replace(route.pattern as string, '/'));
      targetUrl.host = base.host;
      targetUrl.protocol = base.protocol;
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

    // 发起请求 - Cloudflare fetch 自动支持流式传输
    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // 直接透传响应
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

    // 确保连接保持
    responseHeaders.set('Connection', 'keep-alive');

    // 直接返回原始响应
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
