// ========================================
// WebSocket 代理处理器
// ========================================

import type { ProxyContext } from '../types';
import { errorResponse } from '../utils/helpers';

/**
 * WebSocket 代理
 * 支持长连接、心跳、消息透传
 */
export async function websocketHandler(context: ProxyContext): Promise<Response> {
  const { request, route, url, env } = context;

  if (!route) {
    return errorResponse('No route matched', 404);
  }

  const upgradeHeader = request.headers.get('Upgrade') || '';
  
  if (upgradeHeader.toLowerCase() !== 'websocket') {
    // 非 WebSocket 请求，降级为 HTTP 代理
    context.route = { ...route, handler: 'http' };
    return httpHandler(context);
  }

  try {
    // 构建目标 WebSocket URL
    let targetWsUrl: string;

    if (route.target) {
      // 固定目标
      const target = new URL(route.target);
      const wsProtocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      targetWsUrl = `${wsProtocol}//${target.host}${url.pathname.replace(route.pattern as string, '/')}${url.search}`;
    } else {
      // 动态目标
      const match = url.pathname.match(/^\/ws\/(wss?:\/\/.+)/);
      if (!match) {
        return errorResponse('Invalid WebSocket proxy URL format', 400);
      }
      targetWsUrl = match[1] + url.search;
    }

    // 创建 WebSocket 对
    const clientPair = new WebSocketPair();
    const [clientWs, serverWs] = Object.values(clientPair);

    // 连接到上游 WebSocket
    await connectAndProxyWebSocket(
      serverWs,
      targetWsUrl,
      request.headers,
      {
        pingInterval: parseInt(env.WS_PING_INTERVAL || '30000', 10),
        maxPayload: parseInt(env.WS_MAX_PAYLOAD || '104857600', 10),
      }
    );

    // 返回 101 Switching Protocols
    return new Response(null, {
      status: 101,
      statusText: 'Switching Protocols',
      webSocket: clientWs,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      },
    });
  } catch (error) {
    console.error('WebSocket proxy error:', error);
    return errorResponse(
      'WebSocket connection failed',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * 连接并代理 WebSocket 通信
 */
async function connectAndProxyWebSocket(
  serverWs: WebSocket,
  targetUrl: string,
  requestHeaders: Headers,
  options: {
    pingInterval: number;
    maxPayload: number;
  }
): Promise<void> {
  // 构建上游 WebSocket 连接
  const wsUrl = new URL(targetUrl);
  const wsHeaders = new Headers(requestHeaders);
  
  // 移除不相关的头
  wsHeaders.delete('upgrade');
  wsHeaders.delete('connection');
  wsHeaders.delete('host');

  // 连接上游（这里使用 fetch + WebSocket 模式）
  const upstreamResponse = await fetch(wsUrl.toString(), {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      ...Object.fromEntries(wsHeaders.entries()),
    },
  });

  const upstreamWs = upstreamResponse.webSocket;
  
  if (!upstreamWs) {
    throw new Error('Upstream did not accept WebSocket connection');
  }

  upstreamWs.accept();
  serverWs.accept();

  // 心跳检测
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongReceived = true;

  const startPing = () => {
    pingTimer = setInterval(() => {
      if (!pongReceived) {
        // 连接超时，关闭
        serverWs.close(1006, 'Connection timeout');
        upstreamWs.close(1006, 'Connection timeout');
        if (pingTimer) clearInterval(pingTimer);
        return;
      }
      pongReceived = false;
      try {
        // @ts-ignore - Cloudflare Workers WebSocket 扩展方法
        upstreamWs.ping();
      } catch (e) {
        if (pingTimer) clearInterval(pingTimer);
      }
    }, options.pingInterval);
  };

  // 客户端 -> 上游
  serverWs.addEventListener('message', (event) => {
    try {
      // 检查消息大小
      if (event.data instanceof ArrayBuffer && event.data.byteLength > options.maxPayload) {
        serverWs.close(1009, 'Message too large');
        return;
      }
      upstreamWs.send(event.data);
    } catch (e) {
      console.error('Error forwarding message to upstream:', e);
    }
  });

  // 上游 -> 客户端
  upstreamWs.addEventListener('message', (event) => {
    try {
      serverWs.send(event.data);
    } catch (e) {
      console.error('Error forwarding message to client:', e);
    }
  });

  // 错误处理
  serverWs.addEventListener('error', (error) => {
    console.error('Client WebSocket error:', error);
    upstreamWs.close(1011, 'Client error');
  });

  upstreamWs.addEventListener('error', (error) => {
    console.error('Upstream WebSocket error:', error);
    serverWs.close(1011, 'Upstream error');
  });

  // 关闭处理
  serverWs.addEventListener('close', (event) => {
    if (pingTimer) clearInterval(pingTimer);
    try {
      upstreamWs.close(event.code, event.reason);
    } catch (e) {
      // 忽略关闭错误
    }
  });

  upstreamWs.addEventListener('close', (event) => {
    if (pingTimer) clearInterval(pingTimer);
    try {
      serverWs.close(event.code, event.reason);
    } catch (e) {
      // 忽略关闭错误
    }
  });

  // Pong 处理
  // @ts-ignore - Cloudflare Workers WebSocket 扩展事件
  upstreamWs.addEventListener('pong', () => {
    pongReceived = true;
  });

  // 启动心跳
  startPing();
}

// 导入 httpHandler 用于降级
import { httpHandler } from './http';
