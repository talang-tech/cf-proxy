// ========================================
# Cloudflare Bindings 类型定义
// ========================================

export interface Env {
  // 环境变量
  ENV: string;
  DEBUG: string;
  LOG_LEVEL: string;
  MAX_BODY_SIZE: string;
  STREAMING_THRESHOLD: string;
  CHUNK_SIZE: string;
  REQUEST_TIMEOUT: string;
  CACHE_TTL: string;
  CACHE_MAX_FILE_SIZE: string;
  CORS_ALLOW_ORIGIN: string;
  CORS_ALLOW_METHODS: string;
  CORS_ALLOW_HEADERS: string;
  CORS_EXPOSE_HEADERS: string;
  WS_PING_INTERVAL: string;
  WS_MAX_PAYLOAD: string;
  WS_IDLE_TIMEOUT: string;

  // KV 命名空间
  // PROXY_CACHE: KVNamespace;
  // RATE_LIMIT: KVNamespace;

  // R2 存储
  // PROXY_CACHE_BUCKET: R2Bucket;

  // Durable Objects
  // WS_SESSION: DurableObjectNamespace;
}

// ========================================
# 代理路由配置类型
// ========================================

export interface ProxyRoute {
  id: string;
  name: string;
  pattern: string | RegExp;
  target: string;
  enabled: boolean;
  
  // 处理器类型
  handler: 'http' | 'websocket' | 'git' | 'docker' | 'email' | 'ai' | 'custom';
  
  // 重写配置
  rewrite?: {
    path?: (path: string) => string;
    headers?: (headers: Headers) => Headers | void;
  };

  // 限流配置
  rateLimit?: {
    enabled: boolean;
    max: number;
    windowMs: number;
  };

  // 缓存配置
  cache?: {
    enabled: boolean;
    ttl?: number;
    maxFileSize?: number;
  };

  // 鉴权配置
  auth?: {
    enabled: boolean;
    type: 'basic' | 'bearer' | 'custom';
  };

  // WebSocket 特定配置
  websocket?: {
    enabled: boolean;
    pingInterval?: number;
    maxPayload?: number;
  };

  // 大文件配置
  largeFile?: {
    enabled: boolean;
    threshold?: number;
    chunkSize?: number;
    resumeSupport?: boolean;
  };

  // 自定义选项
  options?: Record<string, any>;
}

// ========================================
# 请求上下文类型
// ========================================

export interface ProxyContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  route: ProxyRoute | null;
  clientIP: string;
  userAgent: string;
  startTime: number;
  headers: Headers;
  isStreaming: boolean;
  isLargeFile: boolean;
  upgrade: string | null;
}

// ========================================
# 中间件类型
// ========================================

export type Middleware = (
  context: ProxyContext,
  next: () => Promise<Response>
) => Promise<Response> | Response;

// ========================================
# 日志类型
// ========================================

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, any>;
}

// ========================================
# 代理结果类型
// ========================================

export interface ProxyResult {
  success: boolean;
  response?: Response;
  error?: Error;
  duration: number;
  bytesTransferred?: number;
}
