// ========================================
// Docker Registry V2 代理 - 透明转发版
// 参考 docker_image_pusher 项目实现
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
      targetPath = targetPath.replace(/^\/docker/, '');
    }
    // /v2/... -> /v2/... 直接用
    
    const targetUrl = new URL(route.target);
    targetUrl.pathname = targetPath;
    targetUrl.search = url.search;

    console.log(`[Docker Proxy] ${request.method} ${targetUrl.toString()}`);

    // 复制所有请求头
    const headers = new Headers(request.headers);
    
    // 设置 Host
    headers.set('Host', targetUrl.host);

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
      // @ts-ignore
      fetchOptions.duplex = 'half';
    }

    // 发起请求
    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    console.log(`[Docker Proxy] Status: ${upstreamResponse.status}`);

    // 复制响应头
    const responseHeaders = new Headers(upstreamResponse.headers);

    // 处理认证 - 重写 WWW-Authenticate
    const wwwAuth = responseHeaders.get('WWW-Authenticate');
    if (wwwAuth && upstreamResponse.status === 401) {
      // Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      if (realmMatch) {
        const originalRealm = realmMatch[1];
        // 把认证地址改成我们代理的
        const proxyRealm = `${url.origin}/docker-auth/${originalRealm.replace('https://', '')}`;
        const newAuth = wwwAuth.replace(`realm="${originalRealm}"`, `realm="${proxyRealm}"`);
        responseHeaders.set('WWW-Authenticate', newAuth);
        console.log(`[Docker Proxy] Rewrote auth: ${proxyRealm}`);
      }
    }

    // 移除不需要的头
    const hopHeaders = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade'];
    for (const h of hopHeaders) {
      responseHeaders.delete(h);
    }

    // 确保 Docker 头存在
    responseHeaders.set('Docker-Distribution-Api-Version', 'registry/2.0');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Docker Proxy Error]', error);
    return errorResponse(
      'Docker proxy failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}
