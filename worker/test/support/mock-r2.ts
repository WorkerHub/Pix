export interface StoredR2Object {
  key: string
  data: Uint8Array
  size: number
  uploaded: Date
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
}

export class MockR2Bucket implements R2Bucket {
  private storage = new Map<string, StoredR2Object>()

  async put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | null
      | Blob,
    options?: R2PutOptions
  ): Promise<R2Object> {
    let bytes: Uint8Array

    if (value === null) {
      bytes = new Uint8Array(0)
    } else if (typeof value === "string") {
      bytes = new TextEncoder().encode(value)
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value)
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    } else if (value instanceof Blob) {
      const buffer = await value.arrayBuffer()
      bytes = new Uint8Array(buffer)
    } else if (
      typeof (value as ReadableStream).getReader === "function" ||
      typeof (value as any).pipeTo === "function"
    ) {
      const reader = (value as ReadableStream<Uint8Array>).getReader()
      const chunks: Uint8Array[] = []
      let totalLength = 0
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        if (chunk) {
          chunks.push(chunk)
          totalLength += chunk.byteLength
        }
      }
      bytes = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
    } else {
      bytes = new Uint8Array(0)
    }

    const item: StoredR2Object = {
      key,
      data: bytes,
      size: bytes.byteLength,
      uploaded: new Date(),
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata
    }

    this.storage.set(key, item)
    return this.toR2Object(item)
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.storage.get(key)
    if (!item) return null

    const r2Obj = this.toR2Object(item)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(item.data)
        controller.close()
      }
    })

    return {
      ...r2Obj,
      body: stream,
      bodyUsed: false,
      arrayBuffer: async () =>
        item.data.buffer.slice(
          item.data.byteOffset,
          item.data.byteOffset + item.data.byteLength
        ),
      text: async () => new TextDecoder().decode(item.data),
      json: async () => JSON.parse(new TextDecoder().decode(item.data)),
      blob: async () => new Blob([item.data])
    } as unknown as R2ObjectBody
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    for (const k of keyArray) {
      this.storage.delete(k)
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const all = Array.from(this.storage.values())
    const prefix = options?.prefix
    const filtered = prefix
      ? all.filter((item) => item.key.startsWith(prefix))
      : all

    const limit = options?.limit ?? 1000
    const cursor = options?.cursor ? Number(options.cursor) : 0
    const page = filtered.slice(cursor, cursor + limit)
    const nextCursor =
      cursor + limit < filtered.length ? String(cursor + limit) : undefined

    return {
      objects: page.map((item) => this.toR2Object(item)),
      truncated: nextCursor !== undefined,
      cursor: nextCursor,
      delimitedPrefixes: []
    }
  }

  async head(key: string): Promise<R2Object | null> {
    const item = this.storage.get(key)
    if (!item) return null
    return this.toR2Object(item)
  }

  async createMultipartUpload(): Promise<never> {
    throw new Error("Not implemented in mock")
  }

  async resumeMultipartUpload(): Promise<never> {
    throw new Error("Not implemented in mock")
  }

  /** 测试辅助：清空存储桶。 */
  clear(): void {
    this.storage.clear()
  }

  /** 测试辅助：直接放一个具有特定修改时间的对象。 */
  seedObject(
    key: string,
    content: string | Uint8Array,
    uploaded: Date,
    httpMetadata?: R2HTTPMetadata
  ): void {
    const data =
      typeof content === "string" ? new TextEncoder().encode(content) : content
    this.storage.set(key, {
      key,
      data,
      size: data.byteLength,
      uploaded,
      httpMetadata
    })
  }

  private toR2Object(item: StoredR2Object): R2Object {
    return {
      key: item.key,
      version: "mock-v1",
      size: item.size,
      etag: "mock-etag",
      httpEtag: "mock-etag",
      uploaded: item.uploaded,
      httpMetadata: item.httpMetadata ?? {},
      customMetadata: item.customMetadata ?? {},
      checksums: {
        md5: undefined,
        sha1: undefined,
        sha256: undefined,
        sha384: undefined,
        sha512: undefined
      },
      writeHttpMetadata: () => {}
    } as unknown as R2Object
  }
}
