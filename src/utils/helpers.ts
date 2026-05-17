// ========================================
// 日志工具
// ========================================

import type { Env, LogEntry } from '../types';

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: number;
  private debug: boolean;

  constructor(env: Env) {
    this.level = LOG_LEVELS[env.LOG_LEVEL || 'info'] ?? 1;
    this.debug = env.DEBUG === 'true';
  }

  private log(level: string, message: string, data?: Record<string, any>): void {
    const levelNum = LOG_LEVELS[level] ?? 1;
    if (levelNum < this.level) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level: level as any,
      message,
      data,
    };

    // Cloudflare Workers 控制台输出
    const prefix = `[${level.toUpperCase()}]`;
    const dataStr = data ? ' ' + JSON.stringify(data) : '';
    console.log(`${prefix} ${message}${dataStr}`);
  }

  debug(message: string, data?: Record<string, any>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, any>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, any>): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | unknown): void {
    const data = error
      ? {
          error: (error as Error).message,
          stack: (error as Error).stack,
        }
      : undefined;
    this.log('error', message, data);
  }
}

// ========================================
// 响应工具
// ========================================

export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function errorResponse(message: string, status = 500, details?: any): Response {
  return jsonResponse(
    {
      success: false,
      error: message,
      details,
      timestamp: Date.now(),
    },
    status
  );
}

// ========================================
// URL 处理工具
// ========================================

export function parseProxyUrl(path: string, target: string): URL {
  // 如果 target 为空，从 path 中提取
  // 格式: /http/https://example.com/path
  if (!target) {
    const match = path.match(/^\/http\/(https?:\/\/.+)/);
    if (match) {
      return new URL(match[1]);
    }
  }

  // 普通路径重写
  const url = new URL(target);
  url.pathname = path;
  return url;
}

// ========================================
// Header 处理工具
// ========================================

export function copyHeaders(from: Headers, to: Headers): void {
  for (const [key, value] of from.entries()) {
    to.set(key, value);
  }
}

export function filterHeaders(headers: Headers, exclude: string[]): Headers {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (!exclude.some((ex) => key.toLowerCase().includes(ex.toLowerCase()))) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

// 需要排除的 Hop-by-hop headers
export const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
];

// ========================================
// 大小格式化工具
// ========================================

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ========================================
// 范围请求解析
// ========================================

export function parseRange(rangeHeader: string | null, fileSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;

  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  let start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

  // 验证范围
  if (start < 0) start = 0;
  if (end >= fileSize) end = fileSize - 1;
  if (start > end) return null;

  return { start, end };
}
