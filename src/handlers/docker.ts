// ========================================
// Docker Registry 代理处理器
// 支持 docker pull, docker push 等操作
// ========================================

import type { ProxyContext, ProxyRoute } from '../types';
import { errorResponse } from '../utils/helpers';

export async function dockerHandler(context: ProxyContext): Promise<Response> {
  const { request, route, url, env } = context;

  if (!route) {
    return errorResponse('No route matched', 404);
  }

  try {
    // 构建目标 URL
    // 路径格式: /docker/v2/... -> https://registry-1.docker.io/v2/...
    const path = url.pathname.replace(route.pattern as string, '/');
    const targetUrl = new URL(route.target);
    targetUrl.pathname = path;
    targetUrl.search = url.search;

    // 处理 Docker Registry 协议
    const headers = new Headers(request.headers);
    
    // 移除 Cloudflare 头
    headers.delete('cf-ray');
    headers.delete('cf-connecting-ip');
    
    // 设置正确的 Host
    headers.set('Host', targetUrl.host);
    headers.set('X-Forwarded-For', context.clientIP);

    // Docker 特殊端点处理
    const isBlob = path.includes('/blobs/');
    const isManifest = path.includes('/manifests/');
    const isAuth = path.includes('/auth/') || path.includes('/token');

    // 认证端点处理
    if (isAuth) {
      return handleDockerAuth(context, targetUrl, headers);
    }

    // Blob 下载（镜像层）
    if (isBlob) {
      return handleDockerBlob(context, targetUrl, headers);
    }

    // Manifest 下载（镜像元数据）
    if (isManifest) {
      return handleDockerManifest(context, targetUrl, headers);
    }

    // 普通请求
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

    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // 重写 WWW-Authenticate 头，让客户端使用代理进行认证
    if (upstreamResponse.status === 401) {
      const wwwAuth = upstreamResponse.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        const proxyAuth = rewriteAuthHeader(wwwAuth, context.url, route);
        const newHeaders = new Headers(upstreamResponse.headers);
        newHeaders.set('WWW-Authenticate', proxyAuth);
        return new Response(upstreamResponse.body, {
          status: 401,
          headers: newHeaders,
        });
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
    });
  } catch (error) {
    console.error('Docker proxy error:', error);
    return errorResponse(
      'Docker registry proxy request failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Docker 认证处理
 */
async function handleDockerAuth(
  context: ProxyContext,
  targetUrl: URL,
  headers: Headers
): Promise<Response> {
  const { request, env } = context;

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
  };

  const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

  // 处理认证响应
  if (upstreamResponse.ok) {
    try {
      const text = await upstreamResponse.text();
      const tokenResponse = JSON.parse(text);

      // 重写 token 中的相关 URL（如果需要）
      return new Response(JSON.stringify(tokenResponse), {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Docker-Distribution-Api-Version': 'registry/2.0',
        },
      });
    } catch (e) {
      // 解析失败，返回原始响应
      return new Response(await upstreamResponse.arrayBuffer(), {
        status: upstreamResponse.status,
        headers: upstreamResponse.headers,
      });
    }
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

/**
 * Docker Blob 下载处理
 */
async function handleDockerBlob(
  context: ProxyContext,
  targetUrl: URL,
  headers: Headers
): Promise<Response> {
  const { request, env } = context;

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

  // Blob 通常很大，使用流式传输
  return createStreamResponse(upstreamResponse, context, {
    chunkSize: 2 * 1024 * 1024, // 2MB 分块
    resumeSupport: true,
  });
}

/**
 * Docker Manifest 处理
 */
async function handleDockerManifest(
  context: ProxyContext,
  targetUrl: URL,
  headers: Headers
): Promise<Response> {
  const { request, env } = context;

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

  // 尝试重写 Manifest 中的 Blob URL 指向代理
  try {
    const contentType = upstreamResponse.headers.get('Content-Type') || '';
    
    // 只处理 JSON 类型的 manifest
    if (contentType.includes('application/json') || contentType.includes('application/vnd.docker')) {
      const text = await upstreamResponse.text();
      const manifest = JSON.parse(text);

      // 重写 layers 中的 URL（如果有）
      if (manifest.layers && Array.isArray(manifest.layers)) {
        manifest.layers = manifest.layers.map((layer: any) => {
          if (layer.urls && Array.isArray(layer.urls)) {
            layer.urls = layer.urls.map((url: string) => {
              // 重写为代理地址
              return `${context.url.origin}/docker-blob/${url}`;
            });
          }
          return layer;
        });
      }

      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.set('Content-Length', String(JSON.stringify(manifest).length));

      return new Response(JSON.stringify(manifest), {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    }
  } catch (e) {
    // 解析失败，返回原始响应
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

/**
 * 重写 WWW-Authenticate 头
 */
function rewriteAuthHeader(wwwAuth: string, requestUrl: URL, route: ProxyRoute): string {
  // Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"
  // 改为指向代理的认证地址

  const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
  if (!realmMatch) return wwwAuth;

  const originalRealm = realmMatch[1];
  const proxyRealm = `${requestUrl.origin}${route.pattern}auth/${originalRealm}`;

  return wwwAuth.replace(`realm="${originalRealm}"`, `realm="${proxyRealm}"`);
}

/**
 * Docker Hub 镜像加速
 * 支持 library/ubuntu 等官方镜像
 */
export function normalizeDockerImagePath(path: string, registry: string): string {
  // 处理 Docker Hub 的特殊情况
  if (registry.includes('docker.io') || registry.includes('registry-1.docker.io')) {
    // /docker/library/ubuntu -> /docker/library/ubuntu
    if (!path.includes('/') && !path.startsWith('v2')) {
      // 官方镜像
      return `/library/${path}`;
    }
  }
  return path;
}
