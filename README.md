# Cloudflare Worker 多功能代理网关

> 一个强大的、基于 Cloudflare Workers 的代理解决方案，支持大文件传输、WebSocket、Git、Docker、AI API 等。

## ✨ 特性

### 🚀 无大小限制传输
- ✅ 绕过 Cloudflare 100MB 响应体限制
- ✅ 基于 TransformStream 的流式传输
- ✅ 支持 Range 请求和断点续传
- ✅ 分块并发下载大文件

### 🔗 WebSocket 长连接
- ✅ 完整的 WebSocket 协议支持
- ✅ 自动心跳检测和重连
- ✅ 透明消息透传
- ✅ 支持大消息载荷（最高 100MB）

### 📦 Git 仓库代理
- ✅ `git clone/pull/push` 完整支持
- ✅ Git LFS 大文件加速
- ✅ Smart HTTP 协议支持
- ✅ GitHub、GitLab、Gitea 等通用支持

### 🐳 Docker 镜像加速
- ✅ Docker Registry V2 协议兼容
- ✅ 镜像层流式传输
- ✅ Manifest URL 重写
- ✅ 支持 Docker Hub、GHCR、GCR 等

### 🤖 AI API 代理
- ✅ **OpenAI / ChatGPT** - `/openai/`
- ✅ **Anthropic / Claude** - `/claude/`
- ✅ **Google / Gemini** - `/gemini/`
- ✅ SSE 流式响应完整支持
- ✅ 认证信息安全透传
- ✅ 请求限流保护

### 📧 谷歌邮箱代理
- ✅ Gmail API 代理 - `/gmail/`
- ✅ Google APIs 通用代理 - `/google/`
- ✅ OAuth2 认证支持

### 🎯 通用 HTTP 代理
- ✅ 任意 HTTP/HTTPS 网站代理
- ✅ 动态目标 URL 解析
- ✅ 完整的请求方法支持
- ✅ 重定向处理

### 🔒 安全特性
- ✅ CORS 跨域支持
- ✅ 基于 IP 的限流保护
- ✅ Hop-by-hop Header 过滤
- ✅ X-Forwarded-For 正确传递

## 📁 项目结构

```
proxy/
├── src/
│   ├── index.ts           # 主入口
│   ├── types/             # 类型定义
│   ├── routes/            # 路由配置
│   ├── handlers/          # 处理器
│   │   ├── http.ts        # HTTP 代理
│   │   ├── websocket.ts   # WebSocket 代理
│   │   ├── git.ts         # Git 代理
│   │   ├── docker.ts      # Docker 代理
│   │   └── ai.ts          # AI API 代理
│   ├── middlewares/       # 中间件
│   └── utils/             # 工具函数
├── wrangler.toml          # Worker 配置
├── package.json
├── tsconfig.json
├── DEPLOY.md              # 部署文档
└── README.md
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd proxy
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 本地开发

```bash
npm run dev
```

### 4. 部署到生产

```bash
npm run deploy
```

## 📖 使用示例

### AI API 代理

```bash
# OpenAI ChatGPT
curl https://your-proxy.workers.dev/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-xxx" \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello"}]}'

# Anthropic Claude
curl https://your-proxy.workers.dev/claude/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-ant-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-sonnet-20240229","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'

# Google Gemini
curl "https://your-proxy.workers.dev/gemini/v1/models/gemini-pro:generateContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

### Git 代理

```bash
# Clone GitHub 仓库
git clone https://your-proxy.workers.dev/github/username/repo.git

# 配置为全局代理
git config --global url."https://your-proxy.workers.dev/github/".insteadOf "https://github.com/"
```

### Docker 代理

```bash
# 直接拉取镜像
docker pull your-proxy.workers.dev/docker/library/nginx:latest
docker pull your-proxy.workers.dev/docker/ubuntu:22.04

# 配置镜像加速
# /etc/docker/daemon.json
{
  "registry-mirrors": ["https://your-proxy.workers.dev/docker/"]
}
```

### 通用 HTTP 代理

```bash
# 代理任意网站
curl https://your-proxy.workers.dev/http/https://example.com

# 下载大文件
curl -O https://your-proxy.workers.dev/http/https://example.com/large-file.iso
```

### WebSocket 代理

```bash
# 使用 wscat 测试
npm install -g wscat
wscat -c wss://your-proxy.workers.dev/ws/wss://echo.websocket.org
```

## ⚙️ 配置说明

编辑 `wrangler.toml` 配置 Worker：

```toml
name = "cf-proxy-gateway"
compatibility_date = "2024-04-05"

[vars]
ENV = "production"
DEBUG = "false"
LOG_LEVEL = "info"

# 大文件配置
MAX_BODY_SIZE = "1073741824"     # 1GB
STREAMING_THRESHOLD = "10485760" # 10MB 以上使用流式
CHUNK_SIZE = "1048576"           # 1MB 分块

# 超时配置
REQUEST_TIMEOUT = "300"          # 5分钟

# CORS 配置
CORS_ALLOW_ORIGIN = "*"
CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD"
CORS_ALLOW_HEADERS = "*"
CORS_EXPOSE_HEADERS = "*"

# WebSocket 配置
WS_PING_INTERVAL = "30000"      # 30秒心跳
WS_MAX_PAYLOAD = "104857600"    # 100MB 最大载荷
WS_IDLE_TIMEOUT = "300"         # 5分钟空闲超时
```

## 🔧 扩展新代理

要添加新的代理目标，编辑 `src/routes/config.ts`:

```typescript
export const ROUTES: ProxyRoute[] = [
  {
    id: 'my-service',
    name: 'My Service Proxy',
    pattern: '/myservice/',
    target: 'https://api.example.com',
    enabled: true,
    handler: 'http', // 或 'ai' / 'git' / 'docker' / 'websocket'
    largeFile: {
      enabled: true,
      threshold: 5 * 1024 * 1024,
    },
  },
  // ... 更多路由
];
```

## 📊 性能优化

1. **启用 Workers AI** - 如果需要在边缘进行处理
2. **配置 R2 缓存** - 大文件本地缓存，减少回源请求
3. **调整分块大小** - 根据文件类型优化 CHUNK_SIZE
4. **启用缓存规则** - 在 Cloudflare 控制台配置

## 🚨 注意事项

1. **遵守法律法规** - 仅用于合法用途
2. **Cloudflare 限制** - 虽然绕过了 100MB 限制，但 CPU 时间仍有 30s 限制
3. **成本控制** - 大流量可能产生额外费用
4. **认证安全** - 不要在日志中记录 API Token
5. **限速保护** - 合理配置 rateLimit 避免滥用

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 PR！
