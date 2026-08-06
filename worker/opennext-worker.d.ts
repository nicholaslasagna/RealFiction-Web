// The OpenNext worker is a build artifact with no type declarations. We only
// rely on its fetch handler and its Durable Object exports.
declare module "*/.open-next/worker.js" {
  const worker: { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> }
  export default worker
  export const DOQueueHandler: unknown
  export const DOShardedTagCache: unknown
  export const BucketCachePurge: unknown
}
