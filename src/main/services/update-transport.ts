import { request } from 'https'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'http'
import type { DownloadCallOptions } from 'builder-util-runtime/out/httpExecutor'
import {
  HttpExecutor,
  configureRequestOptions,
  configureRequestUrl,
  type CancellationToken,
  type DownloadOptions
} from 'builder-util-runtime'
import { NsisUpdater } from 'electron-updater'

// Chromium remains offline. Only the updater can use this HTTPS transport;
// every request (including redirects and artifact URLs) is checked here.
export class GithubUpdateTransport extends HttpExecutor<ClientRequest> {
  override doApiRequest(
    options: RequestOptions,
    token: CancellationToken,
    processor: (request: ClientRequest, reject: (error: Error) => void) => void,
    redirects = 0
  ): Promise<string> {
    if (redirects >= 5) return Promise.reject(new Error('Too many redirects (> 5).'))
    return super.doApiRequest(options, token, processor, redirects + 1)
  }

  protected override doDownload(
    options: RequestOptions,
    call: DownloadCallOptions,
    redirects: number
  ): void {
    // The runtime's Node redirect path does not increment its counter before
    // recursion. Bound redirects here and turn rejected hosts into promise errors.
    try {
      if (redirects >= 5) throw new Error('Too many redirects (> 5).')
      super.doDownload(options, call, redirects + 1)
    } catch (error) {
      call.callback(error instanceof Error ? error : new Error('Update download failed.'))
    }
  }

  createRequest(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void
  ): ClientRequest {
    const host = options.hostname ?? options.host
    if (
      options.protocol !== 'https:' ||
      (options.port && Number(options.port) !== 443) ||
      ![
        'github.com',
        'api.github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com'
      ].includes(String(host))
    )
      throw new Error('Update requests must use an approved GitHub HTTPS host.')
    return request({ ...options, agent: false, timeout: 30_000 }, callback)
  }

  download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
    return options.cancellationToken.createPromise((resolve, reject, onCancel) => {
      const requestOptions: RequestOptions = { headers: options.headers ?? undefined }
      configureRequestUrl(url, requestOptions)
      configureRequestOptions(requestOptions)
      this.doDownload(
        requestOptions,
        {
          destination,
          options,
          onCancel,
          responseHandler: null,
          callback: (error) => (error ? reject(error) : resolve(destination))
        },
        0
      )
    })
  }
}

export class GithubUpdater extends NsisUpdater {
  // electron-updater's runtime injection point is omitted from its public .d.ts.
  // Keep the adapter covered by smoke:updates when upgrading electron-updater.
  readonly httpExecutor = new GithubUpdateTransport()
}
