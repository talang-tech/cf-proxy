// ========================================
// Docker Registry 代理处理器 - 极简版
// ========================================

import type { ProxyContext } from '../types';
import { errorResponse } from '../utils/helpers';

export async function dockerHandler(context: ProxyContext): Promise<Response> {
  const { request, route, url } = context;

  if (!route) {
    return errorResponse('No route matched', 404);
  }

  try {
    // 构建目标 URL
    let targetPath = url.pathname;
    
    // /docker/v2/... -> /v2/...
    if (route.pattern === '/docker/') {
      targetPath = targetPath.replace('/docker/', '/');
    }
    // /v2/... -> /v2/... (直接用)
    
    const targetUrl = new URL(route.target);
    targetUrl.pathname = targetPath;
    targetUrl.search = url.search;

    // 复制所有请求头
    const headers = new Headers(request.headers);
    headers.set('Host', targetUrl.host);

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
      // @ts-ignore
      fetchOptions.duplex = 'half';
    }

    // 直接转发
    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // 复制所有响应头
    const responseHeaders = new Headers(upstreamResponse.headers);

    // 移除 hop-by-hop 头
    const hopHeaders = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade'];
    for (const h of hopHeaders) {
      responseHeaders.delete(h);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return errorResponse(
      'Docker proxy failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}
