// ========================================
// CORS 中间件
// ========================================

import type { Middleware, ProxyContext } from '../types';

export const corsMiddleware: Middleware = async (context, next) => {
  const { request, env } = context;

  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': env.CORS_ALLOW_ORIGIN || '*',
        'Access-Control-Allow-Methods': env.CORS_ALLOW_METHODS || 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': env.CORS_ALLOW_HEADERS || '*',
        'Access-Control-Expose-Headers': env.CORS_EXPOSE_HEADERS || '*',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  // 继续处理
  const response = await next();

  // 添加 CORS 头到响应
  response.headers.set('Access-Control-Allow-Origin', env.CORS_ALLOW_ORIGIN || '*');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Expose-Headers', env.CORS_EXPOSE_HEADERS || '*');

  return response;
};

// ========================================
// 日志中间件
// ========================================

export const logMiddleware: Middleware = async (context, next) => {
  const { request, url, clientIP } = context;

  const startTime = Date.now();
  console.log(`[REQUEST] ${request.method} ${url.pathname} - IP: ${clientIP}`);

  try {
    const response = await next();
    const duration = Date.now() - startTime;
    const size = response.headers.get('Content-Length') || 'streaming';

    console.log(
      `[RESPONSE] ${request.method} ${url.pathname} - Status: ${response.status} - Duration: ${duration}ms - Size: ${size}`
    );

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ERROR] ${request.method} ${url.pathname} - Duration: ${duration}ms`, error);
    throw error;
  }
};

// ========================================
// 限流中间件 (简单实现)
// ========================================

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

export const rateLimitMiddleware: Middleware = async (context, next) => {
  const { route, clientIP, env } = context;

  // 检查路由是否启用限流
  if (!route?.rateLimit?.enabled) {
    return next();
  }

  const { max = 100, windowMs = 60000 } = route.rateLimit;
  const key = `${route.id}:${clientIP}`;
  const now = Date.now();

  let record = rateLimitStore.get(key);

  // 窗口过期，重置
  if (!record || now - record.windowStart > windowMs) {
    record = { count: 0, windowStart: now };
  }

  record.count++;
  rateLimitStore.set(key, record);

  // 超过限制
  if (record.count > max) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil(windowMs / 1000)),
      },
    });
  }

  return next();
};

// ========================================
// 请求头清理中间件
// ========================================

import { HOP_BY_HOP_HEADERS } from '../utils/helpers';

export const headersMiddleware: Middleware = async (context, next) => {
  const { request, headers } = context;

  // 复制请求头
  for (const [key, value] of request.headers.entries()) {
    // 跳过 Hop-by-hop headers
    if (!HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // 添加代理相关头
  headers.set('X-Forwarded-For', context.clientIP);
  headers.set('X-Forwarded-Proto', context.url.protocol.replace(':', ''));
  headers.set('X-Forwarded-Host', context.url.host);

  return next();
};
