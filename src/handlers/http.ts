// ========================================
// HTTP 代理处理器
// ========================================

/**
 * 重写响应内容中的链接
 * 将目标域名的链接替换为代理域名
 */
async function rewriteResponseLinks(
  response: Response,
  targetBase: string,
  proxyBase: string
): Promise<Response> {
  const contentType = response.headers.get('Content-Type') || '';
  
  // 只重写 HTML 和 JSON
  if (!contentType.includes('text/html') && 
      !contentType.includes('application/json') &&
      !contentType.includes('application/javascript') &&
      !contentType.includes('text/css')) {
    return response;
  }

  try {
    let body = await response.text();
    
    // 替换绝对路径链接
    body = body.replaceAll(targetBase, proxyBase);
    
    // 替换协议相对路径 //github.com
    const targetNoProto = targetBase.replace('https://', '');
    body = body.replaceAll('//' + targetNoProto, proxyBase.replace('https://', '//'));
    
    // 替换相对路径
    body = body.replaceAll('href="/', `href="${proxyBase}/`);
    body = body.replaceAll('src="/', `src="${proxyBase}/`);
    body = body.replaceAll('action="/', `action="${proxyBase}/`);
    
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (e) {
    // 如果重写失败，返回原始响应
    return response;
  }
}


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

    // 直接透传响应 - Cloudflare 自动处理流式传输
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

    // 如果是 HTML 页面，重写链接
    const contentLength = parseInt(upstreamResponse.headers.get('Content-Length') || '0', 10);
    const contentType = upstreamResponse.headers.get('Content-Type') || '';
    
    if (contentType.includes('text/html') && contentLength < 5 * 1024 * 1024) {
      const proxyBase = `https://${url.host}${route.pattern}`.replace(/\/$/, '');
      const targetBase = route.target || targetUrl.origin;
      return rewriteResponseLinks(upstreamResponse, targetBase, proxyBase);
    }

    // 直接返回原始响应 body，Cloudflare 自动处理流式传输
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
