# 项目部署配置
# ========================================

# 1. 安装依赖
npm install

# 2. 登录 Cloudflare
npx wrangler login

# 3. 本地开发
npm run dev

# 4. 部署到生产环境
npm run deploy

# 5. 绑定自定义域名
# 在 Cloudflare 控制台 -> Workers -> 设置 -> 触发器 -> 自定义域名

# ========================================
# 使用示例
# ========================================

# OpenAI 代理
curl https://your-proxy.workers.dev/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_OPENAI_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Git 代理
git clone https://your-proxy.workers.dev/github/username/repo.git

# Docker 代理
docker pull your-proxy.workers.dev/docker/library/nginx:latest

# 通用 HTTP 代理
curl https://your-proxy.workers.dev/http/https://example.com

# WebSocket 代理
wscat -c wss://your-proxy.workers.dev/ws/wss://echo.websocket.org

# ========================================
# Docker 配置
# ========================================

# 方法 1: 配置 daemon.json
# Linux: /etc/docker/daemon.json
{
  "registry-mirrors": ["https://your-proxy.workers.dev/docker/"]
}

# 方法 2: 启动参数
# dockerd --registry-mirror=https://your-proxy.workers.dev/docker/

# 方法 3: 直接拉取
docker pull your-proxy.workers.dev/docker/library/nginx
