// ========================================
// 流式传输工具 - 实现大文件无 100MB 限制传输
// ========================================

import type { ProxyContext } from '../types';
import { parseRange, formatBytes } from './helpers';

interface StreamOptions {
  chunkSize?: number;
  resumeSupport?: boolean;
  onProgress?: (bytes: number) => void;
}

/**
 * 创建流式响应 - 绕过 Cloudflare 100MB 限制
 */
export async function createStreamResponse(
  response: Response,
  context: ProxyContext,
  options: StreamOptions = {}
): Promise<Response> {
  const { chunkSize = 1024 * 1024, resumeSupport = true, onProgress } = options;

  const reader = response.body?.getReader();
  if (!reader) {
    return new Response('No response body', { status: 500 });
  }

  // 获取文件大小
  const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
  const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

  // 处理范围请求（断点续传）
  const rangeHeader = context.request.headers.get('Range');
  const range = resumeSupport && rangeHeader ? parseRange(rangeHeader, contentLength) : null;

  // 创建 TransformStream 实现流式传输
  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    start() {
      // 初始化
    },
    async transform(chunk, controller) {
      // 直接转发数据块
      controller.enqueue(chunk);
      
      // 进度回调
      if (onProgress) {
        onProgress(chunk.length);
      }
    },
    flush() {
      // 传输完成
    },
  });

  // 复制响应头
  const headers = new Headers(response.headers);

  // 添加流式传输相关头
  headers.set('Transfer-Encoding', 'chunked');
  headers.delete('Content-Length'); // 分块传输不需要 Content-Length
  headers.set('Connection', 'keep-alive');
  headers.set('Keep-Alive', 'timeout=300, max=1000');

  // 支持范围请求
  if (resumeSupport) {
    headers.set('Accept-Ranges', 'bytes');
  }

  // 处理范围请求
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
  }

  // 开始传输
  const body = response.body?.pipeThrough(transformStream);

  return new Response(body, {
    status: range ? 206 : response.status,
    statusText: range ? 'Partial Content' : response.statusText,
    headers,
  });
}

/**
 * 分块读取响应体 - 用于内存优化
 */
export async function* readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunkSize: number
): AsyncGenerator<Uint8Array, void, unknown> {
  let buffer: number[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      if (buffer.length > 0) {
        yield new Uint8Array(buffer);
      }
      break;
    }

    for (const byte of value) {
      buffer.push(byte);
      if (buffer.length >= chunkSize) {
        yield new Uint8Array(buffer);
        buffer = [];
      }
    }
  }
}

/**
 * 创建带缓冲的流
 */
export function createBufferedStream(
  readable: ReadableStream<Uint8Array>,
  bufferSize: number
): ReadableStream<Uint8Array> {
  const reader = readable.getReader();
  let buffer: Uint8Array[] = [];
  let bufferLength = 0;

  return new ReadableStream({
    async pull(controller) {
      while (bufferLength < bufferSize) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer.push(value);
        bufferLength += value.length;
      }

      if (buffer.length > 0) {
        // 合并缓冲区
        const merged = new Uint8Array(bufferLength);
        let offset = 0;
        for (const chunk of buffer) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        controller.enqueue(merged);
        buffer = [];
        bufferLength = 0;
      } else {
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

/**
 * 统计流传输进度
 */
export function createProgressStream(
  readable: ReadableStream<Uint8Array>,
  onProgress: (transferred: number, total?: number) => void,
  total?: number
): ReadableStream<Uint8Array> {
  let transferred = 0;
  const reader = readable.getReader();

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        controller.close();
        return;
      }

      transferred += value.length;
      controller.enqueue(value);
      onProgress(transferred, total);
    },
    cancel() {
      reader.cancel();
    },
  });
}

/**
 * 支持并发的 Range 请求
 * 用于大文件分块并行下载
 */
export class RangeDownloader {
  private url: string;
  private chunkSize: number;
  private concurrency: number;
  private headers: Headers;

  constructor(url: string, options: { chunkSize?: number; concurrency?: number; headers?: Headers } = {}) {
    this.url = url;
    this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB
    this.concurrency = options.concurrency || 3;
    this.headers = options.headers || new Headers();
  }

  async getFileSize(): Promise<number> {
    const response = await fetch(this.url, {
      method: 'HEAD',
      headers: this.headers,
    });
    const size = parseInt(response.headers.get('Content-Length') || '0', 10);
    if (!size || size <= 0) {
      throw new Error('Could not determine file size');
    }
    return size;
  }

  async downloadChunk(start: number, end: number): Promise<Uint8Array> {
    const headers = new Headers(this.headers);
    headers.set('Range', `bytes=${start}-${end}`);

    const response = await fetch(this.url, { headers });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to download chunk: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async* download(): AsyncGenerator<Uint8Array, void, unknown> {
    const fileSize = await this.getFileSize();
    const totalChunks = Math.ceil(fileSize / this.chunkSize);

    let chunkIndex = 0;
    const queue: Promise<{ index: number; data: Uint8Array }>[] = [];

    while (chunkIndex < totalChunks) {
      // 填充并发队列
      while (queue.length < this.concurrency && chunkIndex < totalChunks) {
        const start = chunkIndex * this.chunkSize;
        const end = Math.min(start + this.chunkSize - 1, fileSize - 1);
        const idx = chunkIndex;

        queue.push(
          this.downloadChunk(start, end)
            .then((data) => ({ index: idx, data }))
            .catch((error) => ({ index: idx, data: new Uint8Array(0), error }))
        );

        chunkIndex++;
      }

      // 等待最先完成的
      const result = await Promise.race(queue);
      const queueIndex = queue.findIndex((_, i) => i === queue.indexOf(queue[0]));
      queue.splice(queueIndex, 1);

      yield result.data;
    }

    // 等待剩余的完成
    while (queue.length > 0) {
      const result = await queue.shift();
      if (result) yield result.data;
    }
  }
}
