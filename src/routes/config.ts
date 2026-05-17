// ========================================
// 代理路由配置
// 按优先级排序，匹配到第一个即停止
// ========================================

import type { ProxyRoute } from '../types';

export const ROUTES: ProxyRoute[] = [
  // ========================================
  // AI 模型 API 代理
  // ========================================
  {
    id: 'openai',
    name: 'OpenAI API Proxy',
    pattern: '/openai/',
    target: 'https://api.openai.com',
    enabled: true,
    handler: 'ai',
    rewrite: {
      path: (path) => path.replace(/^\/openai/, ''),
    },
    cache: {
      enabled: true,
      ttl: 300,
      maxFileSize: 50 * 1024 * 1024, // 50MB
    },
    largeFile: {
      enabled: true,
      threshold: 10 * 1024 * 1024, // 10MB
      resumeSupport: true,
    },
  },
  {
    id: 'claude',
    name: 'Claude API Proxy',
    pattern: '/claude/',
    target: 'https://api.anthropic.com',
    enabled: true,
    handler: 'ai',
    rewrite: {
      path: (path) => path.replace(/^\/claude/, ''),
    },
    largeFile: {
      enabled: true,
      threshold: 10 * 1024 * 1024,
      resumeSupport: true,
    },
  },
  {
    id: 'gemini',
    name: 'Gemini API Proxy',
    pattern: '/gemini/',
    target: 'https://generativelanguage.googleapis.com',
    enabled: true,
    handler: 'ai',
    rewrite: {
      path: (path) => path.replace(/^\/gemini/, ''),
    },
  },

  // ========================================
  // Git 代理
  // ========================================
  {
    id: 'github',
    name: 'GitHub Proxy',
    pattern: '/github/',
    target: 'https://github.com',
    enabled: true,
    handler: 'git',
    rewrite: {
      path: (path) => path.replace(/^\/github/, ''),
    },
    largeFile: {
      enabled: true,
      threshold: 1 * 1024 * 1024, // 1MB
      chunkSize: 2 * 1024 * 1024, // 2MB
      resumeSupport: true,
    },
  },
  {
    id: 'github-raw',
    name: 'GitHub Raw Proxy',
    pattern: '/ghraw/',
    target: 'https://raw.githubusercontent.com',
    enabled: true,
    handler: 'http',
    rewrite: {
      path: (path) => path.replace(/^\/ghraw/, ''),
    },
    largeFile: {
      enabled: true,
      threshold: 1 * 1024 * 1024,
      resumeSupport: true,
    },
  },

  // ========================================
  // Docker 代理
  // ========================================
  {
    id: 'docker-hub',
    name: 'Docker Hub Proxy',
    pattern: '/docker/',
    target: 'https://registry-1.docker.io',
    enabled: true,
    handler: 'docker',
    rewrite: {
      path: (path) => path.replace(/^\/docker/, ''),
    },
    largeFile: {
      enabled: true,
      threshold: 10 * 1024 * 1024, // 10MB
      chunkSize: 5 * 1024 * 1024, // 5MB
      resumeSupport: true,
    },
    cache: {
      enabled: true,
      ttl: 86400, // 24小时
      maxFileSize: 500 * 1024 * 1024, // 500MB
    },
  },
  {
    id: 'ghcr',
    name: 'GitHub Container Registry Proxy',
    pattern: '/ghcr/',
    target: 'https://ghcr.io',
    enabled: true,
    handler: 'docker',
    rewrite: {
      path: (path) => path.replace(/^\/ghcr/, ''),
    },
    largeFile: {
      enabled: true,
      threshold: 10 * 1024 * 1024,
      resumeSupport: true,
    },
  },

  // ========================================
  // 大文件/镜像代理
  // ========================================
  {
    id: 'generic-http',
    name: 'Generic HTTP Proxy',
    pattern: '/http/',
    target: '', // 动态目标: /http/https://example.com/path
    enabled: true,
    handler: 'http',
    rewrite: {
      path: (path) => {
        // /http/https://example.com/path -> https://example.com/path
        const match = path.match(/^\/http\/(https?:\/\/.+)/);
        return match ? match[1] : path;
      },
    },
    largeFile: {
      enabled: true,
      threshold: 5 * 1024 * 1024, // 5MB
      chunkSize: 2 * 1024 * 1024,
      resumeSupport: true,
    },
  },

  // ========================================
  // WebSocket 通用代理
  // ========================================
  {
    id: 'websocket',
    name: 'WebSocket Proxy',
    pattern: '/ws/',
    target: '', // 动态目标
    enabled: true,
    handler: 'websocket',
    websocket: {
      enabled: true,
      pingInterval: 30000,
      maxPayload: 100 * 1024 * 1024, // 100MB
    },
  },

  // ========================================
  // Gmail / Google 邮箱代理
  // ========================================
  {
    id: 'gmail',
    name: 'Gmail API Proxy',
    pattern: '/gmail/',
    target: 'https://gmail.googleapis.com',
    enabled: true,
    handler: 'http',
    rewrite: {
      path: (path) => path.replace(/^\/gmail/, ''),
    },
  },
  {
    id: 'google-apis',
    name: 'Google APIs Proxy',
    pattern: '/google/',
    target: 'https://www.googleapis.com',
    enabled: true,
    handler: 'http',
    rewrite: {
      path: (path) => path.replace(/^\/google/, ''),
    },
  },
];

// ========================================
// 辅助函数：路由匹配
// ========================================

export function matchRoute(url: URL): ProxyRoute | null {
  const path = url.pathname;

  for (const route of ROUTES) {
    if (!route.enabled) continue;

    if (typeof route.pattern === 'string') {
      if (path.startsWith(route.pattern)) {
        return route;
      }
    } else if (route.pattern instanceof RegExp) {
      if (route.pattern.test(path)) {
        return route;
      }
    }
  }

  return null;
}
