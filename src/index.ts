// ========================================
// Cloudflare Worker 代理主入口
// 支持: HTTP(S), WebSocket, Git, Docker, AI APIs
// ========================================

import type { Env, ProxyContext } from './types';
import { matchRoute } from './routes/config';
import { corsMiddleware, logMiddleware, rateLimitMiddleware, headersMiddleware } from './middlewares';
import { httpHandler } from './handlers/http';
import { websocketHandler } from './handlers/websocket';
import { gitHandler } from './handlers/git';
import { dockerHandler } from './handlers/docker';
import { aiHandler } from './handlers/ai';
import { jsonResponse, errorResponse } from './utils/helpers';

// 中间件管道
const middlewarePipeline = [
  logMiddleware,
  corsMiddleware,
  headersMiddleware,
  rateLimitMiddleware,
];

async function applyMiddleware(
  context: ProxyContext,
  index: number = 0
): Promise<Response> {
  if (index >= middlewarePipeline.length) {
    // 所有中间件处理完成，执行处理器
    return handleRequest(context);
  }

  const middleware = middlewarePipeline[index];
  return middleware(context, () => applyMiddleware(context, index + 1));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse({
        status: 'ok',
        message: 'Cloudflare Proxy Gateway',
        version: '2.0.0',
        timestamp: Date.now(),
        endpoints: {
          ai: '/openai/, /claude/, /gemini/',
          git: '/github/, /ghraw/',
          docker: '/docker/, /ghcr/',
          generic: '/http/',
          websocket: '/ws/',
          email: '/gmail/, /google/',
        },
      });
    }

    // 匹配路由
    const route = matchRoute(url);

    // 构建上下文
    const context: ProxyContext = {
      request,
      env,
      ctx,
      url,
      route,
      clientIP: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown',
      userAgent: request.headers.get('User-Agent') || 'unknown',
      startTime: Date.now(),
      headers: new Headers(),
      isStreaming: false,
      isLargeFile: false,
      upgrade: request.headers.get('Upgrade'),
    };

    // 执行中间件和处理
    try {
      return await applyMiddleware(context);
    } catch (error) {
      console.error('Unhandled error:', error);
      return errorResponse(
        'Internal server error',
        500,
        error instanceof Error ? error.message : String(error)
      );
    }
  },
};

/**
 * 分发请求到对应处理器
 */
async function handleRequest(context: ProxyContext): Promise<Response> {
  const { route, upgrade } = context;

  if (!route) {
    return errorResponse('Route not found', 404, {
      available_endpoints: [
        '/openai/ - OpenAI API',
        '/claude/ - Anthropic Claude API',
        '/gemini/ - Google Gemini API',
        '/github/ - GitHub proxy',
        '/ghraw/ - GitHub raw proxy',
        '/docker/ - Docker registry proxy',
        '/ghcr/ - GitHub Container Registry',
        '/http/ - Generic HTTP proxy',
        '/ws/ - WebSocket proxy',
        '/gmail/ - Gmail API',
        '/google/ - Google APIs',
      ],
    });
  }

  // WebSocket 优先检测
  if (upgrade && upgrade.toLowerCase() === 'websocket') {
    return websocketHandler(context);
  }

  // 根据处理器类型分发
  switch (route.handler) {
    case 'ai':
      return aiHandler(context);
    case 'git':
      return gitHandler(context);
    case 'docker':
      return dockerHandler(context);
    case 'websocket':
      return websocketHandler(context);
    case 'http':
    default:
      return httpHandler(context);
  }
}
