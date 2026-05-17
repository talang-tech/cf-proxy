// ========================================
// Git 代理处理器
// 支持 git clone, git push, git pull 等操作
// ========================================

import type { ProxyContext } from '../types';
import { errorResponse } from '../utils/helpers';

export async function gitHandler(context: ProxyContext): Promise<Response> {
  const { request, route, url, env } = context;

  if (!route) {
    return errorResponse('No route matched', 404);
  }

  try {
    // 构建目标 URL
    // 路径格式: /github/user/repo.git/... -> https://github.com/user/repo.git/...
    const path = url.pathname.replace(route.pattern as string, '/');
    const targetUrl = new URL(route.target);
    targetUrl.pathname = path;
    targetUrl.search = url.search;

    // Git 协议头处理
    const headers = new Headers(request.headers);
    
    // 移除 Cloudflare 头
    headers.delete('cf-ray');
    headers.delete('cf-connecting-ip');
    
    // 设置正确的 Host
    headers.set('Host', targetUrl.host);

    // 处理 Git LFS 协议
    const isGitLFS = path.includes('/info/lfs') || path.includes('.git/lfs');
    const isGitSmartHTTP = path.includes('/git-upload-pack') || path.includes('/git-receive-pack');

    // Git Smart HTTP 需要特殊处理
    if (isGitSmartHTTP) {
      return handleGitSmartHTTP(context, targetUrl, headers);
    }

    // Git LFS 处理
    if (isGitLFS) {
      return handleGitLFS(context, targetUrl, headers);
    }

    // 普通 Git 请求
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

    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // Git 响应直接返回，Cloudflare 自动处理流式传输
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
    });
  } catch (error) {
    console.error('Git proxy error:', error);
    return errorResponse(
      'Git proxy request failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Git Smart HTTP 协议处理
 */
async function handleGitSmartHTTP(
  context: ProxyContext,
  targetUrl: URL,
  headers: Headers
): Promise<Response> {
  const { request } = context;

  // 设置正确的 Content-Type
  const contentType = request.headers.get('Content-Type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  // Git Smart HTTP 需要保持连接
  headers.set('Connection', 'keep-alive');

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
    body: request.body,
    // @ts-ignore
    duplex: 'half',
    redirect: 'manual',
  };

  const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

  // Git 响应使用流式传输
  return createStreamResponse(upstreamResponse, context, {
    chunkSize: 128 * 1024, // 128KB
    resumeSupport: false,
  });
}

/**
 * Git LFS 处理
 */
async function handleGitLFS(
  context: ProxyContext,
  targetUrl: URL,
  headers: Headers
): Promise<Response> {
  const { request, env } = context;

  // LFS API 请求
  if (targetUrl.pathname.includes('/objects/batch')) {
    // LFS Batch API - 可能需要重写返回的下载 URL
    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      // @ts-ignore
      duplex: 'half',
    });

    // 尝试重写 LFS 响应中的 URL
    const text = await upstreamResponse.text();
    try {
      const json = JSON.parse(text);

      // 如果有 objects，重写 href 为代理地址
      if (json.objects && Array.isArray(json.objects)) {
        json.objects = json.objects.map((obj: any) => {
          if (obj.actions && obj.actions.download && obj.actions.download.href) {
            // 重写下载地址到代理
            const originalHref = obj.actions.download.href;
            const proxyHref = `${new URL(context.url.origin).protocol}//${context.url.host}/lfs/${originalHref}`;
            obj.actions.download.href = proxyHref;
          }
          return obj;
        });
      }

      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.set('Content-Length', String(JSON.stringify(json).length));

      return new Response(JSON.stringify(json), {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    } catch (e) {
      // JSON 解析失败，返回原始响应
      return new Response(text, {
        status: upstreamResponse.status,
        headers: upstreamResponse.headers,
      });
    }
  }

  // LFS 文件下载
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

  // LFS 文件通常很大，使用流式传输
  return createStreamResponse(upstreamResponse, context, {
    chunkSize: 512 * 1024, // 512KB 分块
    resumeSupport: true,
  });
}

/**
 * Git 认证处理
 */
export function handleGitAuth(context: ProxyContext): boolean {
  const { request } = context;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    // 没有认证，让上游处理
    return true;
  }

  // 支持 Basic Auth 和 Token Auth
  if (authHeader.startsWith('Basic ') || authHeader.startsWith('Bearer ')) {
    // 直接透传认证信息
    return true;
  }

  return true;
}
